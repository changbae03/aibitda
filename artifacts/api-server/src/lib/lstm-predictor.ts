/**
 * 시장 예측 파이프라인 v8  — LSTM + GBDT 앙상블 + 외부 피처 + 수급 + 글로벌 변동성
 * ──────────────────────────────────────────────────────────────────────
 * 기술적 11 + 거래량 3 + 매크로 3 + 수급 3 + 글로벌 변동성/금리 3 = 총 N_FEATURES = 23
 *
 * [기술적 11] 수익률, MA5/20비율, RSI14, 변동성5/20일, 볼린저밴드, 모멘텀5/10일
 *             MACD Line (EMA12-EMA26)/price, MACD Signal (EMA9)/price
 * [거래량  3] 거래량 5일 모멘텀, 상대거래량(vs MA20), 방향가중 거래량   ← NEW v15
 * [매크로  3]  S&P500 전일 등락 (^GSPC) / DXY (SNP용)
 *             원/달러 환율 변화율 (USDKRW=X)
 *             국고채 3년 금리 (KR FRED) / 미국10Y (SNP용)
 * [수급    3]  외국인 순매수 (KRX, KOSPI/KOSDAQ만) / 나스닥 일별 수익률 (SNP)  ← v16
 *             기관 순매수   (KRX, KOSPI/KOSDAQ만) / 러셀2000 일별 수익률 (SNP)  ← v16
 *             공매도 IQR정규화 (KRX, KOSPI/KOSDAQ만) / 나스닥 5일 모멘텀 (SNP)  ← v16
 * [글로벌 3]  VIX 5일 모멘텀 — 공포/탐욕 레짐 감지 (전 시장 공통)
 *             VIX 일별 변화율 — 공포 가속도 감지
 *             미국 10Y-2Y 금리차 — 경기 선행 사이클
 */
import fs   from "node:fs";
import path from "node:path";
import * as tf from "@tensorflow/tfjs";
import YahooFinance from "yahoo-finance2";
import { pool } from "@workspace/db";
import { fetchInvestorData, fetchShortRatio, isPykrxEnabled } from "./pykrx-client.js";

// ─── Public types ────────────────────────────────────────────────────────────

export interface PredPoint       { date: string; value: number; lower: number; upper: number }
export interface RecentPerfPoint { date: string; predicted: number; actual: number }
export interface IndexResult {
  symbol: string; name: string;
  historical: { date: string; value: number }[];
  predictions: PredPoint[];
  currentValue: number; predictedReturn3d: number; trend: "up" | "down";
  testMae: number; testDirAcc: number;
  wfDirAcc: number; rolling30dDirAcc: number; predErrStd: number;
  recentPerf: RecentPerfPoint[];
  lstmDirAcc: number; gbdtDirAcc: number; ensembleAlpha: number;
}
export interface PipelineStep {
  key: string; label: string;
  status: "pending" | "running" | "done" | "error";
  durationMs?: number;
}
export interface PipelineStatus {
  running: boolean; ready: boolean; steps: PipelineStep[];
  error?: string; trainedAt?: string; trainingMs?: number;
  kospi?: IndexResult; kosdaq?: IndexResult; snp500?: IndexResult; nasdaq?: IndexResult;
}

// ─── Hyperparameters ─────────────────────────────────────────────────────────

const LOOKBACK     = 20;
const PRED_H       = 3;
const N_FEATURES   = 23;   // 11 기술적 + 3 거래량 + 3 매크로 + 3 수급 + 3 글로벌 변동성/금리
const GBDT_BINS    = 32;
const N_INCR_TREES = 5;
const LSTM_UNITS   = 32;
const LSTM_DENSE   = 16;
const LSTM_BATCH   = 32;
const YEARS_DATA   = 5;
const CACHE_TTL    = 6 * 3600_000;
const KRX_BASE     = "http://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd";

// 모델 버전 — 피처/아키텍처 변경 시 번호 올리면 자동 재학습
const MODEL_VERSION = 16;

// ─── 인덱스별 하이퍼파라미터 ──────────────────────────────────────────────────

interface IndexHP {
  gbdtTrees:    number;
  gbdtLR:       number;
  gbdtDepth:    number;
  gbdtLeaf:     number;
  gbdtFsub:     number;
  gbdtSsub:     number;
  nEnsemble:    number;
  lstmEpochs:   number;
  lstmLR:       number;
  lstmDrop:     number;
  recentWindow: number;   // 최근 적중률 계산 창 (알파 동적 조정용)
}

const INDEX_HP: Record<string, IndexHP> = {
  /** KOSPI — VIX 피처 추가로 레짐 감지 강화, 앙상블·에폭 확대 */
  KS11: {
    gbdtTrees: 120, gbdtLR: 0.04,  gbdtDepth: 4, gbdtLeaf: 15,
    gbdtFsub: 0.60, gbdtSsub: 0.80, nEnsemble: 4,
    lstmEpochs: 60, lstmLR: 0.001,  lstmDrop: 0.20,
    recentWindow: 30,
  },
  /** KOSDAQ — 변동성 높은 성장주 지수, 더 깊고 많은 트리 + 긴 학습 */
  KQ11: {
    gbdtTrees: 120, gbdtLR: 0.025, gbdtDepth: 4, gbdtLeaf: 10,
    gbdtFsub: 0.65, gbdtSsub: 0.75, nEnsemble: 4,
    lstmEpochs: 40, lstmLR: 0.001, lstmDrop: 0.15,
    recentWindow: 20,   // 최근 20일로 빠르게 반응
  },
  /** S&P500 — 유동성 높은 미국 대형주 지수, VIX+금리차+나스닥/러셀 피처 강화 (v16) */
  GSPC: {
    gbdtTrees: 200, gbdtLR: 0.025, gbdtDepth: 4, gbdtLeaf: 12,
    gbdtFsub: 0.65, gbdtSsub: 0.80, nEnsemble: 5,
    lstmEpochs: 100, lstmLR: 0.0007, lstmDrop: 0.25,
    recentWindow: 20,   // 최근 20일로 빠르게 반응 (v16)
  },
  /** NASDAQ — 기술주 중심 지수, 변동성 높아 LSTM 가중치 증가 */
  IXIC: {
    gbdtTrees: 200, gbdtLR: 0.025, gbdtDepth: 4, gbdtLeaf: 12,
    gbdtFsub: 0.65, gbdtSsub: 0.80, nEnsemble: 5,
    lstmEpochs: 100, lstmLR: 0.0007, lstmDrop: 0.30,   // 드롭아웃 높게 (고변동성)
    recentWindow: 20,
  },
};

function getHP(symRaw: string): IndexHP {
  const key = symRaw.replace(/[\^]/g, "");
  return INDEX_HP[key] ?? INDEX_HP["KS11"]!;
}

// ─── Persistence ─────────────────────────────────────────────────────────────

const DATA_DIR   = path.resolve(process.cwd(), "data");
const MODEL_PATH = (sym: string) => path.join(DATA_DIR, `krx_${sym}_model.json`);
const META_PATH  = path.join(DATA_DIR, "krx_meta.json");

function ensureDataDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }

interface GBDTModel { trees: any[]; lr: number; basePred: number }
interface LSTMWeightLayer { shape: number[]; data: number[] }

interface StoredModelFile {
  version?: number;
  nFeatures: number;
  gbdtModels: GBDTModel[];
  gbdtScaler: { mu: number[]; sigma: number[] };
  lstmWeights: LSTMWeightLayer[][];
  lstmScaler:  { mu: number[]; sigma: number[] };
  ensembleAlpha: number;
}
export interface StoredMeta {
  lastTrained: string; lastUpdated: string;
  nSamples: Record<string, number>;
  dirAcc:          Record<string, number>;
  wfDirAcc:        Record<string, number>;
  rolling30dDirAcc: Record<string, number>;
  updateCount: number;
}

function saveModelFile(sym: string, payload: StoredModelFile) {
  ensureDataDir();
  fs.writeFileSync(MODEL_PATH(sym), JSON.stringify({ ...payload, version: MODEL_VERSION }));
  console.log(`[gbdt] 저장: ${MODEL_PATH(sym)} (nFeatures=${payload.nFeatures}, v${MODEL_VERSION})`);
}
function loadModelFile(sym: string): StoredModelFile | null {
  const p = MODEL_PATH(sym);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); }
  catch (e) { console.warn("[gbdt] 모델 로드 실패:", e); return null; }
}
export function saveMeta(meta: StoredMeta) {
  ensureDataDir();
  fs.writeFileSync(META_PATH, JSON.stringify(meta, null, 2));
}
export function loadMeta(): StoredMeta | null {
  if (!fs.existsSync(META_PATH)) return null;
  try { return JSON.parse(fs.readFileSync(META_PATH, "utf-8")); }
  catch { return null; }
}

// ─── Pipeline state ──────────────────────────────────────────────────────────

let _status: PipelineStatus = { running: false, ready: false, steps: defaultSteps() };
let _lastRun = 0;

function defaultSteps(): PipelineStep[] {
  return [
    { key: "data",    label: "데이터 수집",    status: "pending" },
    { key: "feature", label: "피처 엔지니어링", status: "pending" },
    { key: "lstm",    label: "LSTM 학습",       status: "pending" },
    { key: "gbdt",    label: "GBDT 학습",       status: "pending" },
    { key: "ensemble",label: "앙상블 합성",     status: "pending" },
    { key: "output",  label: "출력",            status: "pending" },
  ];
}
function stepSet(key: string, status: PipelineStep["status"], ms?: number) {
  const s = _status.steps.find(s => s.key === key);
  if (s) { s.status = status; if (ms !== undefined) s.durationMs = ms; }
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function makeRng(seed: number) {
  let s = (seed >>> 0) || 1;
  return () => { s = Math.imul(s, 1664525) + 1013904223 >>> 0; return s / 0x100000000; };
}
function stddev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length);
}
function dirAccRate(preds: ArrayLike<number>, actual: ArrayLike<number>): number {
  let h = 0;
  for (let i = 0; i < (preds as any).length; i++) if (Math.sign((preds as any)[i]) === Math.sign((actual as any)[i])) h++;
  return (preds as any).length > 0 ? h / (preds as any).length : 0;
}

// ─── KRX helper ──────────────────────────────────────────────────────────────

/** 쉼표·공백 제거 후 숫자 파싱 (억원 단위, 음수 허용) */
function parseKRXNum(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(String(v).replace(/,/g, "").trim());
  return isNaN(n) ? 0 : n;
}

/** KRX 날짜 문자열 → ISO (YYYYMMDD or YYYY/MM/DD → YYYY-MM-DD) */
function krxDateToISO(raw: unknown): string {
  const s = String(raw ?? "").replace(/[/\-]/g, "");
  if (s.length !== 8) return "";
  return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
}

/**
 * KRX OpenAPI — OTP 인증 방식 (KRX_API_KEY 환경변수 필요)
 *
 * 흐름:
 *   1) POST /contents/COM/GenerateOTP.jspx  → OTP 문자열 반환
 *   2) POST /comm/bldAttendant/getJsonData.cmd?bld=...&otp=OTP&...params
 *
 * 사전 조건: KRX 정보데이터시스템 포털에서 서버 IP(34.122.175.30)를 허용 IP로 등록해야 함.
 */
async function krxOpenApiPost(bld: string, params: Record<string, string>): Promise<any[]> {
  const apiKey = process.env.KRX_API_KEY;
  if (!apiKey) return [];

  try {
    // Step 1: OTP 발급
    const otpBody = new URLSearchParams({ auth: apiKey, code: bld });
    const otpRes = await fetch("http://data.krx.co.kr/contents/COM/GenerateOTP.jspx", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent":   "Mozilla/5.0",
        "Referer":      "http://data.krx.co.kr/",
      },
      body: otpBody.toString(),
      signal: AbortSignal.timeout(10000),
    });
    if (!otpRes.ok) { console.warn(`[ext] KRX OTP HTTP ${otpRes.status}`); return []; }

    const otpText = (await otpRes.text()).trim();
    // OTP는 짧은 영숫자 문자열. HTML이 돌아오면 인증 실패 (IP 미등록 등)
    if (otpText.includes("<html") || otpText.length > 200) {
      console.warn("[ext] KRX OTP 인증 실패 — 포털에서 IP(34.122.175.30) 등록 필요");
      return [];
    }

    // Step 2: OTP로 데이터 조회
    const dataBody = new URLSearchParams({ bld, otp: otpText, ...params });
    const dataRes = await fetch("http://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent":   "Mozilla/5.0",
        "Referer":      "http://data.krx.co.kr/",
        "Accept":       "application/json, */*",
      },
      body: dataBody.toString(),
      signal: AbortSignal.timeout(30000),
    });
    if (!dataRes.ok) { console.warn(`[ext] KRX 데이터 HTTP ${dataRes.status}`); return []; }

    const json = await dataRes.json() as any;
    return json?.output ?? json?.OutBlock_1 ?? [];
  } catch (e: any) {
    console.warn(`[ext] KRX OpenAPI 예외 (${bld}):`, e?.message);
    return [];
  }
}

/** KRX 데이터 요청 — OpenAPI(OTP) 우선, 실패 시 퍼블릭 스크래핑 fallback */
async function krxGet(bld: string, extra: Record<string, string>): Promise<any[]> {
  // KRX_API_KEY 있으면 OpenAPI 먼저 시도
  if (process.env.KRX_API_KEY) {
    const rows = await krxOpenApiPost(bld, extra);
    if (rows.length > 0) return rows;
    // OTP 인증 실패(IP 미등록)면 바로 리턴 — 스크래핑은 어차피 LOGOUT
    const apiKey = process.env.KRX_API_KEY;
    if (apiKey) return [];  // 키 있지만 실패 → fallback 생략
  }

  // fallback: 퍼블릭 스크래핑 (세션 불필요한 공개 엔드포인트)
  const params = new URLSearchParams({ bld, ...extra });
  try {
    const res = await fetch(`${KRX_BASE}?${params}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer":    "http://data.krx.co.kr/",
        "Accept":     "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) { console.warn(`[ext] KRX HTTP ${res.status} (bld=${bld})`); return []; }
    const json = await res.json() as any;
    return json?.output ?? json?.OutBlock_1 ?? [];
  } catch (e: any) {
    console.warn(`[ext] KRX GET 예외 (${bld}):`, e?.message);
    return [];
  }
}

/**
 * 시장별 투자자별 거래실적 — pykrx 우선, KRX OTP fallback
 * 외국인·기관 순매수 거래대금 (억원) 일별 시계열
 */
async function fetchKRXMarketInvestor(
  market: "KOSPI" | "KOSDAQ",
  startYYYYMMDD: string,
  endYYYYMMDD:   string,
): Promise<{ date: string; foreignNet: number; instNet: number }[]> {
  // ① pykrx (KRX_ID/KRX_PW 있을 때)
  if (isPykrxEnabled()) {
    const fromISO = `${startYYYYMMDD.slice(0,4)}-${startYYYYMMDD.slice(4,6)}-${startYYYYMMDD.slice(6,8)}`;
    const toISO   = `${endYYYYMMDD.slice(0,4)}-${endYYYYMMDD.slice(4,6)}-${endYYYYMMDD.slice(6,8)}`;
    const rows = await fetchInvestorData(market, fromISO, toISO);
    if (rows.length) {
      console.log(`[ext] pykrx 투자자 ${rows.length}행 (${market})`);
      return rows.map(r => ({ date: r.date, foreignNet: r.foreign, instNet: r.institution }));
    }
    console.warn(`[ext] pykrx 투자자 0행 (${market}) — KRX OTP fallback`);
  }

  // ② KRX OpenAPI OTP (IP 화이트리스트 등록 후)
  const mktId = market === "KOSPI" ? "STK" : "KSQ";
  const rows = await krxGet("dbms/MDC/STAT/standard/MDCSTAT02303", {
    mktId, strtDd: startYYYYMMDD, endDd: endYYYYMMDD, share: "1", money: "1", csvxls_isNo: "false",
  });
  if (!rows.length) { console.warn(`[ext] KRX 투자자 0행 (${market})`); return []; }
  console.log(`[ext] KRX OTP 투자자 ${rows.length}행 (${market})`);
  return rows.map((r: any) => ({
    date:       krxDateToISO(r.TRD_DD ?? r.trdDd ?? r["일자"]),
    foreignNet: parseKRXNum(r.FRGN_NETBUY_TRDVAL ?? r.frgnNetbuyTrdval
                  ?? r.FRGN_NETBYTD_AMT ?? r["외국인_순매수거래대금"] ?? 0),
    instNet:    parseKRXNum(r.INST_NETBUY_TRDVAL  ?? r.instNetbuyTrdval
                  ?? r.INST_NETBYTD_AMT ?? r["기관계_순매수거래대금"] ?? 0),
  })).filter(r => r.date.length === 10);
}

/**
 * 공매도 비율 — pykrx 우선, KRX OTP fallback
 * 공매도 비율 (%) 일별 시계열
 */
async function fetchKRXMarketShort(
  market: "KOSPI" | "KOSDAQ",
  startYYYYMMDD: string,
  endYYYYMMDD:   string,
): Promise<{ date: string; shortRatio: number }[]> {
  // ① pykrx (KRX_ID/KRX_PW 있을 때)
  if (isPykrxEnabled()) {
    const fromISO = `${startYYYYMMDD.slice(0,4)}-${startYYYYMMDD.slice(4,6)}-${startYYYYMMDD.slice(6,8)}`;
    const toISO   = `${endYYYYMMDD.slice(0,4)}-${endYYYYMMDD.slice(4,6)}-${endYYYYMMDD.slice(6,8)}`;
    const rows = await fetchShortRatio(market, fromISO, toISO);
    if (rows.length) {
      console.log(`[ext] pykrx 공매도 ${rows.length}행 (${market})`);
      return rows.map(r => ({ date: r.date, shortRatio: r.ratio }));
    }
    console.warn(`[ext] pykrx 공매도 0행 (${market}) — KRX OTP fallback`);
  }

  // ② KRX OpenAPI OTP (IP 화이트리스트 등록 후)
  const mktId = market === "KOSPI" ? "STK" : "KSQ";
  const rows = await krxGet("dbms/MDC/STAT/standard/MDCSTAT05001", {
    mktId, strtDd: startYYYYMMDD, endDd: endYYYYMMDD, share: "1", money: "1", csvxls_isNo: "false",
  });
  if (!rows.length) { console.warn(`[ext] KRX 공매도 0행 (${market})`); return []; }
  console.log(`[ext] KRX OTP 공매도 ${rows.length}행 (${market})`);
  return rows.map((r: any) => {
    const ratioRaw = r.SHTSELL_TRDVOL_WGHT ?? r.shtsellTrdvolWght
      ?? r.SHT_SELNG_RQST_RGHT_QTY_WGHT ?? r["공매도비율"];
    let shortRatio = ratioRaw !== undefined ? parseKRXNum(ratioRaw) : NaN;
    if (isNaN(shortRatio) || shortRatio === 0) {
      const shortVol = parseKRXNum(r.SHTSELL_TRDVOL ?? r.shtsellTrdvol ?? r["공매도거래량"]);
      const totalVol = parseKRXNum(r.TRDVOL        ?? r.trdvol        ?? r["거래량"]);
      shortRatio = totalVol > 0 ? (shortVol / totalVol) * 100 : 0;
    }
    return { date: krxDateToISO(r.TRD_DD ?? r.trdDd ?? r["일자"]), shortRatio };
  }).filter(r => r.date.length === 10 && !isNaN(r.shortRatio));
}

// ─── External data (매크로 + 수급) ───────────────────────────────────────────

interface ExtPoint {
  sp500Ret:    number;   // S&P500 전일 등락률 (소수) / SNP용: DXY 등락
  usdkrwRet:  number;   // 원/달러 변화율 (소수)
  bond3y:     number;   // 국고채 3년 금리 % / SNP용: 미국10Y
  foreignNet: number;   // 외국인 순매수 (KRX 정규화, −1~+1) / SNP는 0
  instNet:    number;   // 기관 순매수   (KRX 정규화, −1~+1) / SNP는 0
  shortRatio: number;   // 공매도 비율 % / SNP는 0
  vix5dMom:   number;   // [v13] VIX 5일 모멘텀 — 낙폭=음수=공포완화=회복신호
  vixRet:     number;   // VIX 일별 변화율 (당일 공포 가속도)
  yieldSpread: number;  // 미국 10Y-2Y 금리차 (%) — 경기 선행
}

async function fetchYahooSeries(ticker: string, years: number): Promise<{ date: string; close: number }[]> {
  const yahoo = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
  const end = new Date(), start = new Date();
  start.setFullYear(start.getFullYear() - years);
  try {
    const r = await (yahoo as any).chart(ticker, { period1: start, period2: end, interval: "1d" });
    return (r.quotes ?? [])
      .filter((q: any) => q.close != null)
      .map((q: any) => ({ date: new Date(q.date).toISOString().slice(0, 10), close: q.close as number }));
  } catch (e) {
    console.warn(`[ext] ${ticker} fetch 실패:`, (e as any)?.message ?? e);
    return [];
  }
}

async function fredFetchSeries(seriesId: string, startDate: string): Promise<{ date: string; value: number }[]> {
  const key = process.env["FRED_API_KEY"];
  if (!key) return [];
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${key}&file_type=json&observation_start=${startDate}&sort_order=asc&limit=5000`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) return [];
    const data = await res.json() as any;
    return (data?.observations ?? [])
      .filter((o: any) => o.value !== ".")
      .map((o: any) => ({ date: o.date as string, value: parseFloat(o.value) }));
  } catch (e) {
    console.warn(`[ext] FRED ${seriesId} 실패:`, (e as any)?.message ?? e);
    return [];
  }
}

/** 날짜 배열 → 외부 피처 Map (forward-fill)
 *  market = "KOSPI"|"KOSDAQ" → S&P500 + USDKRW + 한국채 + KRX 수급
 *  market = "SNP"             → DXY + USDKRW + 미국 10Y (KRX 없음)
 */
async function fetchExternalData(
  dates: string[],
  market: "KOSPI" | "KOSDAQ" | "SNP" = "KOSPI",
): Promise<Map<string, ExtPoint>> {
  if (dates.length === 0) return new Map();
  const startISO  = dates[0] ?? "2020-01-01";
  const years = Math.min(YEARS_DATA + 0.3,
    Math.ceil((Date.now() - new Date(startISO).getTime()) / (365.25 * 24 * 3600_000)) + 0.3);
  const startKRX  = startISO.replace(/-/g, "");
  const endKRX    = (dates[dates.length - 1] ?? new Date().toISOString().slice(0, 10)).replace(/-/g, "");

  console.log(`[ext] 외부 데이터 수집 (${market}, ${years.toFixed(1)}년, KRX ${startKRX}~${endKRX})...`);

  // ── S&P500 전용 분기: DXY + USDKRW + 미국10Y + VIX + 미국2Y + 나스닥 + 러셀2000 ──
  // [v16] SNP용 수급 슬롯 재활용:
  //   foreignNet → 나스닥(^IXIC) 일별 수익률  (기술주 모멘텀)
  //   instNet    → 러셀2000(^RUT) 일별 수익률 (소형주 위험선호도)
  //   shortRatio → 나스닥 5일 모멘텀           (기술주 트렌드 지속성)
  if (market === "SNP") {
    const [dxyRows, usdkrwRows, bond10Rows, vixRows, bond2Rows, ixicRows, rutRows] = await Promise.all([
      fetchYahooSeries("DX-Y.NYB", years),   // 달러인덱스 (DXY)
      fetchYahooSeries("USDKRW=X", years),   // 원달러 환율
      fredFetchSeries("DGS10", startISO),     // 미국 10Y 국채금리 (일별)
      fetchYahooSeries("^VIX",    years),     // VIX 공포지수
      fredFetchSeries("DGS2",  startISO),     // 미국 2Y 국채금리 (일별)
      fetchYahooSeries("^IXIC",  years),      // [v16] 나스닥 종합지수
      fetchYahooSeries("^RUT",   years),      // [v16] 러셀2000 소형주지수
    ]);
    const dxyRetMap = new Map<string, number>();
    for (let i = 1; i < dxyRows.length; i++)
      dxyRetMap.set(dxyRows[i].date, (dxyRows[i].close - dxyRows[i-1].close) / dxyRows[i-1].close);
    const usdkrwRetMap = new Map<string, number>();
    for (let i = 1; i < usdkrwRows.length; i++)
      usdkrwRetMap.set(usdkrwRows[i].date, (usdkrwRows[i].close - usdkrwRows[i-1].close) / usdkrwRows[i-1].close);

    // VIX: 5일 모멘텀(회복신호) + 일별 변화율 맵
    const vix5dMomMap = new Map<string, number>();
    const vixRetMap   = new Map<string, number>();
    for (let i = 0; i < vixRows.length; i++) {
      if (i > 0)
        vixRetMap.set(vixRows[i].date, (vixRows[i].close - vixRows[i-1].close) / (vixRows[i-1].close || 1));
      if (i >= 5)
        vix5dMomMap.set(vixRows[i].date, (vixRows[i].close - vixRows[i-5].close) / (vixRows[i-5].close || 1));
    }

    // [v16] 나스닥: 일별 수익률 + 5일 모멘텀
    const ixicRetMap   = new Map<string, number>();
    const ixic5dMomMap = new Map<string, number>();
    for (let i = 1; i < ixicRows.length; i++) {
      const ret = (ixicRows[i].close - ixicRows[i-1].close) / (ixicRows[i-1].close || 1);
      ixicRetMap.set(ixicRows[i].date, ret);
      if (i >= 5)
        ixic5dMomMap.set(ixicRows[i].date, (ixicRows[i].close - ixicRows[i-5].close) / (ixicRows[i-5].close || 1));
    }

    // [v16] 러셀2000: 일별 수익률
    const rutRetMap = new Map<string, number>();
    for (let i = 1; i < rutRows.length; i++)
      rutRetMap.set(rutRows[i].date, (rutRows[i].close - rutRows[i-1].close) / (rutRows[i-1].close || 1));

    const bond10Entries = bond10Rows.sort((a, b) => a.date.localeCompare(b.date));
    const bond2Entries  = bond2Rows.sort((a, b) => a.date.localeCompare(b.date));

    const result = new Map<string, ExtPoint>();
    let lastDXY = 0, lastUSDKRW = 0, lastBond10 = 4.5, lastBond2 = 4.0;
    let lastVix5dMom = 0, lastVixRet = 0;
    let lastIxicRet = 0, lastIxic5dMom = 0, lastRutRet = 0;
    let b10Idx = 0, b2Idx = 0;

    for (const date of dates) {
      while (b10Idx < bond10Entries.length && bond10Entries[b10Idx].date <= date) {
        lastBond10 = bond10Entries[b10Idx].value; b10Idx++;
      }
      while (b2Idx < bond2Entries.length && bond2Entries[b2Idx].date <= date) {
        lastBond2 = bond2Entries[b2Idx].value; b2Idx++;
      }
      if (dxyRetMap.has(date))      lastDXY        = dxyRetMap.get(date)!;
      if (usdkrwRetMap.has(date))   lastUSDKRW     = usdkrwRetMap.get(date)!;
      if (vix5dMomMap.has(date))    lastVix5dMom   = vix5dMomMap.get(date)!;
      if (vixRetMap.has(date))      lastVixRet     = vixRetMap.get(date)!;
      if (ixicRetMap.has(date))     lastIxicRet    = ixicRetMap.get(date)!;
      if (ixic5dMomMap.has(date))   lastIxic5dMom  = ixic5dMomMap.get(date)!;
      if (rutRetMap.has(date))      lastRutRet     = rutRetMap.get(date)!;

      const yieldSpread = lastBond10 - lastBond2;   // 10Y-2Y 금리차 (보통 -2 ~ +3%)
      result.set(date, {
        sp500Ret:    lastDXY,                                         // DXY 등락 (달러 강도)
        usdkrwRet:   lastUSDKRW,                                      // USDKRW 변화율
        bond3y:      lastBond10,                                      // 미국 10Y 금리
        foreignNet:  Math.max(-1, Math.min(1, lastIxicRet / 0.03)),   // [v16] 나스닥 일별 수익률 (±3%→±1)
        instNet:     Math.max(-1, Math.min(1, lastRutRet  / 0.03)),   // [v16] 러셀2000 일별 수익률 (±3%→±1)
        shortRatio:  Math.max(-3, Math.min(3, lastIxic5dMom / 0.05)), // [v16] 나스닥 5일 모멘텀 (±5%→±1, −3~+3)
        vix5dMom:    lastVix5dMom,                                    // VIX 5일 모멘텀 (음수=공포완화=회복)
        vixRet:      lastVixRet,                                      // VIX 일별 변화율
        yieldSpread: yieldSpread,                                     // 10Y-2Y 장단기 금리차
      });
    }
    console.log(`[ext] 완료(SNP) — DXY ${dxyRows.length}행, 환율 ${usdkrwRows.length}행, 미국10Y ${bond10Rows.length}행, VIX ${vixRows.length}행, 미국2Y ${bond2Rows.length}행, IXIC ${ixicRows.length}행, RUT ${rutRows.length}행`);
    return result;
  }

  const [sp500Rows, usdkrwRows, bondRows, investorRows, shortRows, vixRows, usb10Rows, usb2Rows] = await Promise.all([
    fetchYahooSeries("^GSPC", years),
    fetchYahooSeries("USDKRW=X", years),
    fredFetchSeries("IRLTLT01KRM156N", startISO),  // 한국 장기국채 (월별, OECD) – 3Y ≈ 10Y – 0.4pp
    fetchKRXMarketInvestor(market, startKRX, endKRX),
    fetchKRXMarketShort(market, startKRX, endKRX),
    fetchYahooSeries("^VIX", years),               // [NEW] VIX 공포지수
    fredFetchSeries("DGS10", startISO),            // [NEW] 미국 10Y 국채금리
    fredFetchSeries("DGS2",  startISO),            // [NEW] 미국 2Y 국채금리
  ]);

  // ── S&P500 일별 수익률 Map ──
  const sp500RetMap = new Map<string, number>();
  for (let i = 1; i < sp500Rows.length; i++) {
    sp500RetMap.set(sp500Rows[i].date, (sp500Rows[i].close - sp500Rows[i-1].close) / sp500Rows[i-1].close);
  }

  // ── 환율 일별 변화율 Map ──
  const usdkrwRetMap = new Map<string, number>();
  for (let i = 1; i < usdkrwRows.length; i++) {
    usdkrwRetMap.set(usdkrwRows[i].date, (usdkrwRows[i].close - usdkrwRows[i-1].close) / usdkrwRows[i-1].close);
  }

  // ── 국고채 3Y (월별 → forward-fill) ──
  const bondEntries = bondRows
    .map(r => ({ date: r.date, value: r.value - 0.4 }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // ── KRX 투자자 Map ──
  const investorMap = new Map<string, { foreignNet: number; instNet: number }>();
  for (const r of investorRows) investorMap.set(r.date, { foreignNet: r.foreignNet, instNet: r.instNet });

  // ── KRX 공매도 Map + IQR 정규화 기준 계산 ──
  const shortMap = new Map<string, number>();
  for (const r of shortRows) shortMap.set(r.date, r.shortRatio);

  // 공매도 IQR 정규화: (x - median) / IQR → 이상치에 강건한 스케일링
  const shortVals = shortRows.map(r => r.shortRatio).filter(v => v > 0 && isFinite(v)).sort((a, b) => a - b);
  const shortMedian = shortVals.length > 0 ? shortVals[Math.floor(shortVals.length * 0.50)] : 2.0;
  const shortQ1     = shortVals.length > 3  ? shortVals[Math.floor(shortVals.length * 0.25)] : Math.max(0, shortMedian - 1);
  const shortQ3     = shortVals.length > 3  ? shortVals[Math.floor(shortVals.length * 0.75)] : shortMedian + 1;
  const shortIQR    = Math.max(shortQ3 - shortQ1, 0.2);  // 최소 IQR 0.2% 보장
  console.log(`[ext] 공매도 IQR 정규화: median=${shortMedian.toFixed(2)}% Q1=${shortQ1.toFixed(2)} Q3=${shortQ3.toFixed(2)} IQR=${shortIQR.toFixed(2)}`);

  // ── 정규화 기준값 계산 (외국인/기관 순매수 스케일) ──
  const fnetVals = investorRows.map(r => Math.abs(r.foreignNet)).filter(v => v > 0);
  const inetVals = investorRows.map(r => Math.abs(r.instNet)).filter(v => v > 0);
  const fnetScale = fnetVals.length > 0 ? (fnetVals.sort((a,b)=>a-b)[Math.floor(fnetVals.length*0.95)] || 10000) : 10000;
  const inetScale = inetVals.length > 0 ? (inetVals.sort((a,b)=>a-b)[Math.floor(inetVals.length*0.95)] || 10000) : 10000;

  // ── [v13] VIX 5일 모멘텀(회복신호) + 일별 변화율 ──
  const vix5dMomMap2 = new Map<string, number>();
  const vixRetMap2   = new Map<string, number>();
  for (let i = 0; i < vixRows.length; i++) {
    if (i > 0)
      vixRetMap2.set(vixRows[i].date, (vixRows[i].close - vixRows[i-1].close) / (vixRows[i-1].close || 1));
    if (i >= 5)
      vix5dMomMap2.set(vixRows[i].date, (vixRows[i].close - vixRows[i-5].close) / (vixRows[i-5].close || 1));
  }

  // ── [NEW] 미국 10Y-2Y 금리차 Map (forward-fill) ──
  const usb10Entries = usb10Rows.sort((a, b) => a.date.localeCompare(b.date));
  const usb2Entries  = usb2Rows.sort((a, b) => a.date.localeCompare(b.date));

  console.log(`[ext] 완료 — S&P500 ${sp500Rows.length}행, 환율 ${usdkrwRows.length}행, 국고채 ${bondRows.length}행, 투자자 ${investorRows.length}행, 공매도 ${shortRows.length}행, VIX ${vixRows.length}행`);

  // ── KOSPI/KOSDAQ 날짜에 맞춰 forward-fill ──
  const result = new Map<string, ExtPoint>();
  let lastSP500 = 0, lastUSDKRW = 0, lastBond = 3.0;
  let lastForeign = 0, lastInst = 0, lastShort = 0.0;  // IQR 정규화 후 초기값=0(중앙값)
  let lastVix5dMom2 = 0, lastVixRet2 = 0;
  let lastUsb10 = 4.5, lastUsb2 = 4.0;
  let bondIdx = 0, b10Idx2 = 0, b2Idx2 = 0;

  for (const date of dates) {
    while (bondIdx < bondEntries.length && bondEntries[bondIdx].date <= date) {
      lastBond = bondEntries[bondIdx].value; bondIdx++;
    }
    while (b10Idx2 < usb10Entries.length && usb10Entries[b10Idx2].date <= date) {
      lastUsb10 = usb10Entries[b10Idx2].value; b10Idx2++;
    }
    while (b2Idx2 < usb2Entries.length && usb2Entries[b2Idx2].date <= date) {
      lastUsb2 = usb2Entries[b2Idx2].value; b2Idx2++;
    }
    if (sp500RetMap.has(date))   lastSP500      = sp500RetMap.get(date)!;
    if (usdkrwRetMap.has(date))  lastUSDKRW     = usdkrwRetMap.get(date)!;
    if (investorMap.has(date)) {
      const iv = investorMap.get(date)!;
      lastForeign = iv.foreignNet;
      lastInst    = iv.instNet;
    }
    if (shortMap.has(date))        lastShort      = Math.max(-3, Math.min(3, (shortMap.get(date)! - shortMedian) / shortIQR));
    if (vix5dMomMap2.has(date))    lastVix5dMom2  = vix5dMomMap2.get(date)!;
    if (vixRetMap2.has(date))      lastVixRet2    = vixRetMap2.get(date)!;

    result.set(date, {
      sp500Ret:    lastSP500,
      usdkrwRet:   lastUSDKRW,
      bond3y:      lastBond,
      foreignNet:  lastForeign / fnetScale,  // ≈ −1 ~ +1
      instNet:     lastInst    / inetScale,  // ≈ −1 ~ +1
      shortRatio:  lastShort,                // IQR 정규화 (−3~+3)
      vix5dMom:    lastVix5dMom2,            // [v13] VIX 5일 모멘텀 (음수=회복신호)
      vixRet:      lastVixRet2,              // VIX 일별 변화율
      yieldSpread: lastUsb10 - lastUsb2,     // 10Y-2Y 금리차
    });
  }

  return result;
}

// ─── Feature engineering (기술적 9 + 매크로 3 + 수급 3 = 15) ─────────────────

function rollingMean(arr: number[], w: number, i: number) {
  let s = 0, n = 0; for (let k = Math.max(0, i-w+1); k <= i; k++) { s += arr[k]; n++; } return s / n;
}
function rollingStdFn(arr: number[], w: number, i: number) {
  const sl = arr.slice(Math.max(0, i-w+1), i+1);
  const m = sl.reduce((a, b) => a+b, 0) / sl.length;
  return Math.sqrt(sl.reduce((a, b) => a+(b-m)**2, 0) / sl.length) || 1e-8;
}
function rsiNorm(rets: number[], w: number, i: number) {
  if (i < w) return 0.5;
  let g = 0, l = 0;
  for (let k = i-w+1; k <= i; k++) rets[k] > 0 ? (g += rets[k]) : (l -= rets[k]);
  g /= w; l /= w; return l < 1e-10 ? 1 : 1 - 1/(1 + g/l);
}

function buildFeatures(
  rows: { date: string; close: number; volume: number }[],
  extMap: Map<string, ExtPoint>,
): { feats: Float64Array[]; closes: number[]; dates: string[] } {
  const closes  = rows.map(r => r.close);
  const volumes = rows.map(r => r.volume);
  const dates   = rows.map(r => r.date);
  const rets   = closes.map((c, i) => i === 0 ? 0 : (c - closes[i-1]) / closes[i-1]);

  // ── MACD: EMA12, EMA26, Signal(EMA9 of MACD) ──────────────────────────────
  const a12 = 2 / (12 + 1), a26 = 2 / (26 + 1), a9 = 2 / (9 + 1);
  const ema12 = new Float64Array(closes.length);
  const ema26 = new Float64Array(closes.length);
  const macdLine   = new Float64Array(closes.length);
  const macdSignal = new Float64Array(closes.length);
  ema12[0] = closes[0]; ema26[0] = closes[0];
  for (let i = 1; i < closes.length; i++) {
    ema12[i]    = a12 * closes[i] + (1 - a12) * ema12[i-1];
    ema26[i]    = a26 * closes[i] + (1 - a26) * ema26[i-1];
    macdLine[i] = ema12[i] - ema26[i];
  }
  macdSignal[0] = macdLine[0];
  for (let i = 1; i < closes.length; i++) {
    macdSignal[i] = a9 * macdLine[i] + (1 - a9) * macdSignal[i-1];
  }

  const feats  = rows.map((row, i): Float64Array => {
    const ma5       = rollingMean(closes, 5,  i);
    const ma20      = rollingMean(closes, 20, i);
    const std20     = rollingStdFn(rets, 20, i);
    // 볼린저밴드 %B: (close - lower) / (upper - lower), price std 기반으로 수정
    const std20P    = rollingStdFn(closes, 20, i);
    const bband     = std20P > 1e-8 && ma20 > 0
      ? Math.max(0, Math.min(1, (closes[i] - (ma20 - 2*std20P)) / (4*std20P)))
      : 0.5;
    const mom5  = i>=5  ? closes[i]/closes[i-5]  - 1 : 0;
    const mom10 = i>=10 ? closes[i]/closes[i-10] - 1 : 0;
    const ext   = extMap.get(row.date) ?? { sp500Ret:0, usdkrwRet:0, bond3y:3.0, foreignNet:0, instNet:0, shortRatio:0, vix5dMom:0, vixRet:0, yieldSpread:0.5 };
    const p     = closes[i] || 1e-8;
    // ── 거래량 피처 ──
    const volMa5   = rollingMean(volumes, 5,  i);
    const volMa20  = rollingMean(volumes, 20, i);
    const volRet5  = volMa5  > 0 ? volumes[i] / volMa5  - 1 : 0;  // 거래량 5일 모멘텀
    const relVol20 = volMa20 > 0 ? volumes[i] / volMa20 - 1 : 0;  // 상대 거래량 (vs MA20)
    const signedVol = Math.max(-1, Math.min(1, Math.sign(rets[i]) * Math.max(0, relVol20))); // 방향 가중 거래량
    return new Float64Array([
      // ── 기술적 (11) ──
      rets[i],
      ma5>0  ? closes[i]/ma5  - 1 : 0,
      ma20>0 ? closes[i]/ma20 - 1 : 0,
      rsiNorm(rets, 14, i),
      rollingStdFn(rets, 5,  i),
      rollingStdFn(rets, 20, i),
      Math.max(0, Math.min(1, bband)),
      mom5, mom10,
      macdLine[i]   / p,     // MACD Line / price (트렌드 강도)
      macdSignal[i] / p,     // MACD Signal / price (트렌드 방향 확인)
      // ── 거래량 (3) [v15] ──
      Math.max(-3, Math.min(3, volRet5)),    // 거래량 5일 모멘텀 (급등=양수)
      Math.max(-3, Math.min(3, relVol20)),   // 상대 거래량 vs MA20
      signedVol,                             // 방향 가중 거래량 (−1~+1)
      // ── 매크로 (3) ──
      ext.sp500Ret,          // S&P500 등락 / SNP용: DXY
      ext.usdkrwRet,         // 환율 변화율
      ext.bond3y / 10,       // 국고채3Y /10 / SNP용: 미국10Y/10
      // ── 수급 (3) / SNP전용(v16): 나스닥·러셀 ──
      ext.foreignNet,        // 외국인 순매수 (−1~+1) / SNP=나스닥 일별 수익률 (−1~+1)
      ext.instNet,           // 기관 순매수   (−1~+1) / SNP=러셀2000 일별 수익률 (−1~+1)
      ext.shortRatio,        // 공매도 IQR정규화 (−3~+3) / SNP=나스닥 5일 모멘텀 (−3~+3)
      // ── 글로벌 변동성/금리 (3) ──
      Math.max(-1, Math.min(1, ext.vix5dMom / 0.3)), // VIX 5일 모멘텀 (낙폭=음수=회복신호, ±30% → ±1)
      ext.vixRet,            // VIX 일별 변화율 (당일 공포 가속도, −0.2~+0.2)
      ext.yieldSpread / 3,   // 10Y-2Y 금리차 /3 (−1~+1 범위)
    ]);
  });
  return { feats, closes, dates };
}

// ─── GBDT sequence generation ─────────────────────────────────────────────────

function makeSeqs(feats: Float64Array[], closes: number[], lookback: number, horizon: number) {
  const F = feats[0].length;
  const Xs: Float64Array[] = [], ys: number[] = [], anchors: number[] = [];
  for (let i = lookback; i < feats.length - horizon; i++) {
    const v = new Float64Array(lookback * F + 1);
    for (let t = 0; t < lookback; t++) for (let f = 0; f < F; f++) v[t*F+f] = feats[i-lookback+t][f];
    v[lookback*F] = 1;
    Xs.push(v); ys.push((closes[i+horizon]-closes[i])/closes[i]); anchors.push(i);
  }
  return { X: Xs, y: new Float64Array(ys), anchorDateIdxs: anchors };
}

// ─── Standardisation ─────────────────────────────────────────────────────────

function standardize(X: Float64Array[]) {
  const n=X.length, F=X[0].length;
  const mu=new Float64Array(F), sigma=new Float64Array(F);
  for (const row of X) for (let j=0;j<F;j++) mu[j]+=row[j];
  for (let j=0;j<F;j++) mu[j]/=n;
  for (const row of X) for (let j=0;j<F;j++) sigma[j]+=(row[j]-mu[j])**2;
  for (let j=0;j<F;j++) sigma[j]=Math.sqrt(sigma[j]/n)||1;
  const Xn=X.map(row=>{const r=new Float64Array(row.length);for(let j=0;j<row.length;j++)r[j]=(row[j]-mu[j])/sigma[j];return r;});
  return {Xn,mu,sigma};
}
function applyStd(X: Float64Array[], mu: Float64Array, sigma: Float64Array): Float64Array[] {
  return X.map(row=>{const r=new Float64Array(row.length);for(let j=0;j<row.length;j++)r[j]=(row[j]-mu[j])/sigma[j];return r;});
}

// ─── GBDT ────────────────────────────────────────────────────────────────────

type DNode = { fi: number; thresh: number; left: DNode | number; right: DNode | number };

function dtPredict(node: DNode|number, x: Float64Array): number {
  if (typeof node==="number") return node;
  return x[node.fi]<=node.thresh ? dtPredict(node.left,x) : dtPredict(node.right,x);
}

function buildNode(X:Float64Array[],res:number[],idxs:number[],depth:number,minLeaf:number,rng:()=>number,ff:number,nBins:number):DNode|number {
  const n=idxs.length;
  if (depth===0||n<minLeaf*2){let s=0;for(const i of idxs)s+=res[i];return s/n;}
  const F=X[0].length, nUsed=Math.max(1,Math.floor(F*ff));
  const fIdxs=Array.from({length:F},(_,i)=>i).sort(()=>rng()-0.5).slice(0,nUsed);
  let totSum=0,totSumSq=0;
  for(const i of idxs){totSum+=res[i];totSumSq+=res[i]*res[i];}
  const totMse=totSumSq/n-(totSum/n)**2;
  let bestGain=1e-9,bestFi=-1,bestThresh=0,bestLeft:number[]=[],bestRight:number[]=[];
  for(const fi of fIdxs){
    const sorted=idxs.slice().sort((a,b)=>X[a][fi]-X[b][fi]);
    let lSum=0,lSumSq=0;
    const step=Math.max(1,Math.floor(n/nBins));
    for(let k=1;k<n;k++){
      lSum+=res[sorted[k-1]];lSumSq+=res[sorted[k-1]]**2;
      if(k%step!==0&&k!==n-minLeaf)continue;
      if(k<minLeaf||k>n-minLeaf)continue;
      if(X[sorted[k]][fi]===X[sorted[k-1]][fi])continue;
      const nl=k,nr=n-k;
      const rSum=totSum-lSum,rSumSq=totSumSq-lSumSq;
      const gain=totMse-(nl*(lSumSq/nl-(lSum/nl)**2)+nr*(rSumSq/nr-(rSum/nr)**2))/n;
      if(gain>bestGain){bestGain=gain;bestFi=fi;bestThresh=(X[sorted[k-1]][fi]+X[sorted[k]][fi])/2;bestLeft=sorted.slice(0,k);bestRight=sorted.slice(k);}
    }
  }
  if(bestFi<0){let s=0;for(const i of idxs)s+=res[i];return s/n;}
  return{fi:bestFi,thresh:bestThresh,
    left:buildNode(X,res,bestLeft,depth-1,minLeaf,rng,ff,nBins),
    right:buildNode(X,res,bestRight,depth-1,minLeaf,rng,ff,nBins)};
}

function gbdtFit(X:Float64Array[],y:Float64Array,seed:number,hp:IndexHP):GBDTModel {
  const rng=makeRng(seed),n=X.length;
  let basePred=0;for(let i=0;i<n;i++)basePred+=y[i];basePred/=n;
  const preds=new Float64Array(n).fill(basePred),trees:any[]=[];
  const rowBag=Math.floor(n*hp.gbdtSsub);
  for(let t=0;t<hp.gbdtTrees;t++){
    const res=Array.from({length:n},(_,i)=>y[i]-preds[i]);
    const idxs=Array.from({length:n},(_,i)=>i).sort(()=>rng()-0.5).slice(0,rowBag);
    const tree=buildNode(X,res,idxs,hp.gbdtDepth,hp.gbdtLeaf,rng,hp.gbdtFsub,GBDT_BINS);
    trees.push(tree);
    for(let i=0;i<n;i++)preds[i]+=hp.gbdtLR*dtPredict(tree,X[i]);
  }
  return{trees,lr:hp.gbdtLR,basePred};
}
function gbdtPredict(model:GBDTModel,X:Float64Array[]):Float64Array {
  return new Float64Array(X.map(x=>{let p=model.basePred;for(const t of model.trees)p+=model.lr*dtPredict(t as DNode|number,x);return p;}));
}
function incrementalAddTrees(model:GBDTModel,X:Float64Array[],y:Float64Array,nTrees:number,seed:number,hp:IndexHP):GBDTModel {
  if(X.length===0)return model;
  const rng=makeRng(seed),n=X.length,rowBag=Math.max(1,Math.floor(n*hp.gbdtSsub));
  const preds=gbdtPredict(model,X),newTrees:any[]=[];
  for(let t=0;t<nTrees;t++){
    const res=Array.from({length:n},(_,i)=>y[i]-preds[i]);
    const idxs=Array.from({length:n},(_,i)=>i).sort(()=>rng()-0.5).slice(0,Math.min(rowBag,n));
    const tree=buildNode(X,res,idxs,hp.gbdtDepth,hp.gbdtLeaf,rng,hp.gbdtFsub,GBDT_BINS);
    newTrees.push(tree);
    for(let i=0;i<n;i++)preds[i]+=model.lr*dtPredict(tree as DNode|number,X[i]);
  }
  return{...model,trees:[...model.trees,...newTrees]};
}

// ─── LSTM ────────────────────────────────────────────────────────────────────

function computeLSTMScaler(feats: Float64Array[]) {
  const F=feats[0].length,n=feats.length;
  const mu=new Float64Array(F),sigma=new Float64Array(F);
  for(const f of feats)for(let j=0;j<F;j++)mu[j]+=f[j];
  for(let j=0;j<F;j++)mu[j]/=n;
  for(const f of feats)for(let j=0;j<F;j++)sigma[j]+=(f[j]-mu[j])**2;
  for(let j=0;j<F;j++)sigma[j]=Math.sqrt(sigma[j]/n)||1;
  return{mu,sigma};
}

function makeSeqs3D(
  feats: Float64Array[], closes: number[],
  mu: Float64Array, sigma: Float64Array,
  lookback: number, horizon: number,
): { X3d: number[][][]; y: Float64Array; anchorDateIdxs: number[] } {
  const X3d:number[][][]=[],ys:number[]=[],anchors:number[]=[];
  for(let i=lookback;i<feats.length-horizon;i++){
    const seq:number[][]=[];
    for(let t=0;t<lookback;t++){
      seq.push(Array.from(feats[i-lookback+t]).map((v,j)=>(v-mu[j])/sigma[j]));
    }
    X3d.push(seq); ys.push((closes[i+horizon]-closes[i])/closes[i]); anchors.push(i);
  }
  return{X3d,y:new Float64Array(ys),anchorDateIdxs:anchors};
}

function buildLSTMArch(drop = 0.2): tf.LayersModel {
  const input = tf.input({ shape: [LOOKBACK, N_FEATURES] });

  // LSTM — returnSequences=true for attention
  const lstmOut = tf.layers.lstm({
    units: LSTM_UNITS, returnSequences: true,
    dropout: drop, recurrentDropout: drop / 2,
  }).apply(input) as tf.SymbolicTensor;                             // [B, T, LSTM_UNITS]

  // Additive self-attention: score per timestep
  const attnLogits = tf.layers.timeDistributed({
    layer: tf.layers.dense({ units: 1, activation: "tanh" }),
  }).apply(lstmOut) as tf.SymbolicTensor;                           // [B, T, 1]
  const attnFlat    = tf.layers.reshape({ targetShape: [LOOKBACK] })
                        .apply(attnLogits)   as tf.SymbolicTensor; // [B, T]
  const attnWeights = tf.layers.softmax()
                        .apply(attnFlat)     as tf.SymbolicTensor; // [B, T]

  // Weighted context: [B,1,T] · [B,T,D] → [B,1,D] → [B,D]
  const attnRow = tf.layers.reshape({ targetShape: [1, LOOKBACK] })
                    .apply(attnWeights) as tf.SymbolicTensor;      // [B, 1, T]
  const ctxRaw  = tf.layers.dot({ axes: [2, 1] })
                    .apply([attnRow, lstmOut]) as tf.SymbolicTensor; // [B, 1, D]
  const context = tf.layers.reshape({ targetShape: [LSTM_UNITS] })
                    .apply(ctxRaw) as tf.SymbolicTensor;           // [B, D]

  const dense1  = tf.layers.dense({ units: LSTM_DENSE, activation: "relu" }).apply(context) as tf.SymbolicTensor;
  const dropped = tf.layers.dropout({ rate: drop / 2 }).apply(dense1) as tf.SymbolicTensor;
  const output  = tf.layers.dense({ units: 1 }).apply(dropped) as tf.SymbolicTensor;

  return tf.model({ inputs: input, outputs: output });
}

function saveLSTMWeights(model: tf.LayersModel): LSTMWeightLayer[][] {
  return model.layers.map(layer =>
    layer.getWeights().map(w => ({ shape: w.shape, data: Array.from(w.dataSync()) }))
  );
}

function loadLSTMFromWeights(weightsData: LSTMWeightLayer[][]): tf.LayersModel {
  const model = buildLSTMArch();
  model.layers.forEach((layer, i) => {
    if (weightsData[i]?.length > 0) {
      const tensors = weightsData[i].map(w => tf.tensor(w.data, w.shape));
      try { layer.setWeights(tensors); } finally { tensors.forEach(t => t.dispose()); }
    }
  });
  return model;
}

async function trainLSTM(
  X3d_train: number[][][], y_train: Float64Array,
  X3d_val:   number[][][], y_val:   Float64Array,
  hp: IndexHP,
): Promise<tf.LayersModel> {
  await tf.ready();
  const model = buildLSTMArch(hp.lstmDrop);
  model.compile({ optimizer: tf.train.adam(hp.lstmLR), loss: "meanSquaredError" });

  const xTrain = tf.tensor3d(X3d_train);
  const yTrain = tf.tensor2d(Array.from(y_train), [y_train.length, 1]);
  const xVal   = tf.tensor3d(X3d_val);
  const yVal   = tf.tensor2d(Array.from(y_val),   [y_val.length,   1]);

  // Early stopping: val_loss가 patience 에포크 연속 개선 없으면 조기 종료
  let bestValLoss = Infinity, patience = 10, noImproveCount = 0;
  let bestWeights: LSTMWeightLayer[][] | null = null;

  try {
    await model.fit(xTrain, yTrain, {
      epochs: hp.lstmEpochs, batchSize: LSTM_BATCH,
      validationData: [xVal, yVal], verbose: 0,
      callbacks: {
        onEpochEnd: async (epoch: number, logs: any) => {
          const valLoss: number = logs?.val_loss ?? Infinity;
          if (epoch % 5 === 4)
            console.log(`[lstm] epoch ${epoch+1}/${hp.lstmEpochs} loss=${logs?.loss?.toFixed(4)} val=${valLoss.toFixed(4)}`);
          if (valLoss < bestValLoss - 1e-6) {
            bestValLoss = valLoss;
            noImproveCount = 0;
            bestWeights = saveLSTMWeights(model);
          } else {
            noImproveCount++;
            if (noImproveCount >= patience) {
              console.log(`[lstm] early stop @ epoch ${epoch+1} (best val=${bestValLoss.toFixed(4)})`);
              model.stopTraining = true;
            }
          }
        },
      },
    });
  } finally {
    xTrain.dispose(); yTrain.dispose(); xVal.dispose(); yVal.dispose();
  }

  // best weights 복원
  if (bestWeights) {
    model.layers.forEach((layer, i) => {
      const wd = bestWeights![i];
      if (wd?.length > 0) {
        const tensors = wd.map(w => tf.tensor(w.data, w.shape));
        try { layer.setWeights(tensors); } finally { tensors.forEach(t => t.dispose()); }
      }
    });
  }
  return model;
}

function lstmPredict(model: tf.LayersModel, X3d: number[][][]): Float64Array {
  if (X3d.length === 0) return new Float64Array(0);
  const input = tf.tensor3d(X3d);
  const output = model.predict(input) as tf.Tensor;
  const data = new Float64Array(output.dataSync());
  input.dispose(); output.dispose();
  return data;
}

// ─── Data fetch ───────────────────────────────────────────────────────────────

async function fetchHistory(symbol: string, years = YEARS_DATA) {
  const yahoo = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
  const end = new Date(), start = new Date();
  start.setFullYear(start.getFullYear() - years);
  const r = await (yahoo as any).chart(symbol, { period1: start, period2: end, interval: "1d" });
  return (r.quotes ?? [])
    .filter((q: any) => q.close != null)
    .map((q: any) => ({
      date:   new Date(q.date).toISOString().slice(0, 10),
      close:  q.close  as number,
      volume: (q.volume ?? 0) as number,
    }));
}

// ─── Core result builder ──────────────────────────────────────────────────────

function buildResultFromModel(
  symbol: string, name: string,
  rows: { date: string; close: number; volume: number }[],
  extMap: Map<string, ExtPoint>,
  gbdtModels: GBDTModel[], gbdtScaler: { mu: Float64Array; sigma: Float64Array },
  lstmModel: tf.LayersModel, lstmScaler: { mu: Float64Array; sigma: Float64Array },
  storedAlpha: number,
  recentWindow = 30,
): IndexResult {
  const { feats, closes, dates } = buildFeatures(rows, extMap);

  const { X, y, anchorDateIdxs } = makeSeqs(feats, closes, LOOKBACK, PRED_H);
  const n = X.length;
  const trainEnd = Math.floor(n * 0.80);
  const Xte  = X.slice(trainEnd);  const yte = y.slice(trainEnd);
  const XteN = applyStd(Xte, gbdtScaler.mu, gbdtScaler.sigma);

  const gbdtPreds = new Float64Array(Xte.length);
  for (const m of gbdtModels) {
    const p = gbdtPredict(m, XteN);
    for (let i = 0; i < p.length; i++) gbdtPreds[i] += p[i] / gbdtModels.length;
  }

  const { X3d } = makeSeqs3D(feats, closes, lstmScaler.mu, lstmScaler.sigma, LOOKBACK, PRED_H);
  const X3d_test = X3d.slice(trainEnd);
  const lstmPreds = lstmPredict(lstmModel, X3d_test);

  const lastN = Math.min(recentWindow, gbdtPreds.length);
  const g30 = dirAccRate(gbdtPreds.slice(-lastN), Array.from(yte).slice(-lastN));
  const l30 = dirAccRate(lstmPreds.slice(-lastN),  Array.from(yte).slice(-lastN));

  // "랜덤 대비 스킬" 기반 가중치: 50%에서의 초과분 기준으로 알파 계산
  // LSTM이 50%(랜덤) 수준이면 alpha ≈ 0 → GBDT가 거의 전부 가져감
  const lstmSkill = Math.max(0, l30 - 0.50);
  const gbdtSkill = Math.max(0, g30 - 0.50);
  const rawAlpha  = lstmSkill + gbdtSkill > 1e-6 ? lstmSkill / (lstmSkill + gbdtSkill) : 0.5;

  // ── 레짐 감지: 실현 변동성 백분위로 시장 상태 분류 ──────────────────────────
  // calm(<33%ile)  → GBDT 주도 (추세추종 유효)
  // normal(33~67%) → 균형 앙상블
  // crisis(>67%ile)→ LSTM 주도 (패닉 패턴 기억)
  const histRets  = closes.map((c, i) => i === 0 ? 0 : (c - closes[i-1]) / closes[i-1]);
  const allVol20  = histRets.map((_, i) => rollingStdFn(histRets, 20, i)).filter(v => v > 1e-10);
  const sortedVol = [...allVol20].sort((a, b) => a - b);
  const curVol20  = rollingStdFn(histRets, 20, histRets.length - 1);
  const volPct    = sortedVol.length > 0 ? sortedVol.filter(v => v <= curVol20).length / sortedVol.length : 0.5;
  const [alphaMin, alphaMax] = volPct < 0.33 ? [0.05, 0.40]   // calm  — GBDT 모드
                             : volPct > 0.67 ? [0.20, 0.75]   // crisis — LSTM 모드
                             :                 [0.10, 0.60];   // normal — 균형
  const regimeLabel = volPct < 0.33 ? "calm" : volPct > 0.67 ? "crisis" : "normal";
  const alpha = Math.max(alphaMin, Math.min(alphaMax, rawAlpha));
  console.log(`[regime] ${symbol} volPct=${(volPct*100).toFixed(0)}% regime=${regimeLabel} α=[${alphaMin}~${alphaMax}]→${alpha.toFixed(3)}`);

  // 안전장치: LSTM 예측이 GBDT 대비 3배 초과하면 방향 유지 채 압축
  // (LSTM이 역방향 큰 값을 예측할 때 앙상블 플립 방지)
  const safeLstmPreds = new Float64Array(lstmPreds.length);
  for (let i = 0; i < lstmPreds.length; i++) {
    const gAbs = Math.abs(gbdtPreds[i]);
    const lAbs = Math.abs(lstmPreds[i]);
    safeLstmPreds[i] = gAbs > 1e-10 && lAbs > gAbs * 3
      ? Math.sign(lstmPreds[i]) * gAbs * 2
      : lstmPreds[i];
  }

  const testPreds = new Float64Array(gbdtPreds.length);
  for (let i = 0; i < testPreds.length; i++) testPreds[i] = alpha * safeLstmPreds[i] + (1-alpha) * gbdtPreds[i];

  // ── 5-폴드 시계열 워크포워드 검증 ────────────────────────────────────────────
  // 테스트 예측을 동일 크기 5구간으로 나눠 각 구간 정확도 평균 → 시간축 안정성 측정
  const nTest  = testPreds.length;
  const K_WF   = 5;
  const wfWin  = Math.max(1, Math.floor(nTest / K_WF));
  const wfAccs: number[] = [];
  for (let k = 0; k < K_WF; k++) {
    const s = k * wfWin;
    const e = k < K_WF - 1 ? s + wfWin : nTest;
    if (e > s) wfAccs.push(dirAccRate(testPreds.slice(s, e), Array.from(yte).slice(s, e)));
  }
  const wfDirAccVal = wfAccs.length > 0 ? wfAccs.reduce((a, b) => a + b, 0) / wfAccs.length : 0;

  let mae = 0;
  for (let i = 0; i < nTest; i++) mae += Math.abs(testPreds[i] - yte[i]);
  mae /= nTest || 1;

  // ── 진폭 교정 계수 (Amplitude Calibration) ──────────────────────────────────
  // 회귀 모델은 MSE 최소화 과정에서 예측 진폭이 실제 대비 1/5~1/10로 수렴함.
  // 테스트셋 기준 mean(|실제|) / mean(|예측|) 로 교정 계수를 계산해 적용.
  const meanAbsActual = Array.from(yte).reduce((s,v) => s + Math.abs(v), 0) / (nTest || 1);
  const meanAbsPred   = Array.from(testPreds).reduce((s,v) => s + Math.abs(v), 0) / (nTest || 1);
  // 최대 8배로 제한 (과도한 증폭 방지), 모델이 완전히 0 예측 시 1 유지
  const calibFactor   = meanAbsPred > 1e-6 ? Math.min(8, meanAbsActual / meanAbsPred) : 1;

  const last30Preds  = Array.from(testPreds).slice(-lastN);
  const last30Actual = Array.from(yte).slice(-lastN);
  // 교정된 오차로 신뢰구간 계산
  const recentErrors = last30Actual.map((a, i) => a - last30Preds[i] * calibFactor);

  // recentPerf 차트: 교정된 예측값 사용
  const recentPerf: RecentPerfPoint[] = last30Preds.map((pred, m) => {
    const j = nTest - lastN + m;
    const anchorIdx = anchorDateIdxs[trainEnd + j];
    return { date: dates[anchorIdx]??`D${m}`, predicted: +(pred*calibFactor*100).toFixed(2), actual: +(last30Actual[m]*100).toFixed(2) };
  });

  const lastGBDT_Xn = applyStd([X[n-1]], gbdtScaler.mu, gbdtScaler.sigma);
  const gbdtForecast = gbdtModels.map(m => gbdtPredict(m, lastGBDT_Xn)[0]).reduce((a,b)=>a+b,0) / gbdtModels.length;

  const lastSeq3d: number[][] = [];
  for (let t = 0; t < LOOKBACK; t++) {
    lastSeq3d.push(Array.from(feats[feats.length - LOOKBACK + t]).map((v,j) => (v - lstmScaler.mu[j]) / lstmScaler.sigma[j]));
  }
  const lstmForecastRaw = lstmPredict(lstmModel, [lastSeq3d])[0];
  // 예측 안전장치: LSTM이 GBDT 대비 3배 초과하면 압축
  const gfAbs = Math.abs(gbdtForecast);
  const lstmForecast = gfAbs > 1e-10 && Math.abs(lstmForecastRaw) > gfAbs * 3
    ? Math.sign(lstmForecastRaw) * gfAbs * 2
    : lstmForecastRaw;
  // 교정 계수 적용: 방향 유지, 진폭을 실제 시장 수준으로 스케일업
  const forecastReturn = (alpha * lstmForecast + (1-alpha) * gbdtForecast) * calibFactor;

  const curVal    = closes[closes.length-1];
  const pred3d    = curVal * (1 + forecastReturn);
  const bandPrice = stddev(recentErrors) * curVal;

  const futureDates: string[] = [];
  const cur = new Date(dates[dates.length-1] + "T00:00:00");
  while (futureDates.length < PRED_H) {
    cur.setDate(cur.getDate()+1);
    if (cur.getDay()!==0&&cur.getDay()!==6) futureDates.push(cur.toISOString().slice(0,10));
  }

  return {
    symbol, name,
    historical: dates.slice(-90).map((date,i)=>({date,value:+closes[closes.length-90+i].toFixed(2)})),
    predictions: futureDates.map((date,i)=>{
      const frac=(i+1)/PRED_H, v=curVal+(pred3d-curVal)*frac;
      return{date,value:+v.toFixed(2),lower:+(v-bandPrice).toFixed(2),upper:+(v+bandPrice).toFixed(2)};
    }),
    currentValue: +curVal.toFixed(2),
    predictedReturn3d: +(forecastReturn*100).toFixed(2),
    trend: forecastReturn>=0?"up":"down",
    testMae: +(mae*100).toFixed(3),
    testDirAcc: +(dirAccRate(testPreds,yte)*100).toFixed(1),
    wfDirAcc: +(wfDirAccVal*100).toFixed(1),
    rolling30dDirAcc: +(dirAccRate(last30Preds,last30Actual)*100).toFixed(1),
    predErrStd: +(stddev(recentErrors)*100).toFixed(3),
    recentPerf,
    lstmDirAcc: +(l30*100).toFixed(1),
    gbdtDirAcc: +(g30*100).toFixed(1),
    ensembleAlpha: +alpha.toFixed(3),
  };
}

// ─── Full training ────────────────────────────────────────────────────────────

async function trainFull(
  symbol: string, name: string,
  rows: { date: string; close: number; volume: number }[],
  market: "KOSPI" | "KOSDAQ" | "SNP",
) {
  const hp = getHP(symbol);
  console.log(`[train] ${symbol} HP: gbdtTrees=${hp.gbdtTrees} depth=${hp.gbdtDepth} leaf=${hp.gbdtLeaf} nEns=${hp.nEnsemble} lstmEpochs=${hp.lstmEpochs} lstmLR=${hp.lstmLR}`);

  const extMap = await fetchExternalData(rows.map(r => r.date), market);
  const { feats, closes } = buildFeatures(rows, extMap);

  const { X, y } = makeSeqs(feats, closes, LOOKBACK, PRED_H);
  const n = X.length, trainEnd = Math.floor(n*0.80);
  const { Xn: XtrN, mu: gbdtMu, sigma: gbdtSig } = standardize(X.slice(0, trainEnd));
  const gbdtModels = Array.from({length:hp.nEnsemble}, (_,e) => gbdtFit(XtrN, y.slice(0,trainEnd), e*37+13, hp));

  const lstmScaler = computeLSTMScaler(feats.slice(0, trainEnd+LOOKBACK));
  const { X3d } = makeSeqs3D(feats, closes, lstmScaler.mu, lstmScaler.sigma, LOOKBACK, PRED_H);
  const valSplit  = Math.floor(trainEnd * 0.9);
  const lstmModel = await trainLSTM(
    X3d.slice(0, valSplit),        y.slice(0, valSplit),
    X3d.slice(valSplit, trainEnd), y.slice(valSplit, trainEnd),
    hp,
  );

  const symKey = symbol.replace(/[\^]/g,"");
  saveModelFile(symKey, {
    nFeatures: N_FEATURES,
    gbdtModels,
    gbdtScaler: { mu: Array.from(gbdtMu), sigma: Array.from(gbdtSig) },
    lstmWeights: saveLSTMWeights(lstmModel),
    lstmScaler:  { mu: Array.from(lstmScaler.mu), sigma: Array.from(lstmScaler.sigma) },
    ensembleAlpha: 0.5,
  });

  const result = buildResultFromModel(
    symbol, name, rows, extMap,
    gbdtModels, { mu: gbdtMu, sigma: gbdtSig },
    lstmModel, { mu: lstmScaler.mu, sigma: lstmScaler.sigma },
    0.5,
    hp.recentWindow,
  );
  lstmModel.dispose();
  return result;
}

// ─── DB 캐시 (재배포 후에도 예측값 즉시 표시) ───────────────────────────────

const DB_CACHE_KEY = "lstm_pipeline_result_v3";
const DB_CACHE_TTL_DAYS = 7;

async function saveResultsToDB(kospi: IndexResult, kosdaq: IndexResult, snp500: IndexResult, nasdaq?: IndexResult): Promise<void> {
  try {
    const expires = new Date();
    expires.setDate(expires.getDate() + DB_CACHE_TTL_DAYS);
    const payload = JSON.stringify({ kospi, kosdaq, snp500, nasdaq, savedAt: new Date().toISOString() });
    await pool.query(
      `INSERT INTO system_cache (key, data, expires_at)
       VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, expires_at = EXCLUDED.expires_at`,
      [DB_CACHE_KEY, payload, expires.toISOString()],
    );
    console.log("[pipeline] 예측 결과 DB 저장 완료 (KOSPI+KOSDAQ+S&P500+NASDAQ)");
  } catch (e: any) {
    console.warn("[pipeline] DB 저장 실패 (무시):", e?.message);
  }
}

export async function tryRestoreFromDB(): Promise<boolean> {
  try {
    const r = await pool.query<{ data: { kospi: IndexResult; kosdaq: IndexResult; snp500?: IndexResult; nasdaq?: IndexResult; savedAt: string } }>(
      `SELECT data FROM system_cache WHERE key = $1 AND expires_at > NOW()`,
      [DB_CACHE_KEY],
    );
    const row = r.rows[0]?.data;
    if (!row?.kospi || !row?.kosdaq) return false;

    _status = {
      running: false, ready: true,
      steps: defaultSteps().map(s => ({ ...s, status: "done" as const })),
      trainedAt: row.savedAt, trainingMs: 0,
      kospi: row.kospi, kosdaq: row.kosdaq, snp500: row.snp500, nasdaq: row.nasdaq,
    };
    _lastRun = Date.now();
    console.log(`[pipeline] DB 캐시 복원 완료 (savedAt=${row.savedAt})`);
    return true;
  } catch (e: any) {
    console.warn("[pipeline] DB 캐시 복원 실패:", e?.message);
    return false;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function getStatus(): PipelineStatus & { initializing?: boolean } {
  return {
    running:_status.running, ready:_status.ready,
    steps:_status.steps.map(s=>({...s})),
    error:_status.error, trainedAt:_status.trainedAt,
    trainingMs:_status.trainingMs, kospi:_status.kospi, kosdaq:_status.kosdaq, snp500:_status.snp500, nasdaq:_status.nasdaq,
    initializing: (_status as any).initializing ?? false,
  };
}

export async function tryRestoreFromDisk(): Promise<boolean> {
  const meta        = loadMeta();
  const kospiStore  = loadModelFile("KS11");
  const kosdaqStore = loadModelFile("KQ11");
  const snpStore    = loadModelFile("GSPC");
  if (!meta||!kospiStore||!kosdaqStore||!snpStore) return false;

  if (!kospiStore.lstmWeights || !kosdaqStore.lstmWeights || !snpStore.lstmWeights) {
    console.log("[gbdt] 구형 모델 (lstmWeights 없음) — 재학습"); return false;
  }
  if ((kospiStore.nFeatures ?? 9) !== N_FEATURES) {
    console.log(`[gbdt] 피처 수 변경 (${kospiStore.nFeatures ?? "?"}→${N_FEATURES}) — 재학습`);
    return false;
  }
  if ((kospiStore.version ?? 0) < MODEL_VERSION || (kosdaqStore.version ?? 0) < MODEL_VERSION || (snpStore.version ?? 0) < MODEL_VERSION) {
    console.log(`[gbdt] 모델 버전 변경 (v${MODEL_VERSION}) — 재학습`);
    return false;
  }

  // ★ 복원 시작 전에 running: true 로 설정 → 프론트가 자동 재학습 트리거하지 않도록 방어
  _status = { running: true, ready: false, steps: defaultSteps(), initializing: true } as any;
  console.log("[gbdt] 디스크 복원 중 (nFeatures=" + N_FEATURES + ", v" + MODEL_VERSION + ")...");
  try {
    const ixicStore = loadModelFile("IXIC");
    const [kospiRows, kosdaqRows, snpRows, nasdaqRows] = await Promise.all([
      fetchHistory("^KS11", 0.5), fetchHistory("^KQ11", 0.5), fetchHistory("^GSPC", 0.5),
      fetchHistory("^IXIC", 0.5),
    ]);
    const [kospiExtMap, kosdaqExtMap, snpExtMap] = await Promise.all([
      fetchExternalData(kospiRows.map((r: { date: string; close: number }) => r.date), "KOSPI"),
      fetchExternalData(kosdaqRows.map((r: { date: string; close: number }) => r.date), "KOSDAQ"),
      fetchExternalData(snpRows.map((r: { date: string; close: number }) => r.date), "SNP"),
    ]);
    // NASDAQ은 S&P500과 동일한 외부 피처 사용 (SNP 타입)
    const nasdaqExtMap = await fetchExternalData(nasdaqRows.map((r: { date: string; close: number }) => r.date), "SNP");

    const kospi = buildResultFromModel(
      "^KS11","KOSPI",kospiRows,kospiExtMap,
      kospiStore.gbdtModels,
      {mu:new Float64Array(kospiStore.gbdtScaler.mu),sigma:new Float64Array(kospiStore.gbdtScaler.sigma)},
      loadLSTMFromWeights(kospiStore.lstmWeights),
      {mu:new Float64Array(kospiStore.lstmScaler.mu),sigma:new Float64Array(kospiStore.lstmScaler.sigma)},
      kospiStore.ensembleAlpha, getHP("^KS11").recentWindow,
    );
    const kosdaq = buildResultFromModel(
      "^KQ11","KOSDAQ",kosdaqRows,kosdaqExtMap,
      kosdaqStore.gbdtModels,
      {mu:new Float64Array(kosdaqStore.gbdtScaler.mu),sigma:new Float64Array(kosdaqStore.gbdtScaler.sigma)},
      loadLSTMFromWeights(kosdaqStore.lstmWeights),
      {mu:new Float64Array(kosdaqStore.lstmScaler.mu),sigma:new Float64Array(kosdaqStore.lstmScaler.sigma)},
      kosdaqStore.ensembleAlpha, getHP("^KQ11").recentWindow,
    );
    const snp500 = buildResultFromModel(
      "^GSPC","S&P500",snpRows,snpExtMap,
      snpStore.gbdtModels,
      {mu:new Float64Array(snpStore.gbdtScaler.mu),sigma:new Float64Array(snpStore.gbdtScaler.sigma)},
      loadLSTMFromWeights(snpStore.lstmWeights),
      {mu:new Float64Array(snpStore.lstmScaler.mu),sigma:new Float64Array(snpStore.lstmScaler.sigma)},
      snpStore.ensembleAlpha, getHP("^GSPC").recentWindow,
    );
    const nasdaq = ixicStore?.lstmWeights ? buildResultFromModel(
      "^IXIC","NASDAQ",nasdaqRows,nasdaqExtMap,
      ixicStore.gbdtModels,
      {mu:new Float64Array(ixicStore.gbdtScaler.mu),sigma:new Float64Array(ixicStore.gbdtScaler.sigma)},
      loadLSTMFromWeights(ixicStore.lstmWeights),
      {mu:new Float64Array(ixicStore.lstmScaler.mu),sigma:new Float64Array(ixicStore.lstmScaler.sigma)},
      ixicStore.ensembleAlpha, getHP("^IXIC").recentWindow,
    ) : undefined;

    _lastRun = Date.now();
    _status = {
      running:false, ready:true,
      steps:defaultSteps().map(s=>({...s,status:"done" as const})),
      trainedAt:meta.lastTrained, trainingMs:0, kospi, kosdaq, snp500, nasdaq,
    };
    console.log(`[gbdt] 복원 완료 | KOSPI ${kospi.testDirAcc}% | KOSDAQ ${kosdaq.testDirAcc}% | S&P500 ${snp500.testDirAcc}%${nasdaq ? ` | NASDAQ ${nasdaq.testDirAcc}%` : ""}`);
    return true;
  } catch(e:any) { console.warn("[gbdt] 복원 실패:",e?.message); return false; }
}

export async function runPipeline(force=false): Promise<void> {
  const now = Date.now();
  if (_status.running) return;
  if (!force&&_status.ready&&now-_lastRun<CACHE_TTL) return;

  _status = { running:true, ready:false, steps:defaultSteps() };
  const t0 = Date.now();

  try {
    stepSet("data","running");
    const s1=Date.now();
    const [kospiRows,kosdaqRows,snpRows,nasdaqRows]=await Promise.all([fetchHistory("^KS11"),fetchHistory("^KQ11"),fetchHistory("^GSPC"),fetchHistory("^IXIC")]);
    stepSet("data","done",Date.now()-s1);

    stepSet("feature","running"); stepSet("feature","done",0);
    stepSet("lstm","running");
    const sL=Date.now();

    // S&P500 → NASDAQ → KOSPI → KOSDAQ 순차 학습 (TF.js 메모리 안전)
    const snp500Result  = await trainFull("^GSPC","S&P500", snpRows,    "SNP");
    const nasdaqResult  = await trainFull("^IXIC","NASDAQ", nasdaqRows, "SNP");
    const kospiResult   = await trainFull("^KS11","KOSPI",  kospiRows,  "KOSPI");
    const kosdaqResult  = await trainFull("^KQ11","KOSDAQ", kosdaqRows, "KOSDAQ");

    stepSet("lstm","done",Date.now()-sL);
    stepSet("gbdt","running");    stepSet("gbdt","done",0);
    stepSet("ensemble","running"); stepSet("ensemble","done",0);
    stepSet("output","running");   stepSet("output","done",0);

    const trainedAt = new Date().toISOString();
    saveMeta({
      lastTrained:trainedAt, lastUpdated:trainedAt,
      nSamples:{kospi:kospiRows.length,kosdaq:kosdaqRows.length,snp500:snpRows.length,nasdaq:nasdaqRows.length},
      dirAcc:          {kospi:kospiResult.testDirAcc,       kosdaq:kosdaqResult.testDirAcc,       snp500:snp500Result.testDirAcc,       nasdaq:nasdaqResult.testDirAcc},
      wfDirAcc:        {kospi:kospiResult.wfDirAcc,         kosdaq:kosdaqResult.wfDirAcc,         snp500:snp500Result.wfDirAcc,         nasdaq:nasdaqResult.wfDirAcc},
      rolling30dDirAcc:{kospi:kospiResult.rolling30dDirAcc, kosdaq:kosdaqResult.rolling30dDirAcc, snp500:snp500Result.rolling30dDirAcc, nasdaq:nasdaqResult.rolling30dDirAcc},
      updateCount:0,
    });

    _lastRun=now;
    _status={
      running:false,ready:true,steps:_status.steps,
      trainedAt, trainingMs:Date.now()-t0,
      kospi:kospiResult, kosdaq:kosdaqResult, snp500:snp500Result, nasdaq:nasdaqResult,
    };
    console.log(`[pipeline] 완료 ${Date.now()-t0}ms | KOSPI ${kospiResult.testDirAcc}% | KOSDAQ ${kosdaqResult.testDirAcc}% | S&P500 ${snp500Result.testDirAcc}% | NASDAQ ${nasdaqResult.testDirAcc}%`);
    // 재배포 후에도 즉시 표시될 수 있도록 DB에 저장
    saveResultsToDB(kospiResult, kosdaqResult, snp500Result, nasdaqResult).catch(() => {});
  } catch(err:any) {
    console.error("[pipeline] 오류:",err?.message??err);
    const f=_status.steps.find(s=>s.status==="running");
    if(f)f.status="error";
    _status={..._status,running:false,ready:false,error:err?.message??String(err)};
  }
}

export async function runDailyIncrementalUpdate(): Promise<void> {
  if (_status.running){console.log("[gbdt] 학습 중 — 증분 스킵");return;}
  const meta=loadMeta(), kospiStore=loadModelFile("KS11"), kosdaqStore=loadModelFile("KQ11"), snpStore=loadModelFile("GSPC");
  if(!kospiStore||!kosdaqStore||!snpStore||!kospiStore.lstmWeights||(kospiStore.nFeatures??9)!==N_FEATURES){
    console.log("[gbdt] 저장 모델 없음 또는 피처 불일치 → 완전 학습");
    return runPipeline(true);
  }
  console.log("[gbdt] 일일 증분 시작 (GBDT +5트리; LSTM 스킵)");
  const t0=Date.now();
  try {
    const ixicStore = loadModelFile("IXIC");
    const [kospiRows,kosdaqRows,snpRows,nasdaqRows]=await Promise.all([
      fetchHistory("^KS11",0.5),fetchHistory("^KQ11",0.5),fetchHistory("^GSPC",0.5),fetchHistory("^IXIC",0.5),
    ]);
    const lastUpdated=meta?.lastUpdated??"2000-01-01";

    const [kospiExtMap,kosdaqExtMap,snpExtMap]=await Promise.all([
      fetchExternalData(kospiRows.map((r:{date:string;close:number})=>r.date), "KOSPI"),
      fetchExternalData(kosdaqRows.map((r:{date:string;close:number})=>r.date), "KOSDAQ"),
      fetchExternalData(snpRows.map((r:{date:string;close:number})=>r.date), "SNP"),
    ]);
    const nasdaqExtMap = await fetchExternalData(nasdaqRows.map((r:{date:string;close:number})=>r.date), "SNP");

    const lastUpdatedDate = lastUpdated.slice(0, 10);

    function newSamples(rows:{date:string;close:number;volume:number}[], extMap:Map<string,ExtPoint>, store:StoredModelFile) {
      const {feats,closes,dates}=buildFeatures(rows,extMap);
      const {X,y,anchorDateIdxs}=makeSeqs(feats,closes,LOOKBACK,PRED_H);
      const idxs=X.map((_,k)=>k).filter(k=>(dates[anchorDateIdxs[k]]??"")>=lastUpdatedDate);
      if(!idxs.length)return null;
      const gbdtMu=new Float64Array(store.gbdtScaler.mu), gbdtSig=new Float64Array(store.gbdtScaler.sigma);
      const XteN=applyStd(idxs.map(k=>X[k]),gbdtMu,gbdtSig);
      return{XteN,yNew:new Float64Array(idxs.map(k=>y[k])),feats,closes,dates};
    }

    const kNew=newSamples(kospiRows,kospiExtMap,kospiStore);
    const qNew=newSamples(kosdaqRows,kosdaqExtMap,kosdaqStore);
    const sNew=newSamples(snpRows,snpExtMap,snpStore);
    const nNew=ixicStore ? newSamples(nasdaqRows,nasdaqExtMap,ixicStore) : null;
    if(!kNew&&!qNew&&!sNew&&!nNew){console.log("[gbdt] 신규 GBDT 학습 샘플 없음 — 표시만 갱신");}

    const seed=Date.now()%10000;
    const ksHP = getHP("^KS11"), kqHP = getHP("^KQ11"), gspcHP = getHP("^GSPC"), ixicHP = getHP("^IXIC");
    const updKospi  = kNew ? kospiStore.gbdtModels.map((m,e)=>incrementalAddTrees(m,kNew.XteN,kNew.yNew,N_INCR_TREES,e*7+seed,ksHP)) : kospiStore.gbdtModels;
    const updKosdaq = qNew ? kosdaqStore.gbdtModels.map((m,e)=>incrementalAddTrees(m,qNew.XteN,qNew.yNew,N_INCR_TREES,e*7+3+seed,kqHP)) : kosdaqStore.gbdtModels;
    const updSnp    = sNew ? snpStore.gbdtModels.map((m,e)=>incrementalAddTrees(m,sNew.XteN,sNew.yNew,N_INCR_TREES,e*7+7+seed,gspcHP)) : snpStore.gbdtModels;
    const updIxic   = (ixicStore&&nNew) ? ixicStore.gbdtModels.map((m,e)=>incrementalAddTrees(m,nNew.XteN,nNew.yNew,N_INCR_TREES,e*7+11+seed,ixicHP)) : ixicStore?.gbdtModels;

    saveModelFile("KS11",{...kospiStore,  gbdtModels:updKospi,  nFeatures:N_FEATURES});
    saveModelFile("KQ11",{...kosdaqStore, gbdtModels:updKosdaq, nFeatures:N_FEATURES});
    saveModelFile("GSPC",{...snpStore,    gbdtModels:updSnp,    nFeatures:N_FEATURES});
    if(ixicStore&&updIxic) saveModelFile("IXIC",{...ixicStore, gbdtModels:updIxic, nFeatures:N_FEATURES});

    const kospi = buildResultFromModel(
      "^KS11","KOSPI",kospiRows,kospiExtMap,updKospi,
      {mu:new Float64Array(kospiStore.gbdtScaler.mu),sigma:new Float64Array(kospiStore.gbdtScaler.sigma)},
      loadLSTMFromWeights(kospiStore.lstmWeights),
      {mu:new Float64Array(kospiStore.lstmScaler.mu),sigma:new Float64Array(kospiStore.lstmScaler.sigma)},
      kospiStore.ensembleAlpha, ksHP.recentWindow,
    );
    const kosdaq = buildResultFromModel(
      "^KQ11","KOSDAQ",kosdaqRows,kosdaqExtMap,updKosdaq,
      {mu:new Float64Array(kosdaqStore.gbdtScaler.mu),sigma:new Float64Array(kosdaqStore.gbdtScaler.sigma)},
      loadLSTMFromWeights(kosdaqStore.lstmWeights),
      {mu:new Float64Array(kosdaqStore.lstmScaler.mu),sigma:new Float64Array(kosdaqStore.lstmScaler.sigma)},
      kosdaqStore.ensembleAlpha, kqHP.recentWindow,
    );
    const snp500 = buildResultFromModel(
      "^GSPC","S&P500",snpRows,snpExtMap,updSnp,
      {mu:new Float64Array(snpStore.gbdtScaler.mu),sigma:new Float64Array(snpStore.gbdtScaler.sigma)},
      loadLSTMFromWeights(snpStore.lstmWeights),
      {mu:new Float64Array(snpStore.lstmScaler.mu),sigma:new Float64Array(snpStore.lstmScaler.sigma)},
      snpStore.ensembleAlpha, gspcHP.recentWindow,
    );
    const nasdaq = (ixicStore&&updIxic) ? buildResultFromModel(
      "^IXIC","NASDAQ",nasdaqRows,nasdaqExtMap,updIxic,
      {mu:new Float64Array(ixicStore.gbdtScaler.mu),sigma:new Float64Array(ixicStore.gbdtScaler.sigma)},
      loadLSTMFromWeights(ixicStore.lstmWeights),
      {mu:new Float64Array(ixicStore.lstmScaler.mu),sigma:new Float64Array(ixicStore.lstmScaler.sigma)},
      ixicStore.ensembleAlpha, ixicHP.recentWindow,
    ) : _status.nasdaq;
    const now=new Date().toISOString();
    saveMeta({
      ...(meta??{lastTrained:now,nSamples:{},dirAcc:{},wfDirAcc:{},rolling30dDirAcc:{},updateCount:0}),
      lastUpdated:now,
      dirAcc:          {kospi:kospi.testDirAcc,       kosdaq:kosdaq.testDirAcc,       snp500:snp500.testDirAcc,       ...(nasdaq?{nasdaq:nasdaq.testDirAcc}:{})},
      wfDirAcc:        {kospi:kospi.wfDirAcc,         kosdaq:kosdaq.wfDirAcc,         snp500:snp500.wfDirAcc,         ...(nasdaq?{nasdaq:nasdaq.wfDirAcc}:{})},
      rolling30dDirAcc:{kospi:kospi.rolling30dDirAcc, kosdaq:kosdaq.rolling30dDirAcc, snp500:snp500.rolling30dDirAcc, ...(nasdaq?{nasdaq:nasdaq.rolling30dDirAcc}:{})},
      updateCount:(meta?.updateCount??0)+1,
    });
    _lastRun=Date.now();
    _status={..._status,ready:true,kospi,kosdaq,snp500,nasdaq};
    saveResultsToDB(kospi,kosdaq,snp500,nasdaq??undefined).catch(()=>{});
    console.log(`[gbdt] 증분 완료 ${Date.now()-t0}ms | updateCount=${(meta?.updateCount??0)+1}`);
  } catch(e:any){console.error("[gbdt] 증분 실패:",e?.message??e);}
}

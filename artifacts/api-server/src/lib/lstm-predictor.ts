/**
 * 시장 예측 파이프라인 v6  — LSTM + GBDT 앙상블 + 외부 피처 + 수급
 * ──────────────────────────────────────────────────────────────────────
 * 기술적 지표 9 + 매크로 3 + 수급 3 = 총 N_FEATURES = 15
 *
 * [기술적 9]  수익률, MA5/20비율, RSI14, 변동성5/20일, 볼린저밴드, 모멘텀5/10일
 * [매크로  3]  S&P500 전일 등락 (Yahoo Finance ^GSPC)
 *             원/달러 환율 변화율 (Yahoo Finance USDKRW=X)
 *             국고채 3년 금리     (FRED IRLTLT01KRM156N)
 * [수급    3]  외국인 순매수 (KRX MDCSTAT02303) → 외국인 수급 직접 지표
 *             기관 순매수   (KRX MDCSTAT02303) → 기관 수급 직접 지표
 *             공매도 비율   (KRX MDCSTAT05001) → 하락 압력 선행지표
 */
import fs   from "node:fs";
import path from "node:path";
import * as tf from "@tensorflow/tfjs";
import YahooFinance from "yahoo-finance2";
import { pool } from "@workspace/db";

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
  kospi?: IndexResult; kosdaq?: IndexResult;
}

// ─── Hyperparameters ─────────────────────────────────────────────────────────

const LOOKBACK     = 20;
const PRED_H       = 3;
const N_FEATURES   = 15;   // 9 기술적 + 3 매크로 + 3 수급
const GBDT_BINS    = 32;
const N_INCR_TREES = 5;
const LSTM_UNITS   = 32;
const LSTM_DENSE   = 16;
const LSTM_BATCH   = 32;
const YEARS_DATA   = 5;
const CACHE_TTL    = 6 * 3600_000;
const KRX_BASE     = "http://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd";

// 모델 버전 — 피처/아키텍처 변경 시 번호 올리면 자동 재학습
const MODEL_VERSION = 9;

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
  /** KOSPI — 안정적인 대형주 지수, 보수적 설정 */
  KS11: {
    gbdtTrees: 60,  gbdtLR: 0.05,  gbdtDepth: 3, gbdtLeaf: 20,
    gbdtFsub: 0.55, gbdtSsub: 0.80, nEnsemble: 2,
    lstmEpochs: 20, lstmLR: 0.001,  lstmDrop: 0.20,
    recentWindow: 30,
  },
  /** KOSDAQ — 변동성 높은 성장주 지수, 더 깊고 많은 트리 + 긴 학습 */
  KQ11: {
    gbdtTrees: 120, gbdtLR: 0.025, gbdtDepth: 4, gbdtLeaf: 10,
    gbdtFsub: 0.65, gbdtSsub: 0.75, nEnsemble: 4,
    lstmEpochs: 40, lstmLR: 0.001, lstmDrop: 0.15,
    recentWindow: 20,   // 최근 20일로 빠르게 반응
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

/** KRX GET 요청 헬퍼 (krx-short-client.ts 와 동일한 방식) */
async function krxGet(bld: string, extra: Record<string, string>): Promise<any[]> {
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
 * KRX 시장별 투자자별 거래실적 (MDCSTAT02303)
 * 외국인·기관 순매수 거래대금 (억원) 일별 시계열
 */
async function fetchKRXMarketInvestor(
  market: "KOSPI" | "KOSDAQ",
  startYYYYMMDD: string,
  endYYYYMMDD:   string,
): Promise<{ date: string; foreignNet: number; instNet: number }[]> {
  const mktId = market === "KOSPI" ? "STK" : "KSQ";
  const rows = await krxGet("dbms/MDC/STAT/standard/MDCSTAT02303", {
    mktId, strtDd: startYYYYMMDD, endDd: endYYYYMMDD, share: "1", money: "1", csvxls_isNo: "false",
  });
  if (!rows.length) { console.warn(`[ext] KRX 투자자 0행 (${market})`); return []; }
  console.log(`[ext] KRX 투자자 ${rows.length}행 수신 (${market}) 샘플:`, JSON.stringify(rows[0]).slice(0, 120));
  return rows.map((r: any) => ({
    date:       krxDateToISO(r.TRD_DD ?? r.trdDd ?? r["일자"]),
    foreignNet: parseKRXNum(r.FRGN_NETBUY_TRDVAL ?? r.frgnNetbuyTrdval
                  ?? r.FRGN_NETBYTD_AMT ?? r["외국인_순매수거래대금"] ?? 0),
    instNet:    parseKRXNum(r.INST_NETBUY_TRDVAL  ?? r.instNetbuyTrdval
                  ?? r.INST_NETBYTD_AMT ?? r["기관계_순매수거래대금"] ?? 0),
  })).filter(r => r.date.length === 10);
}

/**
 * KRX 공매도 거래 추이 (MDCSTAT05001)
 * 공매도 비율 (%) 일별 시계열
 */
async function fetchKRXMarketShort(
  market: "KOSPI" | "KOSDAQ",
  startYYYYMMDD: string,
  endYYYYMMDD:   string,
): Promise<{ date: string; shortRatio: number }[]> {
  const mktId = market === "KOSPI" ? "STK" : "KSQ";
  const rows = await krxGet("dbms/MDC/STAT/standard/MDCSTAT05001", {
    mktId, strtDd: startYYYYMMDD, endDd: endYYYYMMDD, share: "1", money: "1", csvxls_isNo: "false",
  });
  if (!rows.length) { console.warn(`[ext] KRX 공매도 0행 (${market})`); return []; }
  console.log(`[ext] KRX 공매도 ${rows.length}행 수신 (${market}) 샘플:`, JSON.stringify(rows[0]).slice(0, 120));
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
  sp500Ret:   number;   // S&P500 전일 등락률 (소수)
  usdkrwRet:  number;   // 원/달러 변화율 (소수)
  bond3y:     number;   // 국고채 3년 금리 % (/10 scaled)
  foreignNet: number;   // 외국인 순매수 (억원, 표준화)
  instNet:    number;   // 기관 순매수 (억원, 표준화)
  shortRatio: number;   // 공매도 비율 % (/10 scaled)
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

/** KOSPI/KOSDAQ 날짜 배열 → 모든 외부 피처 Map (forward-fill) */
async function fetchExternalData(
  dates: string[],
  market: "KOSPI" | "KOSDAQ" = "KOSPI",
): Promise<Map<string, ExtPoint>> {
  if (dates.length === 0) return new Map();
  const startISO  = dates[0] ?? "2020-01-01";
  const years = Math.min(YEARS_DATA + 0.3,
    Math.ceil((Date.now() - new Date(startISO).getTime()) / (365.25 * 24 * 3600_000)) + 0.3);
  const startKRX  = startISO.replace(/-/g, "");
  const endKRX    = (dates[dates.length - 1] ?? new Date().toISOString().slice(0, 10)).replace(/-/g, "");

  console.log(`[ext] 외부 데이터 수집 (${market}, ${years.toFixed(1)}년, KRX ${startKRX}~${endKRX})...`);

  const [sp500Rows, usdkrwRows, bondRows, investorRows, shortRows] = await Promise.all([
    fetchYahooSeries("^GSPC", years),
    fetchYahooSeries("USDKRW=X", years),
    fredFetchSeries("IRLTLT01KRM156N", startISO),  // 한국 장기국채 (월별, OECD) – 3Y ≈ 10Y – 0.4pp
    fetchKRXMarketInvestor(market, startKRX, endKRX),
    fetchKRXMarketShort(market, startKRX, endKRX),
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

  // ── KRX 공매도 Map ──
  const shortMap = new Map<string, number>();
  for (const r of shortRows) shortMap.set(r.date, r.shortRatio);

  // ── 정규화 기준값 계산 (외국인/기관 순매수 스케일) ──
  const fnetVals = investorRows.map(r => Math.abs(r.foreignNet)).filter(v => v > 0);
  const inetVals = investorRows.map(r => Math.abs(r.instNet)).filter(v => v > 0);
  const fnetScale = fnetVals.length > 0 ? (fnetVals.sort((a,b)=>a-b)[Math.floor(fnetVals.length*0.95)] || 10000) : 10000;
  const inetScale = inetVals.length > 0 ? (inetVals.sort((a,b)=>a-b)[Math.floor(inetVals.length*0.95)] || 10000) : 10000;

  console.log(`[ext] 완료 — S&P500 ${sp500Rows.length}행, 환율 ${usdkrwRows.length}행, 국고채 ${bondRows.length}행, 투자자 ${investorRows.length}행, 공매도 ${shortRows.length}행`);

  // ── KOSPI 날짜에 맞춰 forward-fill ──
  const result = new Map<string, ExtPoint>();
  let lastSP500 = 0, lastUSDKRW = 0, lastBond = 3.0;
  let lastForeign = 0, lastInst = 0, lastShort = 2.0;
  let bondIdx = 0;

  for (const date of dates) {
    // 국고채 forward-fill
    while (bondIdx < bondEntries.length && bondEntries[bondIdx].date <= date) {
      lastBond = bondEntries[bondIdx].value;
      bondIdx++;
    }
    if (sp500RetMap.has(date))   lastSP500  = sp500RetMap.get(date)!;
    if (usdkrwRetMap.has(date))  lastUSDKRW = usdkrwRetMap.get(date)!;
    if (investorMap.has(date)) {
      const iv = investorMap.get(date)!;
      lastForeign = iv.foreignNet;
      lastInst    = iv.instNet;
    }
    if (shortMap.has(date)) lastShort = shortMap.get(date)!;

    result.set(date, {
      sp500Ret:   lastSP500,
      usdkrwRet:  lastUSDKRW,
      bond3y:     lastBond,
      foreignNet: lastForeign / fnetScale,  // ≈ −1 ~ +1
      instNet:    lastInst    / inetScale,  // ≈ −1 ~ +1
      shortRatio: lastShort,                // % (scaler가 표준화)
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
  rows: { date: string; close: number }[],
  extMap: Map<string, ExtPoint>,
): { feats: Float64Array[]; closes: number[]; dates: string[] } {
  const closes = rows.map(r => r.close);
  const dates  = rows.map(r => r.date);
  const rets   = closes.map((c, i) => i === 0 ? 0 : (c - closes[i-1]) / closes[i-1]);
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
    const ext   = extMap.get(row.date) ?? { sp500Ret:0, usdkrwRet:0, bond3y:3.0, foreignNet:0, instNet:0, shortRatio:2.0 };
    return new Float64Array([
      // ── 기술적 (9) ──
      rets[i],
      ma5>0  ? closes[i]/ma5  - 1 : 0,
      ma20>0 ? closes[i]/ma20 - 1 : 0,
      rsiNorm(rets, 14, i),
      rollingStdFn(rets, 5,  i),
      rollingStdFn(rets, 20, i),
      Math.max(0, Math.min(1, bband)),
      mom5, mom10,
      // ── 매크로 (3) ──
      ext.sp500Ret,          // S&P500 등락 (−0.05 ~ 0.05)
      ext.usdkrwRet,         // 환율 변화 (−0.03 ~ 0.03)
      ext.bond3y / 10,       // 국고채3Y /10 → 0 ~ 1 스케일
      // ── 수급 (3) ──
      ext.foreignNet,        // 외국인 순매수 (95th pct 기준 정규화, −1~+1)
      ext.instNet,           // 기관 순매수   (동일 정규화)
      ext.shortRatio / 10,   // 공매도비율 /10 (0~1 스케일)
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

function buildLSTMArch(drop = 0.2): tf.Sequential {
  const model = tf.sequential();
  model.add(tf.layers.lstm({
    units: LSTM_UNITS, inputShape: [LOOKBACK, N_FEATURES],
    returnSequences: false, dropout: drop, recurrentDropout: drop / 2,
  }));
  model.add(tf.layers.dense({ units: LSTM_DENSE, activation: "relu" }));
  model.add(tf.layers.dropout({ rate: drop / 2 }));
  model.add(tf.layers.dense({ units: 1 }));
  return model;
}

function saveLSTMWeights(model: tf.LayersModel): LSTMWeightLayer[][] {
  return model.layers.map(layer =>
    layer.getWeights().map(w => ({ shape: w.shape, data: Array.from(w.dataSync()) }))
  );
}

function loadLSTMFromWeights(weightsData: LSTMWeightLayer[][]): tf.Sequential {
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
): Promise<tf.Sequential> {
  await tf.ready();
  const model = buildLSTMArch(hp.lstmDrop);
  model.compile({ optimizer: tf.train.adam(hp.lstmLR), loss: "meanSquaredError" });

  const xTrain = tf.tensor3d(X3d_train);
  const yTrain = tf.tensor2d(Array.from(y_train), [y_train.length, 1]);
  const xVal   = tf.tensor3d(X3d_val);
  const yVal   = tf.tensor2d(Array.from(y_val),   [y_val.length,   1]);

  try {
    await model.fit(xTrain, yTrain, {
      epochs: hp.lstmEpochs, batchSize: LSTM_BATCH,
      validationData: [xVal, yVal], verbose: 0,
      callbacks: {
        onEpochEnd: (epoch: number, logs: any) => {
          if (epoch % 5 === 4)
            console.log(`[lstm] epoch ${epoch+1}/${hp.lstmEpochs} loss=${logs?.loss?.toFixed(4)} val=${logs?.val_loss?.toFixed(4)}`);
        },
      },
    });
  } finally {
    xTrain.dispose(); yTrain.dispose(); xVal.dispose(); yVal.dispose();
  }
  return model;
}

function lstmPredict(model: tf.Sequential, X3d: number[][][]): Float64Array {
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
    .map((q: any) => ({ date: new Date(q.date).toISOString().slice(0,10), close: q.close as number }));
}

// ─── Core result builder ──────────────────────────────────────────────────────

function buildResultFromModel(
  symbol: string, name: string,
  rows: { date: string; close: number }[],
  extMap: Map<string, ExtPoint>,
  gbdtModels: GBDTModel[], gbdtScaler: { mu: Float64Array; sigma: Float64Array },
  lstmModel: tf.Sequential, lstmScaler: { mu: Float64Array; sigma: Float64Array },
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
  // 최소 10% LSTM 참여 보장 (완전히 0이 되지 않도록)
  const alpha = Math.max(0.10, rawAlpha);

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

  const nTest = testPreds.length;
  const wfMid = Math.floor(nTest / 2);
  const wf1 = dirAccRate(testPreds.slice(0, wfMid), Array.from(yte).slice(0, wfMid));
  const wf2 = dirAccRate(testPreds.slice(wfMid),    Array.from(yte).slice(wfMid));

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
    wfDirAcc: +((wf1+wf2)/2*100).toFixed(1),
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
  rows: { date: string; close: number }[],
  market: "KOSPI" | "KOSDAQ",
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

const DB_CACHE_KEY = "lstm_pipeline_result_v1";
const DB_CACHE_TTL_DAYS = 7;

async function saveResultsToDB(kospi: IndexResult, kosdaq: IndexResult): Promise<void> {
  try {
    const expires = new Date();
    expires.setDate(expires.getDate() + DB_CACHE_TTL_DAYS);
    const payload = JSON.stringify({ kospi, kosdaq, savedAt: new Date().toISOString() });
    await pool.query(
      `INSERT INTO system_cache (key, data, expires_at)
       VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, expires_at = EXCLUDED.expires_at`,
      [DB_CACHE_KEY, payload, expires.toISOString()],
    );
    console.log("[pipeline] 예측 결과 DB 저장 완료");
  } catch (e: any) {
    console.warn("[pipeline] DB 저장 실패 (무시):", e?.message);
  }
}

export async function tryRestoreFromDB(): Promise<boolean> {
  try {
    const r = await pool.query<{ data: { kospi: IndexResult; kosdaq: IndexResult; savedAt: string } }>(
      `SELECT data FROM system_cache WHERE key = $1 AND expires_at > NOW()`,
      [DB_CACHE_KEY],
    );
    const row = r.rows[0]?.data;
    if (!row?.kospi || !row?.kosdaq) return false;

    _status = {
      running: false, ready: true,
      steps: defaultSteps().map(s => ({ ...s, status: "done" as const })),
      trainedAt: row.savedAt, trainingMs: 0,
      kospi: row.kospi, kosdaq: row.kosdaq,
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
    trainingMs:_status.trainingMs, kospi:_status.kospi, kosdaq:_status.kosdaq,
    initializing: (_status as any).initializing ?? false,
  };
}

export async function tryRestoreFromDisk(): Promise<boolean> {
  const meta        = loadMeta();
  const kospiStore  = loadModelFile("KS11");
  const kosdaqStore = loadModelFile("KQ11");
  if (!meta||!kospiStore||!kosdaqStore) return false;

  if (!kospiStore.lstmWeights || !kosdaqStore.lstmWeights) {
    console.log("[gbdt] 구형 모델 (lstmWeights 없음) — 재학습"); return false;
  }
  if ((kospiStore.nFeatures ?? 9) !== N_FEATURES) {
    console.log(`[gbdt] 피처 수 변경 (${kospiStore.nFeatures ?? "?"}→${N_FEATURES}) — 재학습`);
    return false;
  }
  if ((kospiStore.version ?? 0) < MODEL_VERSION || (kosdaqStore.version ?? 0) < MODEL_VERSION) {
    console.log(`[gbdt] 모델 버전 변경 (v${MODEL_VERSION}) — 재학습`);
    return false;
  }

  // ★ 복원 시작 전에 running: true 로 설정 → 프론트가 자동 재학습 트리거하지 않도록 방어
  _status = { running: true, ready: false, steps: defaultSteps(), initializing: true } as any;
  console.log("[gbdt] 디스크 복원 중 (nFeatures=" + N_FEATURES + ", v" + MODEL_VERSION + ")...");
  try {
    const [kospiRows, kosdaqRows] = await Promise.all([
      fetchHistory("^KS11", 0.5), fetchHistory("^KQ11", 0.5),
    ]);
    const [kospiExtMap, kosdaqExtMap] = await Promise.all([
      fetchExternalData(kospiRows.map((r: { date: string; close: number }) => r.date), "KOSPI"),
      fetchExternalData(kosdaqRows.map((r: { date: string; close: number }) => r.date), "KOSDAQ"),
    ]);

    const kospi = buildResultFromModel(
      "^KS11","KOSPI",kospiRows,kospiExtMap,
      kospiStore.gbdtModels,
      {mu:new Float64Array(kospiStore.gbdtScaler.mu),sigma:new Float64Array(kospiStore.gbdtScaler.sigma)},
      loadLSTMFromWeights(kospiStore.lstmWeights),
      {mu:new Float64Array(kospiStore.lstmScaler.mu),sigma:new Float64Array(kospiStore.lstmScaler.sigma)},
      kospiStore.ensembleAlpha,
      getHP("^KS11").recentWindow,
    );
    const kosdaq = buildResultFromModel(
      "^KQ11","KOSDAQ",kosdaqRows,kosdaqExtMap,
      kosdaqStore.gbdtModels,
      {mu:new Float64Array(kosdaqStore.gbdtScaler.mu),sigma:new Float64Array(kosdaqStore.gbdtScaler.sigma)},
      loadLSTMFromWeights(kosdaqStore.lstmWeights),
      {mu:new Float64Array(kosdaqStore.lstmScaler.mu),sigma:new Float64Array(kosdaqStore.lstmScaler.sigma)},
      kosdaqStore.ensembleAlpha,
      getHP("^KQ11").recentWindow,
    );

    _lastRun = Date.now();
    _status = {
      running:false, ready:true,
      steps:defaultSteps().map(s=>({...s,status:"done" as const})),
      trainedAt:meta.lastTrained, trainingMs:0, kospi, kosdaq,
    };
    console.log(`[gbdt] 복원 완료 | KOSPI ${kospi.testDirAcc}% | KOSDAQ ${kosdaq.testDirAcc}% | 피처 ${N_FEATURES}개`);
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
    const [kospiRows,kosdaqRows]=await Promise.all([fetchHistory("^KS11"),fetchHistory("^KQ11")]);
    stepSet("data","done",Date.now()-s1);

    stepSet("feature","running"); stepSet("feature","done",0);
    stepSet("lstm","running");
    const sL=Date.now();

    // KOSPI와 KOSDAQ를 순차 학습 (TF.js 메모리 안전)
    const kospiResult  = await trainFull("^KS11","KOSPI",  kospiRows,  "KOSPI");
    const kosdaqResult = await trainFull("^KQ11","KOSDAQ", kosdaqRows, "KOSDAQ");

    stepSet("lstm","done",Date.now()-sL);
    stepSet("gbdt","running");    stepSet("gbdt","done",0);
    stepSet("ensemble","running"); stepSet("ensemble","done",0);
    stepSet("output","running");   stepSet("output","done",0);

    const trainedAt = new Date().toISOString();
    saveMeta({
      lastTrained:trainedAt, lastUpdated:trainedAt,
      nSamples:{kospi:kospiRows.length,kosdaq:kosdaqRows.length},
      dirAcc:          {kospi:kospiResult.testDirAcc,       kosdaq:kosdaqResult.testDirAcc},
      wfDirAcc:        {kospi:kospiResult.wfDirAcc,         kosdaq:kosdaqResult.wfDirAcc},
      rolling30dDirAcc:{kospi:kospiResult.rolling30dDirAcc, kosdaq:kosdaqResult.rolling30dDirAcc},
      updateCount:0,
    });

    _lastRun=now;
    _status={
      running:false,ready:true,steps:_status.steps,
      trainedAt, trainingMs:Date.now()-t0,
      kospi:kospiResult, kosdaq:kosdaqResult,
    };
    console.log(`[pipeline] 완료 ${Date.now()-t0}ms | KOSPI ${kospiResult.testDirAcc}% | KOSDAQ ${kosdaqResult.testDirAcc}% | 피처 ${N_FEATURES}개`);
    // 재배포 후에도 즉시 표시될 수 있도록 DB에 저장
    saveResultsToDB(kospiResult, kosdaqResult).catch(() => {});
  } catch(err:any) {
    console.error("[pipeline] 오류:",err?.message??err);
    const f=_status.steps.find(s=>s.status==="running");
    if(f)f.status="error";
    _status={..._status,running:false,ready:false,error:err?.message??String(err)};
  }
}

export async function runDailyIncrementalUpdate(): Promise<void> {
  if (_status.running){console.log("[gbdt] 학습 중 — 증분 스킵");return;}
  const meta=loadMeta(), kospiStore=loadModelFile("KS11"), kosdaqStore=loadModelFile("KQ11");
  if(!kospiStore||!kosdaqStore||!kospiStore.lstmWeights||(kospiStore.nFeatures??9)!==N_FEATURES){
    console.log("[gbdt] 저장 모델 없음 또는 피처 불일치 → 완전 학습");
    return runPipeline(true);
  }
  console.log("[gbdt] 일일 증분 시작 (GBDT +5트리; LSTM 스킵)");
  const t0=Date.now();
  try {
    const [kospiRows,kosdaqRows]=await Promise.all([fetchHistory("^KS11",0.5),fetchHistory("^KQ11",0.5)]);
    const lastUpdated=meta?.lastUpdated??"2000-01-01";

    const [kospiExtMap,kosdaqExtMap]=await Promise.all([
      fetchExternalData(kospiRows.map((r:{date:string;close:number})=>r.date), "KOSPI"),
      fetchExternalData(kosdaqRows.map((r:{date:string;close:number})=>r.date), "KOSDAQ"),
    ]);

    function newSamples(rows:{date:string;close:number}[], extMap:Map<string,ExtPoint>, store:StoredModelFile) {
      const {feats,closes,dates}=buildFeatures(rows,extMap);
      const {X,y,anchorDateIdxs}=makeSeqs(feats,closes,LOOKBACK,PRED_H);
      const idxs=X.map((_,k)=>k).filter(k=>(dates[anchorDateIdxs[k]]??"")>lastUpdated);
      if(!idxs.length)return null;
      const gbdtMu=new Float64Array(store.gbdtScaler.mu), gbdtSig=new Float64Array(store.gbdtScaler.sigma);
      const XteN=applyStd(idxs.map(k=>X[k]),gbdtMu,gbdtSig);
      return{XteN,yNew:new Float64Array(idxs.map(k=>y[k]))};
    }

    const kNew=newSamples(kospiRows,kospiExtMap,kospiStore);
    const qNew=newSamples(kosdaqRows,kosdaqExtMap,kosdaqStore);
    if(!kNew&&!qNew){console.log("[gbdt] 신규 데이터 없음");return;}

    const seed=Date.now()%10000;
    const ksHP = getHP("^KS11"), kqHP = getHP("^KQ11");
    const updKospi  = kNew ? kospiStore.gbdtModels.map((m,e)=>incrementalAddTrees(m,kNew.XteN,kNew.yNew,N_INCR_TREES,e*7+seed,ksHP)) : kospiStore.gbdtModels;
    const updKosdaq = qNew ? kosdaqStore.gbdtModels.map((m,e)=>incrementalAddTrees(m,qNew.XteN,qNew.yNew,N_INCR_TREES,e*7+3+seed,kqHP)) : kosdaqStore.gbdtModels;

    saveModelFile("KS11",{...kospiStore,  gbdtModels:updKospi,  nFeatures:N_FEATURES});
    saveModelFile("KQ11",{...kosdaqStore, gbdtModels:updKosdaq, nFeatures:N_FEATURES});

    const kospi = buildResultFromModel(
      "^KS11","KOSPI",kospiRows,kospiExtMap,updKospi,
      {mu:new Float64Array(kospiStore.gbdtScaler.mu),sigma:new Float64Array(kospiStore.gbdtScaler.sigma)},
      loadLSTMFromWeights(kospiStore.lstmWeights),
      {mu:new Float64Array(kospiStore.lstmScaler.mu),sigma:new Float64Array(kospiStore.lstmScaler.sigma)},
      kospiStore.ensembleAlpha,
      ksHP.recentWindow,
    );
    const kosdaq = buildResultFromModel(
      "^KQ11","KOSDAQ",kosdaqRows,kosdaqExtMap,updKosdaq,
      {mu:new Float64Array(kosdaqStore.gbdtScaler.mu),sigma:new Float64Array(kosdaqStore.gbdtScaler.sigma)},
      loadLSTMFromWeights(kosdaqStore.lstmWeights),
      {mu:new Float64Array(kosdaqStore.lstmScaler.mu),sigma:new Float64Array(kosdaqStore.lstmScaler.sigma)},
      kosdaqStore.ensembleAlpha,
      kqHP.recentWindow,
    );
    const now=new Date().toISOString();
    saveMeta({
      ...(meta??{lastTrained:now,nSamples:{},dirAcc:{},wfDirAcc:{},rolling30dDirAcc:{},updateCount:0}),
      lastUpdated:now,
      dirAcc:          {kospi:kospi.testDirAcc,       kosdaq:kosdaq.testDirAcc},
      wfDirAcc:        {kospi:kospi.wfDirAcc,         kosdaq:kosdaq.wfDirAcc},
      rolling30dDirAcc:{kospi:kospi.rolling30dDirAcc, kosdaq:kosdaq.rolling30dDirAcc},
      updateCount:(meta?.updateCount??0)+1,
    });
    _lastRun=Date.now();
    _status={..._status,ready:true,kospi,kosdaq};
    console.log(`[gbdt] 증분 완료 ${Date.now()-t0}ms | updateCount=${(meta?.updateCount??0)+1}`);
  } catch(e:any){console.error("[gbdt] 증분 실패:",e?.message??e);}
}

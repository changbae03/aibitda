/**
 * /api/market/flow  — 수급 레이더
 * · KOSPI / KOSDAQ 시장 전체 투자자별 순매수 (pykrx, 최근 5 영업일)
 * · 주요 KR 종목별 투자자 순매수 (pykrx FHKST01010900 대체)
 */
import { Router } from "express";
import { fetchInvestorData, fetchInvestorByStocks, fetchBothMarketsOHLCV } from "../lib/pykrx-client.js";
import { pool } from "@workspace/db";

const router = Router();

const FLOW_CACHE_KEY = "market_flow_v2";
const FLOW_TTL_MS   = 6 * 60 * 60 * 1000;  // 6시간 (30분→6h: 재시작 후 빠른 서빙)
const STALE_MAX_MS  = 24 * 60 * 60 * 1000; // stale-while-revalidate 최대 24시간

interface StockMeta { code: string; name: string; sector: string }

const WATCH_STOCKS: StockMeta[] = [
  { code: "005930", name: "삼성전자",      sector: "반도체" },
  { code: "000660", name: "SK하이닉스",    sector: "반도체" },
  { code: "035420", name: "NAVER",          sector: "플랫폼" },
  { code: "005380", name: "현대차",         sector: "자동차" },
  { code: "000270", name: "기아",           sector: "자동차" },
  { code: "068270", name: "셀트리온",       sector: "바이오" },
  { code: "066570", name: "LG전자",         sector: "전자" },
  { code: "003550", name: "LG",             sector: "지주" },
  { code: "051910", name: "LG화학",         sector: "화학" },
  { code: "006400", name: "삼성SDI",        sector: "배터리" },
  { code: "207940", name: "삼성바이오로직스", sector: "바이오" },
  { code: "012330", name: "현대모비스",     sector: "자동차부품" },
  { code: "034020", name: "두산에너빌리티", sector: "에너지" },
  { code: "030200", name: "KT",             sector: "통신" },
  { code: "017670", name: "SK텔레콤",       sector: "통신" },
  { code: "086520", name: "에코프로",       sector: "배터리소재" },
  { code: "247540", name: "에코프로비엠",   sector: "배터리소재" },
  { code: "373220", name: "LG에너지솔루션", sector: "배터리" },
  { code: "196170", name: "알테오젠",       sector: "바이오" },
  { code: "035900", name: "JYP Ent.",       sector: "엔터" },
  { code: "041510", name: "에스엠",         sector: "엔터" },
  { code: "035720", name: "카카오",         sector: "플랫폼" },
  { code: "263750", name: "펄어비스",       sector: "게임" },
  { code: "293490", name: "카카오게임즈",   sector: "게임" },
];

interface FlowData {
  marketFlow: {
    kospi:  { date: string; individual: number; institution: number; foreign: number }[];
    kosdaq: { date: string; individual: number; institution: number; foreign: number }[];
  };
  stocks: {
    code: string; name: string; sector: string;
    individual: number; institution: number; foreign: number;
  }[];
  updatedAt: string;
}

let flowCache: { data: FlowData; cachedAt: number } | null = null;
let _refreshing = false; // 백그라운드 갱신 중복 방지

/** ISO date "YYYY-MM-DD" → KRX format "YYYYMMDD" */
function toKRXDate(iso: string) { return iso.replace(/-/g, ""); }

/**
 * 가장 최근 영업일을 YYYYMMDD 형식으로 반환.
 * 주말(토·일)이면 직전 금요일로 후퇴. 공휴일은 pykrx가 내부 처리.
 */
function getLastTradingDay(): string {
  const d = new Date();
  const day = d.getDay(); // 0=일, 6=토
  if (day === 0) d.setDate(d.getDate() - 2); // 일 → 금
  if (day === 6) d.setDate(d.getDate() - 1); // 토 → 금
  return toKRXDate(d.toISOString().slice(0, 10));
}

async function buildFlowData(): Promise<FlowData> {
  const today       = new Date().toISOString().slice(0, 10);
  const fromDate    = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const tradingDay  = getLastTradingDay(); // 영업일 기준 날짜 (주말 자동 보정)
  const stockCodes  = WATCH_STOCKS.map(s => s.code);

  console.log(`[flow] 시장수급: ${fromDate}~${today}, 종목수급 기준일: ${tradingDay}`);

  // ── 시장 수급 + 종목 수급 병렬 실행 ──────────────────────────────────────
  const [kospiR, kosdaqR, stockR] = await Promise.allSettled([
    fetchInvestorData("KOSPI",  fromDate, today),
    fetchInvestorData("KOSDAQ", fromDate, today),
    fetchInvestorByStocks(tradingDay, stockCodes),
  ]);

  const kospi  = kospiR.status  === "fulfilled" ? kospiR.value.slice(-5)  : [];
  const kosdaq = kosdaqR.status === "fulfilled" ? kosdaqR.value.slice(-5) : [];
  const stockFlows = stockR.status === "fulfilled" ? stockR.value : [];

  const flowMap = new Map(stockFlows.map(f => [f.ticker, f]));

  const stocks = WATCH_STOCKS.map(s => {
    const f = flowMap.get(s.code);
    return {
      code: s.code,
      name: s.name,
      sector: s.sector,
      individual:  f?.individual  ?? 0,
      institution: f?.institution ?? 0,
      foreign:     f?.foreign     ?? 0,
    };
  }).filter(s => s.individual !== 0 || s.institution !== 0 || s.foreign !== 0);

  const latestDate = kospi.at(-1)?.date ? toKRXDate(kospi.at(-1)!.date) : todayKRX;
  console.log(`[flow] 완료 (${latestDate}): 종목 ${stocks.length}/${WATCH_STOCKS.length}개`);

  if (!kospi.length && !kosdaq.length && !stocks.length) {
    throw new Error("pykrx 데이터 없음 (0건) — 캐시 불가, 재시도 예정");
  }

  return {
    marketFlow: { kospi, kosdaq },
    stocks,
    updatedAt: new Date().toISOString(),
  };
}

/** DB 캐시에서 유효한 데이터 로드 */
async function loadFromDB(): Promise<FlowData | null> {
  try {
    const dbRow = await pool.query<{ data: FlowData }>(
      `SELECT data FROM system_cache WHERE key = $1 AND expires_at > NOW()`,
      [FLOW_CACHE_KEY]
    );
    const raw = dbRow.rows[0]?.data;
    if (!raw) return null;
    const d: FlowData = typeof raw === "string" ? JSON.parse(raw) : raw;
    const hasNonZeroMarket = [...(d.marketFlow?.kospi ?? []), ...(d.marketFlow?.kosdaq ?? [])]
      .some(r => r.individual !== 0 || r.institution !== 0 || r.foreign !== 0);
    const hasData = hasNonZeroMarket || (d.stocks?.length ?? 0) > 0;
    if (!hasData) {
      pool.query(`DELETE FROM system_cache WHERE key = $1`, [FLOW_CACHE_KEY]).catch(() => {});
      return null;
    }
    return d;
  } catch { return null; }
}

/** 캐시 저장 */
function saveCache(data: FlowData) {
  const now = Date.now();
  flowCache = { data, cachedAt: now };
  const expiresAt = new Date(now + FLOW_TTL_MS);
  pool.query(
    `INSERT INTO system_cache (key, data, expires_at)
     VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, expires_at = EXCLUDED.expires_at`,
    [FLOW_CACHE_KEY, JSON.stringify(data), expiresAt]
  ).catch(() => {});
}

/** 백그라운드 갱신 (stale-while-revalidate용) */
function refreshInBackground() {
  if (_refreshing) return;
  _refreshing = true;
  buildFlowData()
    .then(data => { saveCache(data); })
    .catch(e => console.warn("[flow] 백그라운드 갱신 실패:", e?.message))
    .finally(() => { _refreshing = false; });
}

/** 서버 기동 시 캐시 예열 — 첫 번째 사용자 요청이 즉시 응답 */
export async function warmupFlowCache(): Promise<void> {
  try {
    const dbData = await loadFromDB();
    if (dbData) {
      flowCache = { data: dbData, cachedAt: Date.now() };
      console.log("[flow] DB 캐시 복원 완료 (즉시 서빙 가능)");
      return;
    }
    console.log("[flow] DB 캐시 없음 — 백그라운드 예열 시작");
    refreshInBackground();
  } catch (e: any) {
    console.warn("[flow] 예열 실패:", e?.message);
  }
}

router.get("/market/flow", async (_req, res) => {
  try {
    const now = Date.now();

    // 1. 인메모리 캐시 — fresh (TTL 이내)
    if (flowCache && now - flowCache.cachedAt < FLOW_TTL_MS) {
      return res.json(flowCache.data);
    }

    // 2. 인메모리 캐시 — stale-while-revalidate (TTL 초과 but 24h 이내)
    //    → 즉시 반환하고 백그라운드에서 갱신 (사용자 대기 없음)
    if (flowCache && now - flowCache.cachedAt < STALE_MAX_MS) {
      res.json(flowCache.data);
      refreshInBackground();
      return;
    }

    // 3. DB 캐시 (유효)
    const dbData = await loadFromDB();
    if (dbData) {
      flowCache = { data: dbData, cachedAt: now };
      return res.json(dbData);
    }

    // 4. 캐시 없음 — 동기 fetch (첫 요청 or 오래된 서버)
    console.log("[flow] 캐시 없음 — 동기 fetch 시작");
    const data = await buildFlowData();
    saveCache(data);
    return res.json(data);
  } catch (e: any) {
    console.error("[market/flow]", e?.message ?? e);
    if (flowCache) return res.json(flowCache.data);
    return res.status(500).json({ error: "수급 데이터 조회 실패" });
  }
});

router.post("/market/flow/refresh", async (_req, res) => {
  try {
    flowCache = null;
    await pool.query(`DELETE FROM system_cache WHERE key = $1`, [FLOW_CACHE_KEY]);
    const data = await buildFlowData();
    saveCache(data);
    return res.json(data);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? "새로고침 실패" });
  }
});

// ─── 급등 조짐 종목 탐지 ─────────────────────────────────────────────────────

export interface SurgeCandidate {
  ticker: string;
  name: string;
  market: "KOSPI" | "KOSDAQ";
  change: number;          // 등락률 %
  volume: number;          // 오늘 거래량
  turnover: number;        // 거래대금 (억원)
  avgVolume: number;       // 기준 거래량 (시장 내 75th pct)
  volumeRatio: number;     // 거래량 급증률 (오늘/시장75th)
  institution: number;     // 기관 순매수 (억)
  foreign: number;         // 외인 순매수 (억)
  smartMoney: number;      // 기관+외인
  surgeScore: number;      // 종합 점수
  themes: string[];        // 연관 핫테마 이름
  signal: "breakout" | "accumulation" | "volume_spike"; // 주요 신호
}

interface SurgeCache {
  data: SurgeCandidate[];
  cachedAt: number;
  tradingDate: string;
}

let surgeCache: SurgeCache | null = null;
const SURGE_TTL     = 30 * 60 * 1000;         // 30분 (장중 자주 갱신)
const SURGE_STALE   = 24 * 60 * 60 * 1000;    // 24시간 stale 허용 (재시작 후 이전 데이터 서빙)
const SURGE_CACHE_KEY = "surge_cache_v1";
let   surgeScanning = false;

async function loadSurgeFromDB(): Promise<SurgeCache | null> {
  try {
    const r = await pool.query<{ data: string; expires_at: Date }>(
      `SELECT data, expires_at FROM system_cache WHERE key = $1 LIMIT 1`,
      [SURGE_CACHE_KEY]
    );
    if (!r.rows[0]) return null;
    const raw = r.rows[0].data;
    const parsed: SurgeCache = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed?.data) || parsed.data.length === 0) return null;
    return parsed;
  } catch { return null; }
}

function saveSurgeToDB(cache: SurgeCache) {
  const expiresAt = new Date(Date.now() + SURGE_STALE);
  pool.query(
    `INSERT INTO system_cache (key, data, expires_at)
     VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, expires_at = EXCLUDED.expires_at`,
    [SURGE_CACHE_KEY, JSON.stringify(cache), expiresAt]
  ).catch(() => {});
}

async function runSurgeScan(): Promise<void> {
  if (surgeScanning) return;
  surgeScanning = true;
  try {
    const data = await buildSurgeData();
    if (data.length === 0) {
      console.log("[surge] 스캔 0건 — 기존 캐시 유지");
      return;
    }
    const todayStr = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10).replace(/-/g, "");
    surgeCache = { data, cachedAt: Date.now(), tradingDate: todayStr };
    saveSurgeToDB(surgeCache);
    console.log(`[surge] 스캔 완료: ${data.length}개 저장`);
  } catch (e: any) {
    console.error("[surge] 스캔 실패:", e?.message);
  } finally {
    surgeScanning = false;
  }
}

// 서버 기동 시 DB 복원 + 필요시 백그라운드 갱신
loadSurgeFromDB().then(db => {
  if (db) {
    surgeCache = db;
    const ageMin = Math.round((Date.now() - db.cachedAt) / 60_000);
    console.log(`[surge] DB 캐시 복원 (${db.data.length}개, ${ageMin}분 전) — 즉시 서빙 가능`);
    if (Date.now() - db.cachedAt > SURGE_TTL) {
      setTimeout(() => runSurgeScan(), 20_000);
    }
  } else {
    console.log("[surge] DB 캐시 없음 — 20초 후 초기 스캔 시작");
    setTimeout(() => runSurgeScan(), 20_000);
  }
}).catch(() => {});

async function fetchHotThemeMap(): Promise<Map<string, string[]>> {
  try {
    const r = await pool.query<{ data: string }>(
      `SELECT data FROM system_cache WHERE key LIKE 'themes_feed_cache%' ORDER BY expires_at DESC LIMIT 1`
    );
    if (!r.rows[0]) return new Map();
    const feed: { stocks?: { ticker: string }[]; name?: string }[] =
      typeof r.rows[0].data === "string" ? JSON.parse(r.rows[0].data) : r.rows[0].data;
    const map = new Map<string, string[]>();
    for (const theme of feed) {
      if (!theme.name || !Array.isArray(theme.stocks)) continue;
      for (const s of theme.stocks) {
        if (!s.ticker) continue;
        const existing = map.get(s.ticker) ?? [];
        existing.push(theme.name);
        map.set(s.ticker, existing);
      }
    }
    return map;
  } catch { return new Map(); }
}

async function buildSurgeData(): Promise<SurgeCandidate[]> {
  const todayKST = new Date(Date.now() + 9 * 3600_000);
  const todayStr = todayKST.toISOString().slice(0, 10).replace(/-/g, "");

  console.log(`[surge] OHLCV 스캔 시작 (${todayStr})`);
  const [rows, themeMap] = await Promise.all([
    fetchBothMarketsOHLCV(todayStr),
    fetchHotThemeMap(),
  ]);

  if (!rows.length) {
    console.warn("[surge] OHLCV 데이터 없음 (휴장 또는 장 전)");
    return [];
  }

  // ── 시장별 거래량 75th 퍼센타일 계산 ─────────────────────────────────────────
  // 기존 "시장 전체 중앙값" 방식은 대형주가 항상 상위권에 오르는 왜곡을 발생시킴.
  // KOSPI / KOSDAQ 각각의 75th 퍼센타일을 기준선으로 삼으면 자신이 속한 시장 내에서
  // 상위 25%보다 2배 이상 거래량이 터진 종목만 포착 — 진짜 폭발 신호.
  const pct = (arr: number[], q: number) => {
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length * q)] ?? 1;
  };
  const kospiVols  = rows.filter(r => r.market === "KOSPI"  && r.volume > 0).map(r => r.volume);
  const kosdaqVols = rows.filter(r => r.market === "KOSDAQ" && r.volume > 0).map(r => r.volume);
  const kospiP75  = pct(kospiVols,  0.75);
  const kosdaqP75 = pct(kosdaqVols, 0.75);

  // ── 1단계: 기본 필터 ────────────────────────────────────────────────────────
  const MIN_TURNOVER  = 500_000_000; // 5억 거래대금 미만 제외 (얇은 종목)
  const MIN_VOL_RATIO = 2.0;         // 시장 75th pct의 2배 이상 = 진짜 폭발

  const candidates = rows
    .filter(r =>
      r.change >= 2 &&                          // 최소 +2% 상승
      r.change < 28 &&                          // 상한가 근처 제외 (차익 위험)
      r.volume > 0 &&
      r.close >= 500 &&                         // 동전주 제외
      r.close * r.volume >= MIN_TURNOVER &&     // 거래대금 5억 이상
      !(r.ticker.length === 6 && r.ticker[5] !== "0"), // 우선주 제외
    )
    .map(r => {
      const baseVol = r.market === "KOSPI" ? kospiP75 : kosdaqP75;
      return { ...r, baseVol, volumeRatio: r.volume / baseVol };
    })
    .filter(r => r.volumeRatio >= MIN_VOL_RATIO);

  if (!candidates.length) return [];

  // ── 2단계: 상위 60개 선별 (스마트머니 조회 전 부하 방지) ─────────────────────
  // 1차 점수: 거래량 배율 + 등락률 + 거래대금 로그 가중치
  const preScore = (r: typeof candidates[0]) => {
    const vs = Math.min(40, (r.volumeRatio - 2) * 8);
    const cs = Math.min(25, r.change * 2.5);
    const ts = Math.min(15, Math.log10(r.close * r.volume / 100_000_000 + 1) * 10);
    return vs + cs + ts;
  };

  const top60 = [...candidates]
    .sort((a, b) => preScore(b) - preScore(a))
    .slice(0, 60);

  const tickers = top60.map(r => r.ticker);
  console.log(`[surge] 투자자 순매수 조회: ${tickers.length}개 종목`);

  const investorFlows = await fetchInvestorByStocks(todayStr, tickers).catch(() => []);
  const flowMap = new Map(investorFlows.map(f => [f.ticker, f]));

  // ── 3단계: 종합 점수 계산 ───────────────────────────────────────────────────
  const result: SurgeCandidate[] = top60.map(r => {
    const flow = flowMap.get(r.ticker);
    const inst = flow?.institution ?? 0;
    const fore = flow?.foreign ?? 0;
    const smart = inst + fore;
    const turnoverAeok = Math.round(r.close * r.volume / 100_000_000 * 10) / 10; // 억원

    // 거래량급증 (최대 40점): 75th pct 2배 초과분 기준
    const volScore = Math.min(40, (r.volumeRatio - 2) * 8);

    // 등락률 (최대 25점)
    const changeScore = Math.min(25, r.change * 2.5);

    // 거래대금 (최대 15점): 100억=10점, 500억=17→cap15점
    const turnoverScore = Math.min(15, Math.log10(turnoverAeok / 10 + 1) * 10);

    // 스마트머니 (최대 30점): 기관 2배 가중, 선형 스케일
    // 기존 log1p 방식 → 기관 30억이 겨우 17점이던 문제 수정
    const instScore  = inst  > 0 ? Math.min(20, inst  / 1.5) : 0; // 30억 = 20점
    const foreScore  = fore  > 0 ? Math.min(10, fore  / 3.0) : 0; // 30억 = 10점
    const smartScore = instScore + foreScore;

    const surgeScore = volScore + changeScore + turnoverScore + smartScore;

    // 신호 분류 (기준 강화)
    // breakout:     기관 순매수 10억 이상 + 7%+ 상승 — 진짜 기관이 실은 신호
    // accumulation: 스마트머니 5억 이상 + 3%+ 상승 — 의미있는 수급 유입
    // volume_spike: 거래량만 폭발 (개인 주도 or 뉴스성)
    let signal: SurgeCandidate["signal"] = "volume_spike";
    if (r.change >= 7 && inst >= 10)      signal = "breakout";
    else if (r.change >= 3 && smart >= 5) signal = "accumulation";

    return {
      ticker:      r.ticker,
      name:        r.name ?? r.ticker,
      market:      r.market ?? "KOSDAQ",
      change:      r.change,
      volume:      r.volume,
      turnover:    turnoverAeok,
      avgVolume:   r.baseVol,
      volumeRatio: Math.round(r.volumeRatio * 10) / 10,
      institution: inst,
      foreign:     fore,
      smartMoney:  smart,
      surgeScore:  Math.round(surgeScore * 10) / 10,
      themes:      themeMap.get(r.ticker) ?? [],
      signal,
    };
  });

  // ── 4단계: 신호 등급 → 점수 순 최종 정렬, 상위 25개 반환 ─────────────────────
  const sigRank: Record<SurgeCandidate["signal"], number> = {
    breakout: 2, accumulation: 1, volume_spike: 0,
  };
  const final = result
    .sort((a, b) => {
      const sd = sigRank[b.signal] - sigRank[a.signal];
      return sd !== 0 ? sd : b.surgeScore - a.surgeScore;
    })
    .slice(0, 25);

  console.log(`[surge] 완료: ${final.length}개 수급 폭발 종목 (breakout:${final.filter(x=>x.signal==="breakout").length} / accumulation:${final.filter(x=>x.signal==="accumulation").length} / spike:${final.filter(x=>x.signal==="volume_spike").length})`);
  return final;
}

// GET /api/market/surge — 폭발 조짐 종목 (항상 즉시 응답)
router.get("/market/surge", (_req, res) => {
  // 데이터 있으면 즉시 반환 (stale이어도)
  if (surgeCache && surgeCache.data.length > 0) {
    const stale = Date.now() - surgeCache.cachedAt > SURGE_TTL;
    if (stale && !surgeScanning) runSurgeScan();
    return res.json({
      data:     surgeCache.data,
      cachedAt: surgeCache.cachedAt,
      scanning: surgeScanning,
      cached:   true,
    });
  }
  // 데이터 없으면 백그라운드 스캔 트리거 + scanning:true 반환
  if (!surgeScanning) runSurgeScan();
  return res.json({ data: [], cachedAt: null, scanning: true });
});

// POST /api/market/surge/refresh — 강제 갱신
router.post("/market/surge/refresh", async (_req, res) => {
  await runSurgeScan();
  if (surgeCache) {
    return res.json({ data: surgeCache.data, cachedAt: surgeCache.cachedAt, scanning: false });
  }
  return res.status(500).json({ error: "스캔 실패" });
});

export default router;

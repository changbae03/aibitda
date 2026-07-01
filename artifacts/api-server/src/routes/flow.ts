/**
 * /api/market/flow  — 수급 레이더
 * · KOSPI / KOSDAQ 시장 전체 투자자별 순매수 (pykrx, 최근 5 영업일)
 * · 주요 KR 종목별 투자자 순매수 (KIS FHKST01010900)
 */
import { Router } from "express";
import { fetchInvestorData, fetchInvestorByStocks } from "../lib/pykrx-client.js";
import { pool } from "@workspace/db";

const router = Router();

const FLOW_CACHE_KEY = "market_flow_v2";
const FLOW_TTL_MS   = 30 * 60 * 1000; // 30분

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

/** ISO date "YYYY-MM-DD" → KRX format "YYYYMMDD" */
function toKRXDate(iso: string) { return iso.replace(/-/g, ""); }

async function buildFlowData(): Promise<FlowData> {
  // 최근 거래일을 찾기 위해 오늘~10일 전 범위 조회
  const today    = new Date().toISOString().slice(0, 10);
  const fromDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const todayKRX = toKRXDate(today);

  // ── 1. 시장 전체 수급 (pykrx) ──────────────────────────────────────────
  const [kospiRows, kosdaqRows] = await Promise.allSettled([
    fetchInvestorData("KOSPI",  fromDate, today),
    fetchInvestorData("KOSDAQ", fromDate, today),
  ]);

  const kospi  = kospiRows.status  === "fulfilled" ? kospiRows.value.slice(-5)  : [];
  const kosdaq = kosdaqRows.status === "fulfilled" ? kosdaqRows.value.slice(-5) : [];

  // 최신 거래일 확인 — pykrx 결과에서 가장 최근 날짜 사용
  const latestDate = kospi.at(-1)?.date
    ? toKRXDate(kospi.at(-1)!.date)
    : todayKRX;

  // ── 2. 종목별 수급 (pykrx — KIS 실시간 API는 장외 시간 0 반환) ─────────
  const stockCodes  = WATCH_STOCKS.map(s => s.code);
  const stockFlows  = await fetchInvestorByStocks(latestDate, stockCodes).catch(() => []);
  const flowMap     = new Map(stockFlows.map(f => [f.ticker, f]));

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

  console.log(`[flow] 종목 수급 완료 (${latestDate}): ${stocks.length}/${WATCH_STOCKS.length}개`);

  return {
    marketFlow: { kospi, kosdaq },
    stocks,
    updatedAt: new Date().toISOString(),
  };
}

router.get("/market/flow", async (_req, res) => {
  try {
    const now = Date.now();

    // 인메모리 캐시
    if (flowCache && now - flowCache.cachedAt < FLOW_TTL_MS) {
      return res.json(flowCache.data);
    }

    // DB 캐시
    try {
      const dbRow = await pool.query<{ data: FlowData }>(
        `SELECT data FROM system_cache WHERE key = $1 AND expires_at > NOW()`,
        [FLOW_CACHE_KEY]
      );
      if (dbRow.rows[0]?.data) {
        const d = typeof dbRow.rows[0].data === "string"
          ? JSON.parse(dbRow.rows[0].data as any)
          : dbRow.rows[0].data;
        flowCache = { data: d, cachedAt: now };
        return res.json(d);
      }
    } catch {}

    const data = await buildFlowData();

    // 저장
    flowCache = { data, cachedAt: now };
    const expiresAt = new Date(now + FLOW_TTL_MS);
    pool.query(
      `INSERT INTO system_cache (key, data, expires_at)
       VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, expires_at = EXCLUDED.expires_at`,
      [FLOW_CACHE_KEY, JSON.stringify(data), expiresAt]
    ).catch(() => {});

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
    flowCache = { data, cachedAt: Date.now() };
    return res.json(data);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? "새로고침 실패" });
  }
});

export default router;

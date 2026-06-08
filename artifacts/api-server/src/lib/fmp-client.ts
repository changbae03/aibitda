/**
 * fmp-client.ts
 * Financial Modeling Prep API 클라이언트
 *
 * 용도:
 *  1. KR/US 주식 핵심 재무지표 (PER, PBR, ROE, OPM, EPS, BPS)
 *  2. 연간 손익계산서 · 재무상태표 (최근 4년)
 *  3. AI 분석 컨텍스트 문자열 빌더
 *
 * 캐시: DB(fmp_cache 테이블) 24시간
 * 무료 플랜: 250req/day → 분석 요청 시에만 호출, 하베스터 배치 X
 *
 * 심볼 형식:
 *  - KR KOSPI:  005930.KS
 *  - KR KOSDAQ: 035720.KQ
 *  - US:        AAPL, MSFT, ...
 */

import { pool } from "@workspace/db";

const BASE = "https://financialmodelingprep.com/api/v3";
const API_KEY = process.env.FMP_API_KEY ?? "";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24시간
const FETCH_TIMEOUT = 15_000;

// ─── DB 캐시 테이블 초기화 ────────────────────────────────────────────────────
let _tableReady = false;
async function ensureTable() {
  if (_tableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fmp_cache (
      symbol      TEXT NOT NULL,
      data_type   TEXT NOT NULL,
      payload     JSONB NOT NULL,
      fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (symbol, data_type)
    )
  `);
  _tableReady = true;
}

// ─── 공통 fetch 헬퍼 ─────────────────────────────────────────────────────────
async function fmpFetch<T>(path: string): Promise<T | null> {
  if (!API_KEY) {
    console.warn("[FMP] FMP_API_KEY 미설정");
    return null;
  }
  const sep = path.includes("?") ? "&" : "?";
  const url = `${BASE}${path}${sep}apikey=${API_KEY}`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) {
      console.warn(`[FMP] HTTP ${res.status} for ${path}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (e: any) {
    console.warn(`[FMP] fetch 실패 (${path}):`, e?.message?.slice(0, 80));
    return null;
  }
}

// ─── 캐시 Read/Write ──────────────────────────────────────────────────────────
async function readCache<T>(symbol: string, dataType: string): Promise<T | null> {
  await ensureTable();
  const r = await pool.query(
    `SELECT payload, fetched_at FROM fmp_cache WHERE symbol=$1 AND data_type=$2`,
    [symbol, dataType]
  );
  if (!r.rows[0]) return null;
  const age = Date.now() - new Date(r.rows[0].fetched_at).getTime();
  if (age > CACHE_TTL_MS) return null;
  return r.rows[0].payload as T;
}

async function writeCache(symbol: string, dataType: string, payload: unknown) {
  await ensureTable();
  await pool.query(
    `INSERT INTO fmp_cache (symbol, data_type, payload, fetched_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (symbol, data_type) DO UPDATE
     SET payload=$3, fetched_at=NOW()`,
    [symbol, dataType, JSON.stringify(payload)]
  );
}

// ─── FMP 타입 정의 ────────────────────────────────────────────────────────────
export interface FmpProfile {
  symbol: string;
  price: number;
  mktCap: number;
  pe: number | null;
  priceToSalesRatio: number | null;
  pbRatio: number | null;
  beta: number | null;
  industry: string;
  sector: string;
  description: string;
  country: string;
  currency: string;
  exchange: string;
  companyName: string;
  eps: number | null;
}

export interface FmpKeyMetrics {
  date: string;
  revenuePerShare: number | null;
  netIncomePerShare: number | null; // EPS
  bookValuePerShare: number | null; // BPS
  peRatio: number | null;
  pbRatio: number | null;
  roic: number | null;
  roe: number | null;
  roa: number | null;
  debtToEquity: number | null;
  operatingCashFlowPerShare: number | null;
  freeCashFlowPerShare: number | null;
  dividendYield: number | null;
  enterpriseValueOverEBITDA: number | null;
}

export interface FmpIncomeStatement {
  date: string;
  calendarYear: string;
  period: string;
  revenue: number | null;
  grossProfit: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  ebitda: number | null;
  eps: number | null;
  epsdiluted: number | null;
  grossProfitRatio: number | null;
  operatingIncomeRatio: number | null;
  netIncomeRatio: number | null;
}

export interface FmpBalanceSheet {
  date: string;
  calendarYear: string;
  cashAndCashEquivalents: number | null;
  totalAssets: number | null;
  totalDebt: number | null;
  netDebt: number | null;
  totalEquity: number | null;
  totalLiabilities: number | null;
}

// ─── 공개 API 함수 ────────────────────────────────────────────────────────────

/** 기업 프로필 (PER, PBR, 현재가, 시가총액, 업종) */
export async function getFmpProfile(symbol: string): Promise<FmpProfile | null> {
  const cached = await readCache<FmpProfile[]>(symbol, "profile");
  if (cached?.[0]) return cached[0];

  const data = await fmpFetch<FmpProfile[]>(`/profile/${symbol}`);
  if (!data?.[0]) return null;
  await writeCache(symbol, "profile", data);
  return data[0];
}

/** 핵심 재무지표 (ROE, OPM, EV/EBITDA 등) — 최근 4개년 */
export async function getFmpKeyMetrics(symbol: string, limit = 4): Promise<FmpKeyMetrics[]> {
  const cached = await readCache<FmpKeyMetrics[]>(symbol, "key-metrics");
  if (cached?.length) return cached;

  const data = await fmpFetch<FmpKeyMetrics[]>(`/key-metrics/${symbol}?limit=${limit}`);
  if (!data?.length) return [];
  await writeCache(symbol, "key-metrics", data);
  return data;
}

/** 손익계산서 (매출, 영업이익, 순이익, EBITDA) — 최근 4개년 */
export async function getFmpIncomeStatement(symbol: string, limit = 4): Promise<FmpIncomeStatement[]> {
  const cached = await readCache<FmpIncomeStatement[]>(symbol, "income");
  if (cached?.length) return cached;

  const data = await fmpFetch<FmpIncomeStatement[]>(`/income-statement/${symbol}?limit=${limit}`);
  if (!data?.length) return [];
  await writeCache(symbol, "income", data);
  return data;
}

/** 재무상태표 (현금, 자산, 부채, 자본) — 최근 4개년 */
export async function getFmpBalanceSheet(symbol: string, limit = 4): Promise<FmpBalanceSheet[]> {
  const cached = await readCache<FmpBalanceSheet[]>(symbol, "balance");
  if (cached?.length) return cached;

  const data = await fmpFetch<FmpBalanceSheet[]>(`/balance-sheet-statement/${symbol}?limit=${limit}`);
  if (!data?.length) return [];
  await writeCache(symbol, "balance", data);
  return data;
}

// ─── AI 분석 컨텍스트 빌더 ────────────────────────────────────────────────────

function fmtNum(v: number | null | undefined, decimals = 1, suffix = ""): string {
  if (v == null) return "N/A";
  return `${v.toFixed(decimals)}${suffix}`;
}

function fmtBillion(v: number | null | undefined, currency: string): string {
  if (v == null) return "N/A";
  const b = v / 1e9;
  return b >= 1 ? `${b.toFixed(1)}B ${currency}` : `${(v / 1e6).toFixed(0)}M ${currency}`;
}

/**
 * AI 분석용 FMP 컨텍스트 문자열 생성
 * - profile: 밸류에이션 지표
 * - income: 매출/이익 추이
 * - balance: 재무 건전성
 */
export async function buildFmpContext(symbol: string): Promise<string | null> {
  if (!API_KEY) return null;

  try {
    const [profile, incomeList, balanceList, keyMetrics] = await Promise.all([
      getFmpProfile(symbol),
      getFmpIncomeStatement(symbol, 4),
      getFmpBalanceSheet(symbol, 4),
      getFmpKeyMetrics(symbol, 4),
    ]);

    if (!profile && !incomeList.length) return null;

    const currency = profile?.currency ?? "USD";
    const lines: string[] = [];

    lines.push(`[⭐ FMP(Financial Modeling Prep) 재무 데이터 — ${symbol}]`);
    lines.push(`⚠️ 이 데이터는 FMP 원천 데이터입니다. Yahoo Finance 수치와 다를 경우 이 값을 참고하세요.`);

    // ── 밸류에이션 ──────────────────────────────────────────────────────────
    if (profile) {
      lines.push(`\n[밸류에이션]`);
      lines.push(`현재가: ${fmtNum(profile.price, 0)} ${currency}`);
      lines.push(`시가총액: ${fmtBillion(profile.mktCap, currency)}`);
      lines.push(`PER(TTM): ${fmtNum(profile.pe, 1)}x`);
      lines.push(`PBR: ${fmtNum(profile.pbRatio, 2)}x`);
      lines.push(`EPS: ${fmtNum(profile.eps, 2)} ${currency}`);
      if (profile.beta != null) lines.push(`Beta: ${fmtNum(profile.beta, 2)}`);
    }

    // ── EV/EBITDA, ROE, ROA ───────────────────────────────────────────────
    if (keyMetrics[0]) {
      const km = keyMetrics[0];
      lines.push(`\n[FMP 핵심 지표 — ${km.date} 기준]`);
      if (km.enterpriseValueOverEBITDA != null) lines.push(`EV/EBITDA: ${fmtNum(km.enterpriseValueOverEBITDA, 1)}x`);
      if (km.roe != null) lines.push(`ROE: ${fmtNum(km.roe * 100, 1)}%`);
      if (km.roa != null) lines.push(`ROA: ${fmtNum(km.roa * 100, 1)}%`);
      if (km.roic != null) lines.push(`ROIC: ${fmtNum(km.roic * 100, 1)}%`);
      if (km.debtToEquity != null) lines.push(`부채비율(D/E): ${fmtNum(km.debtToEquity, 2)}x`);
      if (km.dividendYield != null) lines.push(`배당수익률: ${fmtNum(km.dividendYield * 100, 2)}%`);
      if (km.freeCashFlowPerShare != null) lines.push(`FCF/주: ${fmtNum(km.freeCashFlowPerShare, 2)} ${currency}`);
      if (km.bookValuePerShare != null) lines.push(`BPS: ${fmtNum(km.bookValuePerShare, 0)} ${currency}`);
    }

    // ── 손익계산서 추이 ────────────────────────────────────────────────────
    if (incomeList.length) {
      lines.push(`\n[손익계산서 추이 (FMP)]`);
      lines.push(`연도 | 매출 | 영업이익(OPM) | 순이익(NPM) | EBITDA | EPS`);
      for (const inc of incomeList) {
        const yr = inc.calendarYear ?? inc.date?.slice(0, 4) ?? "-";
        lines.push(
          `${yr} | ${fmtBillion(inc.revenue, currency)} | ` +
          `${fmtBillion(inc.operatingIncome, currency)}(${fmtNum(inc.operatingIncomeRatio != null ? inc.operatingIncomeRatio * 100 : null, 1)}%) | ` +
          `${fmtBillion(inc.netIncome, currency)}(${fmtNum(inc.netIncomeRatio != null ? inc.netIncomeRatio * 100 : null, 1)}%) | ` +
          `${fmtBillion(inc.ebitda, currency)} | ` +
          `EPS ${fmtNum(inc.epsdiluted, 2)} ${currency}`
        );
      }
    }

    // ── 재무상태표 ─────────────────────────────────────────────────────────
    if (balanceList[0]) {
      const b = balanceList[0];
      lines.push(`\n[재무상태표 최근년도 — ${b.date} (FMP)]`);
      lines.push(`현금: ${fmtBillion(b.cashAndCashEquivalents, currency)}`);
      lines.push(`총자산: ${fmtBillion(b.totalAssets, currency)}`);
      lines.push(`총부채: ${fmtBillion(b.totalLiabilities, currency)}`);
      lines.push(`총차입금: ${fmtBillion(b.totalDebt, currency)}`);
      lines.push(`자본총계: ${fmtBillion(b.totalEquity, currency)}`);
      if (b.netDebt != null) {
        lines.push(
          b.netDebt < 0
            ? `순현금: ${fmtBillion(-b.netDebt, currency)}`
            : `순부채: ${fmtBillion(b.netDebt, currency)}`
        );
      }
    }

    return lines.join("\n");
  } catch (e: any) {
    console.warn(`[FMP] buildFmpContext 실패 (${symbol}):`, e?.message?.slice(0, 80));
    return null;
  }
}

/**
 * 하베스터용 — PER/PBR만 빠르게 가져오기 (profile 1회 호출)
 * Yahoo Finance에서 PER이 null일 때 fallback으로 사용
 */
export async function getFmpValuation(symbol: string): Promise<{ per: number | null; pbr: number | null; eps: number | null } | null> {
  const profile = await getFmpProfile(symbol);
  if (!profile) return null;
  return {
    per: profile.pe,
    pbr: profile.pbRatio,
    eps: profile.eps,
  };
}

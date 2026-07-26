/**
 * dart-store.ts
 * DART OpenAPI에서 분기·연간 재무 데이터를 가져와 DB에 시계열로 쌓는 모듈.
 * - 연간보고서 1회 호출 시 thstrm/frmtrm/bfefrmtrm으로 3개년 데이터 동시 확보
 * - 분기보고서 4종(Q1/Q2/Q3/FY) 호출로 분기별 시계열 구성
 * - ON CONFLICT DO UPDATE로 멱등성 보장 (중복 없이 최신화)
 * - 30일 캐시 유효 기간으로 API 호출 절약
 */

import { isKoreanTicker } from "@workspace/shared";
import { pool, readJsonb } from "@workspace/db";
import { getCorpCodeFromCache } from "./dart-corp-cache.js";

// ─── reprt_code 정의 ─────────────────────────────────────────────────────────

const REPRT_CODES = [
  { code: "11011", label: "FY",      quarter: 4 },
  { code: "11014", label: "Q3",      quarter: 3 },
  { code: "11012", label: "Q2(H1)",  quarter: 2 },
  { code: "11013", label: "Q1",      quarter: 1 },
] as const;

// ─── Table init (멱등) ────────────────────────────────────────────────────────

let tableReady = false;

async function ensureTable(): Promise<void> {
  if (tableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ticker_financials (
      id              SERIAL PRIMARY KEY,
      ticker          VARCHAR(20)  NOT NULL,
      corp_code       VARCHAR(20)  NOT NULL DEFAULT '',
      bsns_year       INTEGER      NOT NULL,
      reprt_code      VARCHAR(5)   NOT NULL,
      period_label    VARCHAR(16)  NOT NULL DEFAULT '',
      fs_type         VARCHAR(3)   NOT NULL,
      revenue         BIGINT,
      operating_income BIGINT,
      net_income      BIGINT,
      total_assets    BIGINT,
      equity          BIGINT,
      cash            BIGINT,
      total_debt      BIGINT,
      eps             BIGINT,
      bps             BIGINT,
      fetched_at      TIMESTAMPTZ  DEFAULT NOW(),
      UNIQUE(ticker, bsns_year, reprt_code, fs_type)
    )
  `);
  // 기존 테이블에 누락된 컬럼 추가 (순차 마이그레이션)
  const migrations = [
    `ALTER TABLE ticker_financials ADD COLUMN IF NOT EXISTS corp_code       VARCHAR(20) NOT NULL DEFAULT ''`,
    `ALTER TABLE ticker_financials ADD COLUMN IF NOT EXISTS period_label    VARCHAR(16) NOT NULL DEFAULT ''`,
    `ALTER TABLE ticker_financials ADD COLUMN IF NOT EXISTS revenue         BIGINT`,
    `ALTER TABLE ticker_financials ADD COLUMN IF NOT EXISTS operating_income BIGINT`,
    `ALTER TABLE ticker_financials ADD COLUMN IF NOT EXISTS net_income      BIGINT`,
    `ALTER TABLE ticker_financials ADD COLUMN IF NOT EXISTS total_assets    BIGINT`,
    `ALTER TABLE ticker_financials ADD COLUMN IF NOT EXISTS equity          BIGINT`,
    `ALTER TABLE ticker_financials ADD COLUMN IF NOT EXISTS cash            BIGINT`,
    `ALTER TABLE ticker_financials ADD COLUMN IF NOT EXISTS total_debt      BIGINT`,
    `ALTER TABLE ticker_financials ADD COLUMN IF NOT EXISTS eps             BIGINT`,
    `ALTER TABLE ticker_financials ADD COLUMN IF NOT EXISTS bps             BIGINT`,
    `ALTER TABLE ticker_financials ADD COLUMN IF NOT EXISTS fetched_at      TIMESTAMPTZ DEFAULT NOW()`,
    // 순차입금(이자부부채 − 현금). total_debt와 **다른 값**이다.
    //   total_debt = 부채총계(매입채무·충당부채까지 포함) — 한화시스템 5.3조
    //   net_debt   = 이자부부채 − 현금성자산            — 한화시스템 0.7조 수준
    // 둘을 혼동하면 기업가치에서 7배를 잘못 빼게 된다.
    // 예전에는 IFRS 코드로 정확히 계산해놓고 프롬프트에 넣은 뒤 버렸다 — 저장해서 재사용한다.
    `ALTER TABLE ticker_financials ADD COLUMN IF NOT EXISTS net_debt             BIGINT`,
    `ALTER TABLE ticker_financials ADD COLUMN IF NOT EXISTS interest_bearing_debt BIGINT`,
    `CREATE INDEX IF NOT EXISTS idx_ticker_financials_ticker ON ticker_financials (ticker, bsns_year DESC)`,
  ];
  for (const sql of migrations) {
    try { await pool.query(sql); } catch { /* 이미 존재하면 무시 */ }
  }
  tableReady = true;
}

// ─── DART corp_code 조회 ─────────────────────────────────────────────────────
// 우선순위: ① 공유 인메모리 캐시(themes.ts가 로드 후 setCorpCodeMap 호출) →
//           ② system_cache DB (TTL 만료돼도 사용 — corp_code는 거의 변하지 않음) →
//           ③ ticker_financials DB → ④ DART API 직접

export async function lookupCorpCode(stockCode: string): Promise<string | null> {
  const key = process.env["DART_API_KEY"];
  if (!key) return null;

  // 0순위: 공유 인메모리 캐시 (themes.ts가 서버 시작 시 로드한 3967개 맵)
  const cached = getCorpCodeFromCache(stockCode);
  if (cached) {
    console.log(`[dart-store] ${stockCode} corp_code=${cached} (in-memory cache)`);
    return cached;
  }

  // 1순위: system_cache DB — TTL 만료돼도 허용 (corp_code는 거의 불변)
  try {
    const r = await pool.query<{ data: unknown }>(
      `SELECT data FROM system_cache WHERE key = 'dart_corp_code_map_v1' ORDER BY expires_at DESC LIMIT 1`
    );
    if (r.rows[0]?.data) {
      // ⚠️ system_cache.data는 jsonb다 — pg 드라이버가 **이미 객체로** 돌려준다.
      // 예전에는 여기서 무조건 JSON.parse를 걸었고, 객체를 넣으면 "[object Object]"가 되어
      // 예외가 났다. 그 예외를 아래 catch가 조용히 삼켜, 3,977개짜리 맵이 멀쩡히 있는데도
      // 이 단계가 **항상 실패**했다. 그래서 이미 분석한 종목(ticker_financials)만 겨우
      // corp_code를 얻고 나머지는 폐기된 API로 흘러가 null이 됐다.
      const map = readJsonb<Record<string, string>>(r.rows[0].data);
      const found = map?.[stockCode];
      if (found) {
        console.log(`[dart-store] ${stockCode} corp_code=${found} (system_cache)`);
        return found;
      }
    }
  } catch { /* fallthrough */ }

  // 2순위: ticker_financials에 이미 저장된 corp_code
  try {
    // corp_code 컬럼은 기본값이 ''이라 값이 비어 있는 과거 행이 섞여 있다.
    // 정렬 없이 DISTINCT + LIMIT 1로 뽑으면 그 빈 행이 집혀 조회가 실패하고
    // (실측) 매번 DART API를 다시 부르게 된다. 비어 있지 않은 값만, 최신 것부터 고른다.
    const r = await pool.query<{ corp_code: string }>(
      `SELECT corp_code FROM ticker_financials
        WHERE ticker = $1 AND corp_code <> ''
        ORDER BY fetched_at DESC NULLS LAST
        LIMIT 1`,
      [stockCode]
    );
    if (r.rows[0]?.corp_code) {
      console.log(`[dart-store] ${stockCode} corp_code=${r.rows[0].corp_code} (ticker_financials)`);
      return r.rows[0].corp_code;
    }
  } catch { /* fallthrough */ }

  // 3순위: DART OpenAPI 직접 조회 (네트워크 실패 가능)
  try {
    const res = await fetch(
      `https://opendart.fss.or.kr/api/company.json?crtfc_key=${key}&stock_code=${stockCode}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const data = await res.json() as any;
    return data.status === "000" ? (data.corp_code ?? null) : null;
  } catch { return null; }
}

// ─── DART fnlttSinglAcnt 호출 ────────────────────────────────────────────────

type DartRow = {
  sj_div: string;
  account_nm: string;
  thstrm_amount?: string;
  frmtrm_amount?: string;
  bfefrmtrm_amount?: string;
};

async function fetchDartPeriod(
  corpCode: string,
  bsnsYear: number,
  reprtCode: string,
  fsType: "CFS" | "OFS",
  apiKey: string
): Promise<DartRow[] | null> {
  try {
    // fnlttSinglAcnt(주요계정)은 30개 계정만 준다 — 현금·차입금·주당이익이 빠져
    // 밸류에이션에 필요한 대차대조표 항목을 채울 수 없다(실측: 20행 전부 NULL).
    // fnlttSinglAcntAll(전체 재무제표)은 198개를 주므로 이쪽을 쓴다.
    // 주의: 전체본은 손익계산서를 sj_div="IS"가 아니라 "CIS"로 분류한다 — findIS 참고.
    const url =
      `https://opendart.fss.or.kr/api/fnlttSinglAcntAll.json` +
      `?crtfc_key=${apiKey}&corp_code=${corpCode}` +
      `&bsns_year=${bsnsYear}&reprt_code=${reprtCode}&fs_div=${fsType}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) return null;
    const data = await res.json() as any;
    if (data.status !== "000" || !Array.isArray(data.list) || data.list.length === 0) return null;
    return data.list as DartRow[];
  } catch { return null; }
}

// ─── 파싱 헬퍼 ───────────────────────────────────────────────────────────────

function parseAmt(s: string | null | undefined): number | null {
  if (!s) return null;
  const n = Number(String(s).replace(/,/g, ""));
  return isNaN(n) ? null : n;
}

type AField = "thstrm_amount" | "frmtrm_amount" | "bfefrmtrm_amount";

/**
 * 손익계산서 계정 조회.
 * 주요계정 API는 "IS", 전체 재무제표 API는 "CIS"(포괄손익계산서)로 분류한다.
 * 둘 다 받아야 API를 바꿔도 매출·영업이익이 끊기지 않는다.
 */
/**
 * 계정명 매칭은 "정확히 일치"를 먼저 시도하고, 없을 때만 부분 일치로 넘어간다.
 *
 * 부분 일치만 쓰면 다른 계정을 잘못 집는다. 실제 사고:
 *   "부채총계"로 찾았더니 "자본과부채총계"(=자산총계, 3,746억)가 먼저 걸려
 *   실제 부채총계 1,094억 대신 3배 넘는 값이 저장됐다.
 * 반대로 "영업이익"은 실제 계정명이 "영업이익(손실)"이라 부분 일치가 필요하다.
 */
function matchRow(rows: DartRow[], name: string, ok: (sj: string) => boolean): DartRow | undefined {
  const norm = (s: string | undefined) => (s ?? "").replace(/\s/g, "");
  return rows.find(r => ok(r.sj_div) && norm(r.account_nm) === name)
      ?? rows.find(r => ok(r.sj_div) && norm(r.account_nm).includes(name));
}

function findIS(rows: DartRow[], names: string[], field: AField): number | null {
  for (const name of names) {
    const row = matchRow(rows, name, (sj) => sj === "IS" || sj === "CIS");
    if (row) return parseAmt(row[field]);
  }
  return null;
}

function findBS(rows: DartRow[], names: string[], field: AField): number | null {
  for (const name of names) {
    const row = matchRow(rows, name, (sj) => sj === "BS");
    if (row) return parseAmt(row[field]);
  }
  return null;
}

function extractFinancials(rows: DartRow[], field: AField) {
  const revenue = findIS(rows, ["매출액","공사매출","건설매출","도급매출","영업수익","이자수익","보험료수익","순이자이익"], field);
  const operatingIncome = findIS(rows, ["영업이익","영업손실"], field);
  const netIncome = findIS(rows, ["당기순이익","당기순손실"], field);
  const totalAssets = findBS(rows, ["자산총계"], field);
  const equity = findBS(rows, ["자본총계"], field);
  // 현금성 자산: 현금및현금성자산 + 단기금융상품.
  // DART는 둘을 별도 계정으로 낸다(메디포스트 2025 3Q 기준 350억 + 20억).
  // 장기금융상품은 즉시 유동화가 어려워 제외한다.
  const cashOnly = findBS(rows, ["현금및현금성자산","현금및단기금융상품","현금성자산"], field);
  const shortTermInvest = findBS(rows, ["단기금융상품"], field);
  const cash = cashOnly == null && shortTermInvest == null
    ? null
    : (cashOnly ?? 0) + (shortTermInvest ?? 0);

  const eps = findIS(rows, ["기본주당이익","기본주당순이익","주당순이익","주당이익"], field);
  const bps = findBS(rows, ["주당순자산","주당자산가치"], field);

  // 부채는 '부채총계'를 쓴다.
  // 예전에는 단기차입금·장기차입금·사채… 를 각각 찾아 더했는데, DART 실제 계정명은
  // "유동성 금융기관 차입금(사채 제외)" 처럼 길고 회사마다 달라 패턴이 거의 맞지 않았고
  // (실측: 20행 전부 NULL), 맞더라도 "(사채 포함)"·"(사채 제외)" 항목이 함께 걸려
  // 이중 합산될 위험이 있었다. 부채총계는 모든 회사·모든 보고서에 존재하고 모호하지 않다.
  // 이자부부채만 필요하면 AI가 본문에서 별도로 판단하도록 두는 편이 안전하다.
  const totalDebt = findBS(rows, ["부채총계"], field);

  return { revenue, operatingIncome, netIncome, totalAssets, equity, cash, totalDebt, eps, bps };
}

// ─── 캐시 유효 확인 ──────────────────────────────────────────────────────────

/**
 * 다시 받아올 필요가 없는지 판단한다.
 *
 * 시간만 보면 안 된다. 예전에는 주요계정 API를 쓰느라 대차대조표(현금·부채총계)가
 * 통째로 비어 있었는데, 30일 캐시 때문에 코드를 고쳐도 한 달간 그 빈 행이 그대로
 * 유지된다. 그래서 "받은 지 얼마 안 됐고 + 필요한 항목이 채워져 있을 때"만
 * 최신으로 인정한다. 부채총계는 모든 회사·보고서에 존재하므로 완전성 판정 기준으로 쓴다.
 */
async function isFresh(ticker: string, bsnsYear: number, reprtCode: string): Promise<boolean> {
  try {
    const r = await pool.query(
      `SELECT 1 FROM ticker_financials
       WHERE ticker=$1 AND bsns_year=$2 AND reprt_code=$3
         AND fetched_at > NOW() - INTERVAL '30 days'
         AND total_debt IS NOT NULL
       LIMIT 1`,
      [ticker, bsnsYear, reprtCode]
    );
    return r.rows.length > 0;
  } catch { return false; }
}

// ─── DB upsert ───────────────────────────────────────────────────────────────

async function upsertFinancial(
  ticker: string, corpCode: string, bsnsYear: number,
  reprtCode: string, periodLabel: string, fsType: "CFS" | "OFS",
  f: ReturnType<typeof extractFinancials>
): Promise<void> {
  if (f.revenue === null && f.operatingIncome === null && f.netIncome === null) return;
  await pool.query(`
    INSERT INTO ticker_financials
      (ticker, corp_code, bsns_year, reprt_code, period_label, fs_type,
       revenue, operating_income, net_income, total_assets, equity, cash, total_debt, eps, bps)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    ON CONFLICT (ticker, bsns_year, reprt_code, fs_type) DO UPDATE SET
      revenue=EXCLUDED.revenue, operating_income=EXCLUDED.operating_income,
      net_income=EXCLUDED.net_income, total_assets=EXCLUDED.total_assets,
      equity=EXCLUDED.equity, cash=EXCLUDED.cash, total_debt=EXCLUDED.total_debt,
      eps=EXCLUDED.eps, bps=EXCLUDED.bps, fetched_at=NOW()
  `, [ticker, corpCode, bsnsYear, reprtCode, periodLabel, fsType,
      f.revenue, f.operatingIncome, f.netIncome, f.totalAssets,
      f.equity, f.cash, f.totalDebt, f.eps, f.bps]);
}

/**
 * IFRS 코드로 집계한 순차입금을 남긴다.
 *
 * 예전에는 분석할 때마다 DART 전체 재무제표를 받아 순차입금을 계산하고, 프롬프트에
 * 넣은 뒤 버렸다. 같은 종목을 다시 분석하면 다시 받았고, 무엇보다 **저장된 곳이 없어서
 * 다른 코드가 쓸 수 없었다** — 목표주가 검산도, 입력 점검도 불가능했다.
 *
 * total_debt(부채총계)와 반드시 구분할 것. 한화시스템 기준 부채총계 5.3조 vs 순차입금
 * 0.7조 수준이다. 기업가치에서 빼야 하는 것은 후자다.
 */
export async function saveNetDebt(
  ticker: string,
  corpCode: string,
  bsnsYear: number,
  fsType: "CFS" | "OFS",
  netDebt: number,
  interestBearingDebt: number,
): Promise<void> {
  try {
    await ensureTable();
    await pool.query(`
      INSERT INTO ticker_financials
        (ticker, corp_code, bsns_year, reprt_code, period_label, fs_type,
         net_debt, interest_bearing_debt)
      VALUES ($1,$2,$3,'11011','FY',$4,$5,$6)
      ON CONFLICT (ticker, bsns_year, reprt_code, fs_type) DO UPDATE SET
        net_debt = EXCLUDED.net_debt,
        interest_bearing_debt = EXCLUDED.interest_bearing_debt,
        fetched_at = NOW()
    `, [ticker, corpCode, bsnsYear, fsType, Math.round(netDebt), Math.round(interestBearingDebt)]);
  } catch (e) {
    console.warn(`[dart-store] ${ticker} 순차입금 저장 실패:`, (e as Error)?.message?.slice(0, 80));
  }
}

// ─── 메인: 분기·연간 데이터 수집 및 저장 ──────────────────────────────────────

/**
 * 주어진 한국 종목(6자리 코드)에 대해 DART 분기·연간 재무 데이터를 가져와 DB에 저장.
 * 30일 내 이미 수집된 데이터는 건너뜀.
 * 분석 완료 후 백그라운드에서 호출하도록 설계됨.
 */
export async function fetchAndStoreDartQuarterly(stockCode: string): Promise<void> {
  const key = process.env["DART_API_KEY"];
  if (!key) return;
  if (!isKoreanTicker(stockCode)) return;

  try {
    await ensureTable();

    const corpCode = await lookupCorpCode(stockCode);
    if (!corpCode) {
      console.warn(`[dart-store] ${stockCode} corp_code 조회 실패`);
      return;
    }

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // 1-12

    // 연간: 최근 3년
    const annualYears = [currentYear - 1, currentYear - 2, currentYear - 3];
    // 분기: 기본 과거 2년 + 올해 이미 제출된 분기 포함
    // DART 분기보고서 제출 마감: Q1(3월말) → 5월15일, Q2(6월말) → 8월14일, Q3(9월말) → 11월14일
    const quarterYears = [currentYear - 1, currentYear - 2];

    // 올해 분기 중 제출 마감이 지난 분기는 currentYear도 포함
    // Q1(11013): 5월 이후, Q2(11012): 8월 이후, Q3(11014): 11월 이후
    const currentYearQuarters = new Set<string>();
    if (currentMonth >= 5)  currentYearQuarters.add("11013"); // Q1
    if (currentMonth >= 8)  currentYearQuarters.add("11012"); // Q2
    if (currentMonth >= 11) currentYearQuarters.add("11014"); // Q3

    for (const { code, label } of REPRT_CODES) {
      const years = code === "11011"
        ? annualYears
        : currentYearQuarters.has(code)
          ? [currentYear, ...quarterYears]
          : quarterYears;

      for (const year of years) {
        if (await isFresh(stockCode, year, code)) {
          continue;
        }

        // CFS 우선, OFS fallback
        let rows: DartRow[] | null = null;
        let fsType: "CFS" | "OFS" = "CFS";
        rows = await fetchDartPeriod(corpCode, year, code, "CFS", key);
        if (!rows) {
          rows = await fetchDartPeriod(corpCode, year, code, "OFS", key);
          fsType = "OFS";
        }
        if (!rows) {
          continue;
        }

        // 연간 보고서: 당기(thstrm) + 전기(frmtrm) + 전전기(bfefrmtrm) 동시 추출 → 3개년 저장
        const fields: { field: AField; yearOffset: number }[] =
          code === "11011"
            ? [
                { field: "thstrm_amount", yearOffset: 0 },
                { field: "frmtrm_amount", yearOffset: -1 },
                { field: "bfefrmtrm_amount", yearOffset: -2 },
              ]
            : [{ field: "thstrm_amount", yearOffset: 0 }]; // 분기: 당기만

        for (const { field, yearOffset } of fields) {
          const storageYear = year + yearOffset;
          const periodLabel = `${storageYear} ${label}`;
          const fin = extractFinancials(rows, field);
          await upsertFinancial(stockCode, corpCode, storageYear, code, periodLabel, fsType, fin);
        }

        await new Promise(r => setTimeout(r, 400)); // DART API 레이트 리밋 배려
      }
    }

    console.log(`[dart-store] ${stockCode} 수집 완료`);
  } catch (e) {
    console.error(`[dart-store] ${stockCode} 수집 오류:`, e);
  }
}

// ─── AI 컨텍스트 생성 ─────────────────────────────────────────────────────────

function fmtKrw(v: number | null): string {
  if (v === null) return "N/A";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000_000_000) return `${sign}${(abs / 1_000_000_000_000).toFixed(2)}조원`;
  if (abs >= 100_000_000)       return `${sign}${Math.round(abs / 100_000_000)}억원`;
  return `${sign}${abs.toLocaleString("ko-KR")}원`;
}

function opm(revenue: bigint | null, opIncome: bigint | null): string {
  if (!revenue || !opIncome || revenue === BigInt(0)) return "";
  const pct = (Number(opIncome) / Number(revenue) * 100).toFixed(1);
  return ` (OPM ${pct}%)`;
}

/**
 * DB에 저장된 분기·연간 재무 시계열을 AI 프롬프트용 문자열로 반환.
 * 데이터가 없으면 null 반환.
 */
export async function getDartHistoricalContext(stockCode: string): Promise<string | null> {
  if (!isKoreanTicker(stockCode)) return null;
  try {
    await ensureTable();
    const r = await pool.query<{
      period_label: string; fs_type: string;
      revenue: string | null; operating_income: string | null;
      net_income: string | null; equity: string | null;
      cash: string | null; total_debt: string | null;
      eps: string | null; bps: string | null;
    }>(
      `SELECT period_label, fs_type,
              revenue, operating_income, net_income,
              equity, cash, total_debt, eps, bps
       FROM ticker_financials
       WHERE ticker = $1
       ORDER BY bsns_year DESC, reprt_code ASC
       LIMIT 24`,
      [stockCode]
    );

    if (r.rows.length === 0) return null;

    const lines: string[] = [
      `\n[📊 DART 시계열 재무 데이터 — ${stockCode}]`,
      `⚠️ DART OpenAPI 원천 데이터. 현 시점 기준 최신 수집분. 단위 표기 포함.`,
      `※ 여기 나온 자본총계·현금성자산·부채총계는 공시 원문 값이다. 밸류에이션에서 순현금·`
      + `자본을 쓸 때 추정하지 말고 이 값을 사용할 것. '부채총계'는 매입채무 등을 포함한 총액이며 `
      + `이자부차입금이 아니다 — 차입금만 필요하면 그 사실을 명시하고 별도 근거를 밝힐 것.`,
    ];

    // ── 최신 분기 사전 분석: 흑자전환/적자전환 감지 + 연간 앵커 표시 ──────────
    const latestQRow = r.rows.find(row => !row.period_label?.endsWith("FY"));
    const latestFYRow = r.rows.find(row => row.period_label?.endsWith("FY"));
    if (latestQRow) {
      const qOp  = parseAmt(latestQRow.operating_income);
      const fyOp = latestFYRow ? parseAmt(latestFYRow.operating_income) : null;
      let turnNote = "";
      if (qOp !== null && fyOp !== null) {
        if (qOp > 0 && fyOp <= 0)
          turnNote = " 🔄⚠️ 흑자전환 감지(직전 연간 적자→분기 흑자) — 연간 추정 상향 바이어스 반영 검토";
        else if (qOp < 0 && fyOp >= 0)
          turnNote = " 🔴⚠️ 적자전환 감지(직전 연간 흑자→분기 적자) — 연간 추정 하향 바이어스 반영 검토";
      }
      // 확정 분기 수학적 하한선 계산
      // 복수 확정 분기가 있으면 모두 합산 (예: Q1+Q2 확정)
      const confirmedQRows = r.rows.filter(row => !row.period_label?.endsWith("FY"));
      // 같은 회계연도 분기만(올해E 기준)
      const currentYearStr = String(new Date().getFullYear());
      const confirmedThisYearRows = confirmedQRows.filter(row =>
        row.period_label?.startsWith(currentYearStr)
      );
      const confirmedOpSum = confirmedThisYearRows.reduce((sum, row) => {
        const op = parseAmt(row.operating_income);
        return op !== null ? sum + op : sum;
      }, 0);
      const confirmedCount = confirmedThisYearRows.length;
      const floorNote = confirmedCount > 0 && confirmedOpSum > 0
        ? `   ⛔ 수학적 하한선: ${currentYearStr}년 확정 ${confirmedCount}개 분기 영업이익 합계 = ${fmtKrw(confirmedOpSum)} → 연간E 영업이익은 반드시 이 값 이상이어야 합니다.`
        : confirmedCount > 0
          ? `   ⚠️ 수학적 참고: ${currentYearStr}년 확정 ${confirmedCount}개 분기 영업이익 합계 = ${fmtKrw(confirmedOpSum)} (적자 분기 포함).`
          : "";

      // 확정 분기별 구조화 데이터 (분기 테이블에 직접 사용)
      const confirmedQTableRows = confirmedThisYearRows.map(row => {
        const rev = parseAmt(row.revenue);
        const op  = parseAmt(row.operating_income);
        const opm = (rev && op && rev !== 0) ? (op / rev * 100).toFixed(1) : null;
        const label = row.period_label ?? "";
        return `   ★ ${label} (확정): 매출 ${rev !== null ? fmtKrw(rev) : "—"} | 영업이익 ${op !== null ? fmtKrw(op) : "—"}${opm ? ` (OPM ${opm}%)` : ""} ← 분기 테이블 Q${label.includes("Q") ? label.slice(-1) : "?"} 셀에 그대로 기입`;
      });

      // ── Q2~Q4 OPM 합리 범위 계산 (최근 비-현재연도 분기 OPM 추세 기반) ──
      const allQRows = r.rows.filter(row => !row.period_label?.endsWith("FY"));
      const prevYearQRows = allQRows.filter(row => !row.period_label?.startsWith(currentYearStr));
      // 최신 순으로 정렬된 최근 3분기 OPM 추출
      const recentOPMs: { label: string; opm: number }[] = [];
      for (const row of prevYearQRows.slice(0, 4)) {
        const rev = parseAmt(row.revenue);
        const op  = parseAmt(row.operating_income);
        if (rev && op !== null && rev !== 0) {
          recentOPMs.push({ label: row.period_label ?? "", opm: op / rev * 100 });
        }
      }
      // 현재연도 확정 분기 OPM도 포함
      const confirmedOPMs: { label: string; opm: number }[] = [];
      for (const row of confirmedThisYearRows) {
        const rev = parseAmt(row.revenue);
        const op  = parseAmt(row.operating_income);
        if (rev && op !== null && rev !== 0) {
          confirmedOPMs.push({ label: row.period_label ?? "", opm: op / rev * 100 });
        }
      }

      // 최신 확정 분기 OPM 기반 범위 계산
      const latestConfirmedOPM = confirmedOPMs.length > 0 ? confirmedOPMs[confirmedOPMs.length - 1].opm : null;
      const latestPrevOPM = recentOPMs.length > 0 ? recentOPMs[0].opm : null;

      let opmRangeNote = "";
      if (latestConfirmedOPM !== null) {
        // 추세 파악: 직전 분기와 최신 확정 분기 비교
        const trendDir = latestPrevOPM !== null
          ? (latestConfirmedOPM > latestPrevOPM ? "개선" : latestConfirmedOPM < latestPrevOPM ? "악화" : "횡보")
          : "확인불가";

        // Q2~Q4 권고 범위: 최신 확정 OPM 기준 ±3pp, 단 직전분기 OPM도 반영
        const refOPMs = [latestConfirmedOPM, ...(latestPrevOPM !== null ? [latestPrevOPM] : [])].filter(v => v > -20);
        const rangeLow  = (Math.min(...refOPMs) - 1).toFixed(1);
        const rangeHigh = (Math.max(...refOPMs) + 2).toFixed(1);

        const recentTrend = recentOPMs.slice(0, 3)
          .map(r2 => `${r2.label}: ${r2.opm.toFixed(1)}%`)
          .join(" → ");
        const confirmedTrend = confirmedOPMs
          .map(r2 => `${r2.label}★: ${r2.opm.toFixed(1)}%`)
          .join(" → ");

        opmRangeNote = [
          `   ⛔ [Q2~Q4 OPM bottom-up 추정 앵커 — 코드 계산값]`,
          `      최근 분기 OPM 추세: ${recentTrend}${recentTrend && confirmedTrend ? " → " : ""}${confirmedTrend} (추세: ${trendDir})`,
          `      Q2~Q4 OPM 합리 범위: ${rangeLow}% ~ ${rangeHigh}% (최신 확정 분기 OPM 기준 ±조정)`,
          `      이 범위 밖으로 추정하면 반드시 이탈 사유 명시 — 특히 최신 분기 OPM(${latestConfirmedOPM.toFixed(1)}%)보다 ${Math.abs(parseFloat(rangeLow))}pp 이상 낮게 잡는 것은 근거 필수`,
        ].join("\n");
      }

      lines.push(
        ``,
        `📌 [최신 확정 분기: ${latestQRow.period_label}${turnNote}]`,
        `   ① 연간 추정 앵커: 이 분기를 기준으로 잔여 분기를 추정해 올해E를 산출하세요.`,
        `   ② 계절성 보정: 건설·인프라(Q1 약세/Q4 강세) · 소비재·뷰티(Q4 강세) · 반도체·전자(Q1 약세/Q3 강세) · 조선(연간 균등).`,
        `   ③ 연환산 공식: 단순 ×4 금지 — 반드시 분기별 계절성 가중치 적용 후 합산.`,
        ...(floorNote ? [floorNote] : []),
        ...(confirmedQTableRows.length > 0 ? [
          `   ⛔ [분기별 전망 테이블 — 확정값 직접 사용]:`,
          ...confirmedQTableRows,
        ] : []),
        ...(opmRangeNote ? [opmRangeNote] : []),
        ``,
      );
    }

    for (const row of r.rows) {
      const fs = row.fs_type === "CFS" ? "연결" : "별도";
      const rev = parseAmt(row.revenue);
      const op  = parseAmt(row.operating_income);
      const ni  = parseAmt(row.net_income);
      const eq  = parseAmt(row.equity);
      const ca  = parseAmt(row.cash);
      const td  = parseAmt(row.total_debt);
      const eps = parseAmt(row.eps);
      const bps = parseAmt(row.bps);

      const opMargin = (rev && op && rev !== 0)
        ? ` (OPM ${(op / rev * 100).toFixed(1)}%)`
        : "";

      // 최신 확정 분기에 ★ 마커 부착
      const isLatestQ = latestQRow && row.period_label === latestQRow.period_label;
      const prefix = isLatestQ ? `★확정★ ${row.period_label}(${fs})` : `▸ ${row.period_label}(${fs})`;

      const parts: string[] = [prefix];
      if (rev !== null) parts.push(`매출 ${fmtKrw(rev)}`);
      if (op  !== null) parts.push(`영업이익 ${fmtKrw(op)}${opMargin}`);
      if (ni  !== null) parts.push(`순이익 ${fmtKrw(ni)}`);
      if (eq  !== null) parts.push(`자본총계 ${fmtKrw(eq)}`);
      // 라벨을 정확히 쓴다. 'cash'는 현금및현금성자산+단기금융상품,
      // 'total_debt'는 부채총계(차입금이 아니다) — AI가 순현금을 계산할 때
      // 이자부부채로 오해하면 순현금이 과소·과대 산출된다.
      if (ca  !== null) parts.push(`현금성자산 ${fmtKrw(ca)}`);
      if (td  !== null) parts.push(`부채총계 ${fmtKrw(td)}`);
      if (eps !== null) parts.push(`EPS ${eps.toLocaleString("ko-KR")}원`);
      if (bps !== null) parts.push(`BPS ${bps.toLocaleString("ko-KR")}원`);

      lines.push(parts.join(" | "));
    }

    lines.push(`⭐ 위 시계열로 영업이익 성장 추세·마진 변화·재무 건전성을 반드시 분석에 활용하세요.`);
    // 피어 비교 테이블 OPM·ROE override: 최신 연간 실적에서 추출 (period_label 형식: "2025 FY")
    const annualRows = r.rows.filter(row => row.period_label?.endsWith("FY"));
    const latestAnnual = annualRows[0]; // ORDER BY bsns_year DESC → 첫 번째가 최신 연간
    if (latestAnnual) {
      const rev = parseAmt(latestAnnual.revenue);
      const op  = parseAmt(latestAnnual.operating_income);
      const ni  = parseAmt(latestAnnual.net_income);
      const eq  = parseAmt(latestAnnual.equity);
      const overrides: string[] = [];
      if (rev && op && rev !== 0) {
        const opmPct = (op / rev * 100).toFixed(1);
        overrides.push(`영업이익률(OPM) = ${opmPct}%`);
      }
      if (ni && eq && eq !== 0) {
        const roePct = (ni / eq * 100).toFixed(1);
        overrides.push(`ROE = ${roePct}%`);
      }
      if (overrides.length > 0) {
        lines.push(
          `⭐⭐ [피어 멀티플 비교 — 대상 종목 수치 지정 (${latestAnnual.period_label} DART 실측, 위반 시 수치 오염)] ` +
          overrides.join(" / ") +
          `. ⛔ Yahoo Finance·KIS·훈련 기억 수치로 교체 절대 금지. 피어 비교 테이블의 대상 종목 행에 위 값을 그대로 기재하세요.`
        );
      }
    }
    return lines.join("\n");
  } catch (e) {
    console.error(`[dart-store] getDartHistoricalContext 오류:`, e);
    return null;
  }
}

// ─── 앵커 수치 구조체 (서버 계산용) ──────────────────────────────────────────

export interface DartAnchorNumerics {
  annualRev:    Record<string, number>;
  annualOp:     Record<string, number>;
  annualNi:     Record<string, number>;
  annualEq:     Record<string, number>;
  latestFYRev:  number | null;
  latestFYYear: string | null;
}

/**
 * ticker_financials DB에서 연간(FY) 앵커 수치를 숫자 구조체로 반환.
 * fetchFinancialContext가 Yahoo 데이터 대신 이 값을 우선 사용하도록 전달된다.
 * 데이터 없으면 null 반환.
 */
export async function getDartAnchorNumerics(stockCode: string): Promise<DartAnchorNumerics | null> {
  if (!isKoreanTicker(stockCode)) return null;
  try {
    await ensureTable();
    const r = await pool.query<{
      bsns_year: number;
      revenue: string | null;
      operating_income: string | null;
      net_income: string | null;
      equity: string | null;
    }>(
      `SELECT bsns_year, revenue, operating_income, net_income, equity
       FROM ticker_financials
       WHERE ticker = $1 AND reprt_code = '11011'
       ORDER BY bsns_year DESC
       LIMIT 5`,
      [stockCode]
    );
    if (r.rows.length === 0) return null;

    const annualRev: Record<string, number> = {};
    const annualOp:  Record<string, number> = {};
    const annualNi:  Record<string, number> = {};
    const annualEq:  Record<string, number> = {};

    for (const row of r.rows) {
      const y   = String(row.bsns_year);
      const rev = row.revenue           ? Number(row.revenue)           : null;
      const op  = row.operating_income  ? Number(row.operating_income)  : null;
      const ni  = row.net_income        ? Number(row.net_income)        : null;
      const eq  = row.equity            ? Number(row.equity)            : null;
      if (rev != null) annualRev[y] = rev;
      if (op  != null) annualOp[y]  = op;
      if (ni  != null) annualNi[y]  = ni;
      if (eq  != null) annualEq[y]  = eq;
    }

    const latestRow   = r.rows[0];
    const latestFYRev  = latestRow.revenue ? Number(latestRow.revenue) : null;
    const latestFYYear = String(latestRow.bsns_year);

    return { annualRev, annualOp, annualNi, annualEq, latestFYRev, latestFYYear };
  } catch (e) {
    console.error(`[dart-store] getDartAnchorNumerics 오류:`, e);
    return null;
  }
}

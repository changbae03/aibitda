/**
 * dart-store.ts
 * DART OpenAPI에서 분기·연간 재무 데이터를 가져와 DB에 시계열로 쌓는 모듈.
 * - 연간보고서 1회 호출 시 thstrm/frmtrm/bfefrmtrm으로 3개년 데이터 동시 확보
 * - 분기보고서 4종(Q1/Q2/Q3/FY) 호출로 분기별 시계열 구성
 * - ON CONFLICT DO UPDATE로 멱등성 보장 (중복 없이 최신화)
 * - 30일 캐시 유효 기간으로 API 호출 절약
 */

import { pool } from "@workspace/db";

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
      corp_code       VARCHAR(20)  NOT NULL,
      bsns_year       INTEGER      NOT NULL,
      reprt_code      VARCHAR(5)   NOT NULL,
      period_label    VARCHAR(16)  NOT NULL,
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
  tableReady = true;
}

// ─── DART corp_code 조회 ─────────────────────────────────────────────────────

async function lookupCorpCode(stockCode: string): Promise<string | null> {
  const key = process.env["DART_API_KEY"];
  if (!key) return null;
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
    const url =
      `https://opendart.fss.or.kr/api/fnlttSinglAcnt.json` +
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

function findIS(rows: DartRow[], names: string[], field: AField): number | null {
  for (const name of names) {
    const row = rows.find(r => r.sj_div === "IS" && r.account_nm?.replace(/\s/g, "").includes(name));
    if (row) return parseAmt(row[field]);
  }
  return null;
}

function findBS(rows: DartRow[], names: string[], field: AField): number | null {
  for (const name of names) {
    const row = rows.find(r => r.sj_div === "BS" && r.account_nm?.replace(/\s/g, "").includes(name));
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
  const cash = findBS(rows, ["현금및현금성자산","현금및단기금융상품","현금성자산"], field);
  const eps = findIS(rows, ["기본주당이익","기본주당순이익","주당순이익","주당이익"], field);
  const bps = findBS(rows, ["주당순자산","주당자산가치"], field);

  // 금융부채 합산
  const debtItems = [
    findBS(rows, ["단기차입금"], field),
    findBS(rows, ["장기차입금","장기차입"], field),
    findBS(rows, ["사채"], field),
    findBS(rows, ["유동성장기부채","유동성장기차입금"], field),
    findBS(rows, ["리스부채","금융리스부채"], field),
    findBS(rows, ["단기금융부채","유동금융부채"], field),
    findBS(rows, ["장기금융부채","비유동금융부채"], field),
  ].filter((v): v is number => v !== null);
  const totalDebt = debtItems.length > 0 ? debtItems.reduce((a, b) => a + b, 0) : null;

  return { revenue, operatingIncome, netIncome, totalAssets, equity, cash, totalDebt, eps, bps };
}

// ─── 캐시 유효 확인 ──────────────────────────────────────────────────────────

async function isFresh(ticker: string, bsnsYear: number, reprtCode: string): Promise<boolean> {
  try {
    const r = await pool.query(
      `SELECT 1 FROM ticker_financials
       WHERE ticker=$1 AND bsns_year=$2 AND reprt_code=$3
         AND fetched_at > NOW() - INTERVAL '30 days'
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

// ─── 메인: 분기·연간 데이터 수집 및 저장 ──────────────────────────────────────

/**
 * 주어진 한국 종목(6자리 코드)에 대해 DART 분기·연간 재무 데이터를 가져와 DB에 저장.
 * 30일 내 이미 수집된 데이터는 건너뜀.
 * 분석 완료 후 백그라운드에서 호출하도록 설계됨.
 */
export async function fetchAndStoreDartQuarterly(stockCode: string): Promise<void> {
  const key = process.env["DART_API_KEY"];
  if (!key) return;
  if (!/^\d{6}$/.test(stockCode)) return;

  try {
    await ensureTable();

    const corpCode = await lookupCorpCode(stockCode);
    if (!corpCode) {
      console.warn(`[dart-store] ${stockCode} corp_code 조회 실패`);
      return;
    }

    const currentYear = new Date().getFullYear();
    // 연간: 최근 3년 / 분기: 최근 2년
    const annualYears = [currentYear - 1, currentYear - 2, currentYear - 3];
    const quarterYears = [currentYear - 1, currentYear - 2];

    for (const { code, label } of REPRT_CODES) {
      const years = code === "11011" ? annualYears : quarterYears;

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
  if (!/^\d{6}$/.test(stockCode)) return null;
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
    ];

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

      const parts: string[] = [`▸ ${row.period_label}(${fs})`];
      if (rev !== null) parts.push(`매출 ${fmtKrw(rev)}`);
      if (op  !== null) parts.push(`영업이익 ${fmtKrw(op)}${opMargin}`);
      if (ni  !== null) parts.push(`순이익 ${fmtKrw(ni)}`);
      if (eq  !== null) parts.push(`자본 ${fmtKrw(eq)}`);
      if (ca  !== null) parts.push(`현금 ${fmtKrw(ca)}`);
      if (td  !== null) parts.push(`금융부채 ${fmtKrw(td)}`);
      if (eps !== null) parts.push(`EPS ${eps.toLocaleString("ko-KR")}원`);
      if (bps !== null) parts.push(`BPS ${bps.toLocaleString("ko-KR")}원`);

      lines.push(parts.join(" | "));
    }

    lines.push(`⭐ 위 시계열로 영업이익 성장 추세·마진 변화·재무 건전성을 반드시 분석에 활용하세요.`);
    return lines.join("\n");
  } catch (e) {
    console.error(`[dart-store] getDartHistoricalContext 오류:`, e);
    return null;
  }
}

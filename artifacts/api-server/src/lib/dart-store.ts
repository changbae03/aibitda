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
  // 기존 테이블에 period_label 컬럼이 없는 경우 추가 (마이그레이션)
  await pool.query(`
    ALTER TABLE ticker_financials
    ADD COLUMN IF NOT EXISTS period_label VARCHAR(16) NOT NULL DEFAULT ''
  `);
  tableReady = true;
}

// ─── DART corp_code 조회 ─────────────────────────────────────────────────────
// 우선순위: ① system_cache(themes.ts가 3967개 XML 로드 후 저장) → ② ticker_financials DB → ③ DART API 직접

async function lookupCorpCode(stockCode: string): Promise<string | null> {
  const key = process.env["DART_API_KEY"];
  if (!key) return null;

  // 1순위: system_cache의 dart_corp_code_map_v1 (themes.ts가 주기적으로 3967개 갱신)
  try {
    const r = await pool.query<{ data: string }>(
      `SELECT data FROM system_cache WHERE key = 'dart_corp_code_map_v1' AND expires_at > NOW() LIMIT 1`
    );
    if (r.rows[0]?.data) {
      const map = JSON.parse(r.rows[0].data) as Record<string, string>;
      const found = map[stockCode];
      if (found) {
        console.log(`[dart-store] ${stockCode} corp_code=${found} (system_cache)`);
        return found;
      }
    }
  } catch { /* fallthrough */ }

  // 2순위: ticker_financials에 이미 저장된 corp_code
  try {
    const r = await pool.query<{ corp_code: string }>(
      `SELECT DISTINCT corp_code FROM ticker_financials WHERE ticker = $1 LIMIT 1`,
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

      lines.push(
        ``,
        `📌 [최신 확정 분기: ${latestQRow.period_label}${turnNote}]`,
        `   ① 연간 추정 앵커: 이 분기를 기준으로 잔여 분기를 추정해 올해E를 산출하세요.`,
        `   ② 계절성 보정: 건설·인프라(Q1 약세/Q4 강세) · 소비재·뷰티(Q4 강세) · 반도체·전자(Q1 약세/Q3 강세) · 조선(연간 균등).`,
        `   ③ 연환산 공식: 단순 ×4 금지 — 반드시 분기별 계절성 가중치 적용 후 합산.`,
        ...(floorNote ? [floorNote] : []),
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
      if (eq  !== null) parts.push(`자본 ${fmtKrw(eq)}`);
      if (ca  !== null) parts.push(`현금 ${fmtKrw(ca)}`);
      if (td  !== null) parts.push(`금융부채 ${fmtKrw(td)}`);
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

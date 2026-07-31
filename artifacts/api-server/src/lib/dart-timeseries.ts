/**
 * dart-timeseries.ts
 * DART OpenAPI에서 최근 3개년 연간 + 최근 분기 재무 시계열을 수집한다.
 *
 * 흐름:
 *  1. lookupCorpCode(stockCode) → DART corp_code
 *  2. fnlttSinglAcntAll (CFS 기준) 최신 FY → 3개년 연간 수치 (thstrm/frmtrm/bfefrmtrm)
 *  3. 최근 분기 보고서(Q3→Q2→Q1) → 누적 분기 실적
 *  4. 추세 판단 텍스트 생성 → 행간읽기(investment_thesis) 컨텍스트로 주입
 *  5. DB 캐시 (dart_timeseries_cache 테이블, 24h TTL)
 */

import { pool } from "@workspace/db";
import { lookupCorpCode } from "./dart-store.js";

const DART_BASE = "https://opendart.fss.or.kr/api";
const DART_KEY = () => process.env.DART_API_KEY ?? "";

const REPRT_FY = "11011"; // 사업보고서 (연간)
const REPRT_Q3 = "11014"; // 3분기보고서
const REPRT_Q2 = "11012"; // 반기보고서
const REPRT_Q1 = "11013"; // 1분기보고서

interface DartItem {
  account_id?: string;
  account_nm: string;
  thstrm_amount?: string;
  frmtrm_amount?: string;
  bfefrmtrm_amount?: string;
  thstrm_add_amount?: string;
}

// ─── DB 캐시 ─────────────────────────────────────────────────────────────────

let _tableReady = false;
async function ensureTable(): Promise<void> {
  if (_tableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dart_timeseries_cache (
      stock_code VARCHAR(20) PRIMARY KEY,
      content    TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  _tableReady = true;
}

// 연간보고서 기반 데이터 — 분기별로만 변하므로 7일 TTL
const CACHE_TTL_MS = 7 * 24 * 3_600_000;

async function getCached(stockCode: string): Promise<string | null> {
  try {
    await ensureTable();
    const r = await pool.query<{ content: string; created_at: Date }>(
      "SELECT content, created_at FROM dart_timeseries_cache WHERE stock_code = $1",
      [stockCode]
    );
    if (!r.rows[0]) return null;
    const age = Date.now() - r.rows[0].created_at.getTime();
    return age < CACHE_TTL_MS ? r.rows[0].content : null;
  } catch {
    return null;
  }
}

async function setCached(stockCode: string, content: string): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO dart_timeseries_cache (stock_code, content, created_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (stock_code) DO UPDATE SET content = $2, created_at = NOW()`,
      [stockCode, content]
    );
  } catch { /* ignore */ }
}

// ─── DART API 호출 ────────────────────────────────────────────────────────────

async function fetchDartFinancials(
  corpCode: string,
  bsnsYear: string,
  reprtCode: string,
  fsDiv: "CFS" | "OFS" = "CFS"
): Promise<DartItem[] | null> {
  const key = DART_KEY();
  if (!key) return null;
  const url =
    `${DART_BASE}/fnlttSinglAcntAll.json` +
    `?crtfc_key=${key}&corp_code=${corpCode}` +
    `&bsns_year=${bsnsYear}&reprt_code=${reprtCode}&fs_div=${fsDiv}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    if (data.status !== "000" || !Array.isArray(data.list)) return null;
    return data.list as DartItem[];
  } catch {
    return null;
  }
}

/** CFS(연결) 우선, 없으면 OFS(별도)로 폴백 — dart-store.ts와 동일 전략 */
async function fetchDartFinancialsCfsOrOfs(
  corpCode: string,
  bsnsYear: string,
  reprtCode: string
): Promise<{ items: DartItem[]; fsDiv: "CFS" | "OFS" } | null> {
  const cfs = await fetchDartFinancials(corpCode, bsnsYear, reprtCode, "CFS");
  if (cfs && cfs.length > 0) return { items: cfs, fsDiv: "CFS" };
  const ofs = await fetchDartFinancials(corpCode, bsnsYear, reprtCode, "OFS");
  if (ofs && ofs.length > 0) return { items: ofs, fsDiv: "OFS" };
  return null;
}

// ─── 파싱 / 포맷 유틸 ────────────────────────────────────────────────────────

function parseAmount(str?: string): number | null {
  if (!str || str.trim() === "" || str.trim() === "-") return null;
  const n = Number(str.replace(/,/g, ""));
  return isNaN(n) ? null : n;
}

function fmtKrw(val: number | null): string {
  if (val === null) return "N/A";
  const b = val / 1e8; // 억원
  if (Math.abs(b) >= 10_000) return `${(b / 10_000).toFixed(2)}조원`;
  return `${Math.round(b).toLocaleString("ko-KR")}억원`;
}

function pct(a: number | null, b: number | null): string {
  if (a === null || b === null || b === 0) return "";
  const c = ((a - b) / Math.abs(b)) * 100;
  return `(${c >= 0 ? "+" : ""}${c.toFixed(1)}%)`;
}

function findAccount(items: DartItem[], ...names: string[]): DartItem | undefined {
  for (const name of names) {
    const found = items.find((i) => i.account_nm === name || i.account_nm.startsWith(name));
    if (found) return found;
  }
  return undefined;
}

function marginStr(opm: number | null, rev: number | null): string {
  if (opm === null || rev === null || rev === 0) return "";
  return ` (영업이익률 ${((opm / rev) * 100).toFixed(1)}%)`;
}

// ─── 공개 함수 ────────────────────────────────────────────────────────────────

/**
 * 한국 종목의 DART 재무 시계열(3개년 연간 + 최근 분기)을 텍스트로 반환.
 * 실패 시 null — 파이프라인 블로킹 없음.
 */
export async function fetchDartTimeSeries(stockCode: string): Promise<string | null> {
  if (!/^\d{6}$/.test(stockCode)) return null;

  const cached = await getCached(stockCode);
  if (cached) {
    console.log(`[dart-timeseries] ${stockCode} 캐시 히트`);
    return cached;
  }

  try {
    const corpCode = await lookupCorpCode(stockCode);
    if (!corpCode) {
      console.log(`[dart-timeseries] ${stockCode} corp_code 조회 실패`);
      return null;
    }

    const now = new Date();
    const curYear  = now.getFullYear().toString();
    const prevYear = (now.getFullYear() - 1).toString();

    // ── 연간 보고서: 올해 → 안 되면 작년 (CFS 우선, OFS 폴백) ──
    let fyResult = await fetchDartFinancialsCfsOrOfs(corpCode, curYear, REPRT_FY);
    let fyYear   = curYear;
    if (!fyResult) {
      fyResult = await fetchDartFinancialsCfsOrOfs(corpCode, prevYear, REPRT_FY);
      fyYear   = prevYear;
    }
    if (!fyResult) {
      console.log(`[dart-timeseries] ${stockCode} 연간 보고서 없음`);
      return null;
    }
    const fyItems   = fyResult.items;
    const fyFsLabel = fyResult.fsDiv === "OFS" ? " (별도)" : " (연결)";

    // ── 최근 분기: 당해년도 Q3 → Q2 → Q1 → 전년도 Q3 ──
    let qItems: DartItem[] | null = null;
    let qLabel = "";
    const yearToTry = fyYear === curYear ? prevYear : curYear;
    const qCandidates: [string, string, string][] = [
      [curYear,    REPRT_Q3, `${curYear}년 3분기`],
      [curYear,    REPRT_Q2, `${curYear}년 반기`],
      [curYear,    REPRT_Q1, `${curYear}년 1분기`],
      [yearToTry,  REPRT_Q3, `${yearToTry}년 3분기`],
    ];
    for (const [yr, code, label] of qCandidates) {
      const r = await fetchDartFinancialsCfsOrOfs(corpCode, yr, code);
      if (r) { qItems = r.items; qLabel = label; break; }
    }

    // ── 연간 수치 추출 ──
    const yr0 = fyYear;
    const yr1 = (Number(fyYear) - 1).toString();
    const yr2 = (Number(fyYear) - 2).toString();

    const rev = findAccount(fyItems, "매출액");
    const opm = findAccount(fyItems, "영업이익", "영업이익(손실)");
    const ni  = findAccount(fyItems, "당기순이익", "당기순이익(손실)");
    const cf  = findAccount(fyItems, "영업활동현금흐름", "영업활동으로 인한 현금흐름");

    const revY: (number | null)[] = [
      parseAmount(rev?.thstrm_amount),
      parseAmount(rev?.frmtrm_amount),
      parseAmount(rev?.bfefrmtrm_amount),
    ];
    const opmY: (number | null)[] = [
      parseAmount(opm?.thstrm_amount),
      parseAmount(opm?.frmtrm_amount),
      parseAmount(opm?.bfefrmtrm_amount),
    ];
    const niY: (number | null)[] = [
      parseAmount(ni?.thstrm_amount),
      parseAmount(ni?.frmtrm_amount),
      parseAmount(ni?.bfefrmtrm_amount),
    ];
    const cfY: (number | null)[] = [
      parseAmount(cf?.thstrm_amount),
      parseAmount(cf?.frmtrm_amount),
    ];

    // ── 추세 판단 ──
    const revTrend =
      revY[0] !== null && revY[1] !== null && revY[2] !== null
        ? revY[0] > revY[1] && revY[1] > revY[2] ? "3년 연속 성장 ↑↑↑"
          : revY[0] < revY[1] && revY[1] < revY[2] ? "3년 연속 감소 ↓↓↓"
          : revY[0] > revY[1] ? "전년 대비 회복 ↑"
          : "전년 대비 감소 ↓"
        : null;

    const opmRate = opmY.map((o, i) =>
      o !== null && revY[i] !== null && revY[i]! > 0
        ? (o / revY[i]!) * 100
        : null
    );
    const marginTrend =
      opmRate[0] !== null && opmRate[1] !== null
        ? opmRate[0] > opmRate[1] + 0.5 ? "마진 개선 중 ↑"
          : opmRate[0] < opmRate[1] - 0.5 ? "마진 압축 중 ↓"
          : "마진 보합 →"
        : null;

    const lines: string[] = [
      `[📅 DART 재무 시계열 — ${yr2}~${yr0}년 연간 + 최근 분기${fyFsLabel}]`,
      `⚠️ DART OpenAPI 공시 기반. 사업 흐름 추세 분석에 활용하세요.`,
      ``,
      `▌ 매출액`,
      `  ${yr2}: ${fmtKrw(revY[2])}`,
      `  ${yr1}: ${fmtKrw(revY[1])} ${pct(revY[1], revY[2])}`,
      `  ${yr0}: ${fmtKrw(revY[0])} ${pct(revY[0], revY[1])}`,
      revTrend ? `  → 추세: ${revTrend}` : null,
      ``,
      `▌ 영업이익 & 영업이익률`,
      `  ${yr2}: ${fmtKrw(opmY[2])}${marginStr(opmY[2], revY[2])}`,
      `  ${yr1}: ${fmtKrw(opmY[1])}${marginStr(opmY[1], revY[1])} ${pct(opmY[1], opmY[2])}`,
      `  ${yr0}: ${fmtKrw(opmY[0])}${marginStr(opmY[0], revY[0])} ${pct(opmY[0], opmY[1])}`,
      marginTrend ? `  → 추세: ${marginTrend}` : null,
      ``,
      `▌ 당기순이익`,
      `  ${yr2}: ${fmtKrw(niY[2])}`,
      `  ${yr1}: ${fmtKrw(niY[1])} ${pct(niY[1], niY[2])}`,
      `  ${yr0}: ${fmtKrw(niY[0])} ${pct(niY[0], niY[1])}`,
      ``,
      `▌ 영업활동현금흐름`,
      `  ${yr1}: ${fmtKrw(cfY[1])}`,
      `  ${yr0}: ${fmtKrw(cfY[0])} ${pct(cfY[0], cfY[1])}`,
    ].filter((l): l is string => l !== null);

    // ── 최근 분기 실적 ──
    if (qItems) {
      const qRev = findAccount(qItems, "매출액");
      const qOpm = findAccount(qItems, "영업이익", "영업이익(손실)");
      const qNi  = findAccount(qItems, "당기순이익", "당기순이익(손실)");

      const qRevY0 = parseAmount(qRev?.thstrm_amount);
      const qRevY1 = parseAmount(qRev?.frmtrm_amount);
      const qOpmY0 = parseAmount(qOpm?.thstrm_amount);
      const qNiY0  = parseAmount(qNi?.thstrm_amount);

      if (qRevY0 !== null || qOpmY0 !== null) {
        lines.push(``, `▌ 최근 분기 누적 실적 (${qLabel})`);
        if (qRevY0 !== null)
          lines.push(`  매출: ${fmtKrw(qRevY0)} (전년 동기: ${fmtKrw(qRevY1)}) ${pct(qRevY0, qRevY1)}`);
        if (qOpmY0 !== null) {
          const qRate = qRevY0 ? ` (영업이익률 ${((qOpmY0 / qRevY0) * 100).toFixed(1)}%)` : "";
          lines.push(`  영업이익: ${fmtKrw(qOpmY0)}${qRate}`);
        }
        if (qNiY0 !== null)
          lines.push(`  순이익: ${fmtKrw(qNiY0)}`);
      }
    }

    const result = lines.join("\n");
    await setCached(stockCode, result);
    console.log(`[dart-timeseries] ${stockCode} 완료 (${result.length}자, FY${fyYear})`);
    return result;

  } catch (e) {
    console.warn("[dart-timeseries] 조회 실패:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

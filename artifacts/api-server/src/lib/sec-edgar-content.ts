/**
 * sec-edgar-content.ts
 * SEC EDGAR 10-K / 20-F 연간보고서에서 "Item 1. Business" 핵심 섹션 텍스트 추출.
 *
 * 흐름:
 *  1. www.sec.gov/files/company_tickers.json → ticker → CIK 매핑 (인메모리 24h 캐시)
 *  2. data.sec.gov/submissions/CIK{paddedCIK}.json → 최신 10-K/20-F 접수번호 조회
 *  3. EDGAR 파일링 인덱스 → 주요 문서(HTML) URL 획득
 *  4. HTML 다운로드 (최대 15MB) → Item 1 Business 섹션 추출
 *  5. DB(sec_edgar_content 테이블)에 30일 캐시
 */

import { pool } from "@workspace/db";

const SEC_BASE    = "https://www.sec.gov";
const SEC_DATA    = "https://data.sec.gov";
const USER_AGENT  = "AiBITDA Research ai@aibotda.com";
const MAX_HTML_BYTES = 15 * 1024 * 1024;
const CACHE_DAYS  = 30;
const FETCH_TIMEOUT = 20_000;

// ─── In-memory CIK 매핑 (24시간 캐시) ──────────────────────────────────────

let _cikMap: Map<string, number> | null = null;
let _cikMapFetchedAt = 0;

async function getCikMap(): Promise<Map<string, number>> {
  const now = Date.now();
  if (_cikMap && now - _cikMapFetchedAt < 24 * 3_600_000) return _cikMap;

  const res = await fetch(`${SEC_BASE}/files/company_tickers.json`, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`company_tickers fetch ${res.status}`);

  const raw = await res.json() as Record<
    string,
    { cik_str: number; ticker: string; title: string }
  >;
  const map = new Map<string, number>();
  for (const entry of Object.values(raw)) {
    map.set(entry.ticker.toUpperCase(), entry.cik_str);
  }
  _cikMap = map;
  _cikMapFetchedAt = now;
  console.log(`[sec-edgar] CIK 맵 로드: ${map.size}개 종목`);
  return map;
}

/**
 * CIK → ticker 역방향 표. 일별 제출 목록은 회사를 **CIK로만** 준다.
 * 같은 CIK에 여러 티커가 걸리면(우선주·클래스주) 먼저 온 것을 쓴다 —
 * 어차피 10-K는 회사 단위라 어느 쪽으로 저장해도 같은 본문이다.
 */
export async function getCikToTicker(): Promise<Map<number, string>> {
  const map = await getCikMap();
  const rev = new Map<number, string>();
  for (const [ticker, cik] of map) if (!rev.has(cik)) rev.set(cik, ticker);
  return rev;
}

/** ticker → CIK. 미국 재무(companyfacts) 수집에서 재사용한다. 없으면 null. */
export async function getCik(ticker: string): Promise<number | null> {
  try {
    const map = await getCikMap();
    return map.get(ticker.toUpperCase().split(".")[0]) ?? null;
  } catch {
    return null;
  }
}

// ─── DB 캐시 ────────────────────────────────────────────────────────────────

let _tableReady = false;

async function ensureTable(): Promise<void> {
  if (_tableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sec_edgar_content (
      id         SERIAL PRIMARY KEY,
      ticker     VARCHAR(20) NOT NULL,
      form_type  VARCHAR(10),
      filed_date VARCHAR(12),
      content    TEXT,
      fetched_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(ticker)
    )
  `);
  _tableReady = true;
}

async function getCached(ticker: string): Promise<string | null> {
  try {
    await ensureTable();
    const r = await pool.query<{ content: string; fetched_at: Date }>(
      "SELECT content, fetched_at FROM sec_edgar_content WHERE ticker = $1",
      [ticker]
    );
    if (!r.rows[0]) return null;
    const ageMs = Date.now() - r.rows[0].fetched_at.getTime();
    return ageMs > CACHE_DAYS * 86_400_000 ? null : r.rows[0].content;
  } catch {
    return null;
  }
}

async function setCached(
  ticker: string,
  formType: string,
  filedDate: string,
  content: string
): Promise<void> {
  try {
    await ensureTable();
    await pool.query(
      `INSERT INTO sec_edgar_content (ticker, form_type, filed_date, content, fetched_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (ticker) DO UPDATE
         SET form_type = $2, filed_date = $3, content = $4, fetched_at = NOW()`,
      [ticker, formType, filedDate, content]
    );
  } catch { /* 캐시 저장 실패는 무시 */ }
}

// ─── 최신 10-K / 20-F 접수번호 조회 ─────────────────────────────────────────

interface FilingInfo {
  accessionNumber: string;
  filedDate: string;
  form: string;
}

async function fetchLatestAnnualFiling(cik: number): Promise<FilingInfo | null> {
  const paddedCik = String(cik).padStart(10, "0");
  const url = `${SEC_DATA}/submissions/CIK${paddedCik}.json`;

  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  });
  if (!res.ok) return null;

  const data = await res.json() as any;
  const recent = data.filings?.recent;
  if (!recent) return null;

  const forms: string[]   = recent.form ?? [];
  const accNums: string[] = recent.accessionNumber ?? [];
  const dates: string[]   = recent.filingDate ?? [];

  let best: FilingInfo | null = null;
  for (let i = 0; i < forms.length; i++) {
    // 10-K: 국내 상장사 연간보고서 / 20-F: 외국 기업(ADR 등) 연간보고서
    if (forms[i] === "10-K" || forms[i] === "20-F") {
      if (!best || dates[i] > best.filedDate) {
        best = { accessionNumber: accNums[i], filedDate: dates[i], form: forms[i] };
      }
    }
  }
  return best;
}

// ─── 파일링 인덱스에서 주요 문서 URL 탐색 ────────────────────────────────────

async function findPrimaryDocUrl(cik: number, accession: string): Promise<string | null> {
  const accNoDash = accession.replace(/-/g, "");
  const indexUrl  = `${SEC_BASE}/Archives/edgar/data/${cik}/${accNoDash}/${accession}-index.htm`;

  const res = await fetch(indexUrl, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;

  const html = await res.text();

  // href="...htm(l)" 중 인덱스 파일 자체 제외, 첫 번째 항목 선택
  const matches = [...html.matchAll(/href="([^"]+\.htm(?:l)?)"[^>]*>/gi)];
  for (const m of matches) {
    const href = m[1];
    if (href.includes("-index") || href.includes("R2.htm") || href.includes("R1.htm")) continue;
    const docUrl = href.startsWith("http")
      ? href
      : `${SEC_BASE}${
          href.startsWith("/")
            ? href
            : `/Archives/edgar/data/${cik}/${accNoDash}/${href}`
        }`;
    return docUrl;
  }
  return null;
}

// ─── HTML → 평문 변환 ────────────────────────────────────────────────────────

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|tr|li|h[1-6]|section|article)>/gi, "\n")
    .replace(/<\/(?:td|th)>/gi, "  ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#\d+;|&#x[\da-f]+;/gi, "")
    .replace(/[ \t]{4,}/g, "  ")
    .replace(/\n{4,}/g, "\n\n")
    .trim();
}

// ─── Item 1 Business 섹션 추출 ───────────────────────────────────────────────

function extractBusinessSection(text: string, maxChars = 5_000): string | null {
  // 현대 10-K는 맨 앞에 목차가 있어 "Item 1. Business" → "Item 1A" 링크가 붙어 나온다.
  // 목차 조각(둘 사이 간격이 짧음)이 아니라, 둘 사이 **내용이 가장 많은** 실제 섹션을 고른다.
  // 목차엔 "Item 1.   Business"(공백), 실제 헤더엔 "Item 1.Business"(공백 없음)로 나온다.
  // 공백 0~4개 모두 허용하고, 둘 사이 내용이 가장 많은 후보(=실제 섹션)를 고른다.
  const startRe = /ITEM\s+1\.?\s{0,4}BUSINESS/gi;
  const endRe = /ITEM\s+1A\.?\s{0,4}RISK|ITEM\s+2\.?\s{0,4}PROPERT/i;

  // 각 후보에서 **바로 다음** 끝점까지의 길이를 잰다(오프셋 없이). 목차의 "Item 1"은
  // 인접한 "Item 1A"에서 곧장 끊겨 짧으므로 걸러지고, 실제 섹션만 길게 남는다.
  let startIdx = -1, endIdx = -1, bestLen = -1;
  for (const m of text.matchAll(startRe)) {
    const s = (m.index ?? 0) + m[0].length;
    const em = text.slice(s).match(endRe);
    const e = em?.index !== undefined ? s + em.index : Math.min(text.length, s + maxChars * 3);
    const len = e - s;
    if (len > bestLen && len >= 500) { bestLen = len; startIdx = s; endIdx = e; }
  }

  if (startIdx === -1) {
    // 폴백: "BUSINESS" 키워드 이후 내용
    const bi = text.toUpperCase().indexOf("BUSINESS");
    if (bi === -1) return null;
    startIdx = bi + 8;
    endIdx = Math.min(text.length, startIdx + maxChars * 3);
    const em = text.slice(startIdx + 200).match(endRe);
    if (em?.index !== undefined) endIdx = Math.min(endIdx, startIdx + 200 + em.index);
  }

  const raw = text.slice(startIdx, endIdx).trim();
  if (raw.length < 200) return null;

  // 줄 정리: 빈 줄 압축, 페이지 번호 단독 행 제거
  const cleaned = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^\d{1,3}$/.test(l))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .slice(0, maxChars);

  return cleaned || null;
}

// ─── Item 7 MD&A 섹션 추출 ───────────────────────────────────────────────────

function extractMdaSection(text: string, maxChars = 4_000): string | null {
  const startPats = [
    /ITEM\s+7\.?\s+MANAGEMENT.{0,5}S\s+DISCUSSION\s+AND\s+ANALYSIS/i,
    /ITEM\s+7\b[.\s]*\n\s*MANAGEMENT.{0,5}S/i,
    /^ITEM\s+7[\s.]+MANAGEMENT/im,
  ];
  let startIdx = -1;
  for (const pat of startPats) {
    const m = text.match(pat);
    if (m?.index !== undefined) { startIdx = m.index + m[0].length; break; }
  }
  if (startIdx === -1) return null;

  const endPats = [
    /ITEM\s+7A\.?\s+QUANTITATIVE/i,
    /ITEM\s+8\.?\s+FINANCIAL\s+STATEMENTS/i,
    /ITEM\s+8\b/i,
  ];
  let endIdx = Math.min(text.length, startIdx + maxChars * 3);
  const searchFrom = startIdx + 200;
  for (const pat of endPats) {
    const m = text.slice(searchFrom).match(pat);
    if (m?.index !== undefined) endIdx = Math.min(endIdx, searchFrom + m.index);
  }

  const raw = text.slice(startIdx, endIdx).trim();
  if (raw.length < 200) return null;

  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^\d{1,3}$/.test(l))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .slice(0, maxChars) || null;
}

// ─── 다년치 10-K/20-F 사업 섹션 (행간 읽기용) ─────────────────────────────────
//
// 한국이 dart_biz_reports에 여러 해 사업보고서를 쌓듯, 미국도 최근 N개 연차보고서의
// "Item 1. Business" 본문을 받아 연도별로 비교할 수 있게 한다. 저장은 us-biz-reports가 한다.

export interface AnnualBusinessText {
  fy: number;       // 보고 대상 회계연도(reportDate 기준)
  filedDate: string;
  text: string;     // Item 1 Business 평문
}

/**
 * 최근 N개 연차보고서(10-K/20-F)의 사업 섹션 본문을 회계연도 내림차순으로 받는다.
 * submissions API의 primaryDocument를 직접 써서 인덱스 재조회를 아낀다.
 * 실패한 개별 파일은 건너뛴다(수집 실패는 분석을 막지 않는다).
 */
export async function fetchMultiYearBusiness(ticker: string, n = 4): Promise<AnnualBusinessText[]> {
  const cik = await getCik(ticker);
  if (cik == null) return [];
  const paddedCik = String(cik).padStart(10, "0");

  let recent: any;
  try {
    const res = await fetch(`${SEC_DATA}/submissions/CIK${paddedCik}.json`,
      { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(FETCH_TIMEOUT) });
    if (!res.ok) return [];
    recent = ((await res.json()) as any).filings?.recent;
  } catch { return []; }
  if (!recent) return [];

  const { form = [], accessionNumber = [], filingDate = [], reportDate = [], primaryDocument = [] } = recent;
  const picks: Array<{ acc: string; filed: string; report: string; doc: string }> = [];
  for (let i = 0; i < form.length && picks.length < n; i++) {
    if (form[i] === "10-K" || form[i] === "20-F") {
      picks.push({ acc: accessionNumber[i], filed: filingDate[i], report: reportDate[i] || filingDate[i], doc: primaryDocument[i] });
    }
  }

  const out: AnnualBusinessText[] = [];
  for (const p of picks) {
    if (!p.doc) continue;
    const accNoDash = p.acc.replace(/-/g, "");
    const url = `${SEC_BASE}/Archives/edgar/data/${cik}/${accNoDash}/${p.doc}`;
    try {
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(FETCH_TIMEOUT) });
      if (!res.ok) continue;
      const html = (await res.text()).slice(0, MAX_HTML_BYTES);
      const biz = extractBusinessSection(htmlToText(html), 8_000);
      if (biz && biz.length > 300) {
        out.push({ fy: Number(String(p.report).slice(0, 4)), filedDate: p.filed, text: biz });
      }
    } catch { /* 개별 파일 실패는 건너뛴다 */ }
    await new Promise(r => setTimeout(r, 150)); // SEC 예의(초당 10회 이내)
  }
  return out;
}

// ─── EDGAR XBRL 구조화 재무 시계열 ────────────────────────────────────────────

const XBRL_FACTS_URL = (cik: number) =>
  `${SEC_DATA}/api/xbrl/companyfacts/CIK${String(cik).padStart(10, "0")}.json`;

const REV_CONCEPTS   = ["Revenues","RevenueFromContractWithCustomerExcludingAssessedTax","SalesRevenueNet","RevenueFromContractWithCustomerIncludingAssessedTax","SalesRevenueGoodsNet"];
const OPM_CONCEPTS   = ["OperatingIncomeLoss"];
const NI_CONCEPTS    = ["NetIncomeLoss","NetIncomeLossAvailableToCommonStockholdersBasic"];
const EPS_CONCEPTS   = ["EarningsPerShareDiluted","EarningsPerShareBasic"];
const OCF_CONCEPTS   = ["NetCashProvidedByUsedInOperatingActivities"];
const CAPEX_CONCEPTS = ["PaymentsToAcquirePropertyPlantAndEquipment"];
const DEBT_CONCEPTS  = ["LongTermDebtNoncurrent","LongTermDebt","LongTermDebtAndCapitalLeaseObligations"];

interface XbrlPoint { end: string; val: number; form: string; fp: string; }

function pickSeries(gaap: any, concepts: string[]): XbrlPoint[] {
  for (const c of concepts) {
    const usd = gaap?.[c]?.units?.USD ?? gaap?.[c]?.units?.["USD/shares"];
    if (Array.isArray(usd) && usd.length > 0) return usd as XbrlPoint[];
  }
  return [];
}

function getAnnual(series: XbrlPoint[], n: number): XbrlPoint[] {
  const seen = new Set<string>();
  return series
    .filter((p) => p.fp === "FY" && (p.form === "10-K" || p.form === "20-F") && p.val != null)
    .sort((a, b) => b.end.localeCompare(a.end))
    .filter((p) => { if (seen.has(p.end)) return false; seen.add(p.end); return true; })
    .slice(0, n);
}

function getQuarterly(series: XbrlPoint[], n: number): XbrlPoint[] {
  const seen = new Set<string>();
  return series
    .filter((p) => p.form === "10-Q" && p.val != null)
    .sort((a, b) => b.end.localeCompare(a.end))
    .filter((p) => { if (seen.has(p.end)) return false; seen.add(p.end); return true; })
    .slice(0, n);
}

function fmtUSD(val: number): string {
  if (Math.abs(val) >= 1e12) return `$${(val / 1e12).toFixed(2)}T`;
  if (Math.abs(val) >= 1e9)  return `$${(val / 1e9).toFixed(1)}B`;
  if (Math.abs(val) >= 1e6)  return `$${(val / 1e6).toFixed(0)}M`;
  return `$${val.toFixed(2)}`;
}

function pctChg(curr: number, prev: number): string {
  if (prev === 0) return "";
  const c = ((curr - prev) / Math.abs(prev)) * 100;
  return `(${c >= 0 ? "+" : ""}${c.toFixed(1)}%)`;
}

function yrLabel(end: string): string {
  return end.slice(0, 4); // "2023-09-30" → "2023"
}

function buildXbrlSummary(gaap: any, entityName: string): string {
  const revAnn  = getAnnual(pickSeries(gaap, REV_CONCEPTS),   5);
  const opmAnn  = getAnnual(pickSeries(gaap, OPM_CONCEPTS),   5);
  const niAnn   = getAnnual(pickSeries(gaap, NI_CONCEPTS),    5);
  const ocfAnn  = getAnnual(pickSeries(gaap, OCF_CONCEPTS),   5);
  const capexAnn= getAnnual(pickSeries(gaap, CAPEX_CONCEPTS), 5);
  const debtAnn = getAnnual(pickSeries(gaap, DEBT_CONCEPTS),  3);
  const epsQ    = getQuarterly(pickSeries(gaap, EPS_CONCEPTS), 4);
  const revQ    = getQuarterly(pickSeries(gaap, REV_CONCEPTS), 4);

  const lines: string[] = [
    `[📊 SEC EDGAR XBRL 재무 시계열 — ${entityName}]`,
    `⚠️ SEC XBRL 공시 기반 구조화 데이터. 매출·마진·현금흐름 추세 분석에 활용하세요.`,
    ``,
  ];

  if (revAnn.length > 0) {
    lines.push(`▌ 연간 매출 (Revenue)`);
    for (let i = revAnn.length - 1; i >= 0; i--) {
      const p = revAnn[i], prev = revAnn[i + 1];
      lines.push(`  FY${yrLabel(p.end)}: ${fmtUSD(p.val)}${prev ? " " + pctChg(p.val, prev.val) : ""}`);
    }
    if (revAnn.length >= 3) {
      const [r0, r1, r2] = revAnn;
      const trend =
        r0.val > r1.val && r1.val > r2.val ? "3년 연속 성장 ↑↑↑"
        : r0.val < r1.val && r1.val < r2.val ? "3년 연속 감소 ↓↓↓"
        : r0.val > r1.val ? "전년 대비 회복 ↑"
        : "전년 대비 감소 ↓";
      lines.push(`  → 추세: ${trend}`);
    }
    lines.push(``);
  }

  if (opmAnn.length > 0) {
    lines.push(`▌ 연간 영업이익 & 마진 (Operating Income & Margin)`);
    const revMap = new Map(revAnn.map((p) => [yrLabel(p.end), p.val]));
    for (let i = opmAnn.length - 1; i >= 0; i--) {
      const p = opmAnn[i], prev = opmAnn[i + 1];
      const rev = revMap.get(yrLabel(p.end));
      const margin = rev ? ` (마진 ${((p.val / rev) * 100).toFixed(1)}%)` : "";
      lines.push(`  FY${yrLabel(p.end)}: ${fmtUSD(p.val)}${margin}${prev ? " " + pctChg(p.val, prev.val) : ""}`);
    }
    if (opmAnn.length >= 2) {
      const r0 = revMap.get(yrLabel(opmAnn[0].end)), r1 = revMap.get(yrLabel(opmAnn[1].end));
      if (r0 && r1 && r0 > 0 && r1 > 0) {
        const m0 = opmAnn[0].val / r0, m1 = opmAnn[1].val / r1;
        const mTrend = m0 > m1 + 0.005 ? "마진 개선 중 ↑" : m0 < m1 - 0.005 ? "마진 압축 중 ↓" : "마진 보합 →";
        lines.push(`  → 추세: ${mTrend}`);
      }
    }
    lines.push(``);
  }

  if (niAnn.length > 0) {
    lines.push(`▌ 연간 순이익 (Net Income)`);
    for (let i = niAnn.length - 1; i >= 0; i--) {
      const p = niAnn[i], prev = niAnn[i + 1];
      lines.push(`  FY${yrLabel(p.end)}: ${fmtUSD(p.val)}${prev ? " " + pctChg(p.val, prev.val) : ""}`);
    }
    lines.push(``);
  }

  if (ocfAnn.length > 0) {
    lines.push(`▌ 연간 영업현금흐름 & FCF (Operating Cash Flow & FCF)`);
    const capexMap = new Map(capexAnn.map((p) => [yrLabel(p.end), p.val]));
    for (let i = ocfAnn.length - 1; i >= 0; i--) {
      const p = ocfAnn[i];
      const capex = capexMap.get(yrLabel(p.end));
      const fcf = capex != null ? ` | FCF: ${fmtUSD(p.val - capex)}` : "";
      lines.push(`  FY${yrLabel(p.end)}: OCF ${fmtUSD(p.val)}${fcf}`);
    }
    lines.push(``);
  }

  if (epsQ.length > 0) {
    lines.push(`▌ 최근 분기 EPS (Diluted)`);
    for (const p of [...epsQ].reverse()) {
      const d = new Date(p.end);
      const q = Math.ceil((d.getMonth() + 1) / 3);
      lines.push(`  ${d.getFullYear()}-Q${q}: $${p.val.toFixed(2)}`);
    }
    lines.push(``);
  } else if (revQ.length > 0) {
    lines.push(`▌ 최근 분기 매출`);
    for (const p of [...revQ].reverse()) {
      const d = new Date(p.end);
      const q = Math.ceil((d.getMonth() + 1) / 3);
      lines.push(`  ${d.getFullYear()}-Q${q}: ${fmtUSD(p.val)}`);
    }
    lines.push(``);
  }

  if (debtAnn.length > 0) {
    lines.push(`▌ 장기부채 (Long-term Debt) — 최근 3년`);
    for (const p of [...debtAnn].reverse()) {
      lines.push(`  FY${yrLabel(p.end)}: ${fmtUSD(p.val)}`);
    }
  }

  return lines.join("\n");
}

// XBRL DB 캐시 (7일 TTL)
let _xbrlTableReady = false;
async function ensureXbrlTable(): Promise<void> {
  if (_xbrlTableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sec_edgar_xbrl (
      ticker     VARCHAR(20) PRIMARY KEY,
      content    TEXT NOT NULL,
      fetched_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  _xbrlTableReady = true;
}

// ─── 공개 함수 ───────────────────────────────────────────────────────────────

/**
 * 미국 주식 티커의 EDGAR XBRL 구조화 재무 시계열을 반환.
 * SEC companyfacts API → 연간 5개년 + 최근 4분기. 7일 DB 캐시.
 */
export async function fetchEdgarTimeSeries(ticker: string): Promise<string | null> {
  if (/^\d{6}$/.test(ticker)) return null;
  const bare = ticker.replace(/\.(KS|KQ)$/i, "").toUpperCase();

  try {
    await ensureXbrlTable();
    const r = await pool.query<{ content: string; fetched_at: Date }>(
      "SELECT content, fetched_at FROM sec_edgar_xbrl WHERE ticker = $1",
      [bare]
    );
    if (r.rows[0] && Date.now() - r.rows[0].fetched_at.getTime() < 30 * 86_400_000) {
      console.log(`[edgar-xbrl] ${bare} 캐시 히트`);
      return r.rows[0].content;
    }
  } catch { /* 캐시 테이블 미생성 — 무시 */ }

  try {
    const cikMap = await getCikMap();
    const cik = cikMap.get(bare);
    if (!cik) {
      console.log(`[edgar-xbrl] ${bare} CIK 없음`);
      return null;
    }

    const res = await fetch(XBRL_FACTS_URL(cik), {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) return null;

    const data = (await res.json()) as any;
    const gaap = data?.facts?.["us-gaap"];
    if (!gaap) return null;

    const summary = buildXbrlSummary(gaap, data.entityName ?? bare);
    if (!summary) return null;

    try {
      await pool.query(
        `INSERT INTO sec_edgar_xbrl (ticker, content, fetched_at) VALUES ($1, $2, NOW())
         ON CONFLICT (ticker) DO UPDATE SET content = $2, fetched_at = NOW()`,
        [bare, summary]
      );
    } catch { /* 캐시 저장 실패 무시 */ }

    console.log(`[edgar-xbrl] ${bare} XBRL 완료 (${summary.length}자)`);
    return summary;

  } catch (e) {
    console.warn("[edgar-xbrl] 조회 실패:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

/**
 * 미국 주식 티커의 SEC 10-K "Item 7. MD&A" 섹션을 반환.
 * 기존 sec_edgar_mda 테이블에 30일 캐시.
 */
export async function fetchEdgarMDA(ticker: string): Promise<string | null> {
  if (/^\d{6}$/.test(ticker)) return null;
  const bare = ticker.replace(/\.(KS|KQ)$/i, "").toUpperCase();

  // MD&A 전용 캐시 테이블
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sec_edgar_mda (
        ticker     VARCHAR(20) PRIMARY KEY,
        content    TEXT,
        fetched_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    const r = await pool.query<{ content: string | null; fetched_at: Date }>(
      "SELECT content, fetched_at FROM sec_edgar_mda WHERE ticker = $1",
      [bare]
    );
    if (r.rows[0] && Date.now() - r.rows[0].fetched_at.getTime() < 30 * 86_400_000) {
      if (!r.rows[0].content) return null; // 이전에 추출 실패 → 재시도 안 함
      console.log(`[edgar-mda] ${bare} 캐시 히트`);
      return r.rows[0].content;
    }
  } catch { /* ignore */ }

  try {
    const cikMap = await getCikMap();
    const cik = cikMap.get(bare);
    if (!cik) return null;

    const filing = await fetchLatestAnnualFiling(cik);
    if (!filing) return null;

    const docUrl = await findPrimaryDocUrl(cik, filing.accessionNumber);
    if (!docUrl) return null;

    const docRes = await fetch(docUrl, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(25_000),
    });
    if (!docRes.ok) return null;

    const cl = Number(docRes.headers.get("content-length") ?? "0");
    if (cl > MAX_HTML_BYTES) return null;

    const rawHtml = await docRes.text();
    if (rawHtml.length > MAX_HTML_BYTES) return null;

    const text = htmlToText(rawHtml);
    const mda  = extractMdaSection(text, 4_000);

    const result = mda
      ? [
          `[📝 SEC 10-K — Item 7. MD&A (${filing.filedDate} 제출)]`,
          `⚠️ 경영진 직접 작성 구간. 가이던스·리스크·전략 방향 파악에 활용하세요.`,
          mda,
        ].join("\n")
      : null;

    try {
      await pool.query(
        `INSERT INTO sec_edgar_mda (ticker, content, fetched_at) VALUES ($1, $2, NOW())
         ON CONFLICT (ticker) DO UPDATE SET content = $2, fetched_at = NOW()`,
        [bare, result]
      );
    } catch { /* ignore */ }

    console.log(`[edgar-mda] ${bare} MD&A ${result ? `완료 (${result.length}자)` : "추출 실패"}`);
    return result;

  } catch (e) {
    console.warn("[edgar-mda] 조회 실패:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

/**
 * 미국 주식 티커를 입력받아 SEC 10-K/20-F "Item 1. Business" 주요 내용을 반환.
 * 실패·타임아웃 시 null 반환 (분석 파이프라인 블로킹 없음).
 */
export async function fetchSECEdgarContent(ticker: string): Promise<string | null> {
  // 한국 종목 코드(숫자 6자리)는 스킵
  if (/^\d{6}$/.test(ticker)) return null;
  // .KS/.KQ 접미사 제거
  const bare = ticker.replace(/\.(KS|KQ)$/i, "").toUpperCase();

  // ── 캐시 확인 ──
  const cached = await getCached(bare);
  if (cached) {
    console.log(`[sec-edgar] ${bare} 캐시 히트`);
    return cached;
  }

  try {
    // ── CIK 조회 ──
    const cikMap = await getCikMap();
    const cik = cikMap.get(bare);
    if (!cik) {
      console.log(`[sec-edgar] ${bare} CIK 없음 — 스킵`);
      return null;
    }

    // ── 최신 10-K / 20-F 접수번호 조회 ──
    const filing = await fetchLatestAnnualFiling(cik);
    if (!filing) {
      console.log(`[sec-edgar] ${bare} (CIK ${cik}) 연간보고서 없음`);
      return null;
    }

    // ── 주요 문서 URL 탐색 ──
    const docUrl = await findPrimaryDocUrl(cik, filing.accessionNumber);
    if (!docUrl) {
      console.log(`[sec-edgar] ${bare} 주요 문서 URL 탐색 실패`);
      return null;
    }

    // ── HTML 다운로드 (크기 제한) ──
    const docRes = await fetch(docUrl, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(25_000),
    });
    if (!docRes.ok) return null;

    const cl = Number(docRes.headers.get("content-length") ?? "0");
    if (cl > MAX_HTML_BYTES) {
      console.warn(`[sec-edgar] ${bare} 문서 ${(cl / 1e6).toFixed(1)}MB > 15MB 제한, 스킵`);
      return null;
    }

    const rawHtml = await docRes.text();
    if (rawHtml.length > MAX_HTML_BYTES) return null;

    // ── Item 1 Business 섹션 추출 ──
    const text    = htmlToText(rawHtml);
    const section = extractBusinessSection(text, 5_000);
    if (!section) {
      console.log(`[sec-edgar] ${bare} Item 1 Business 섹션 추출 실패`);
      return null;
    }

    const result = [
      `[📄 SEC 10-K — Item 1. Business (${filing.filedDate} 제출, ${filing.form})]`,
      `⚠️ SEC 공시 원문 기반 사업 내용. 주요 제품·시장·경쟁·전략 파악에 활용. 재무 수치는 Yahoo Finance 섹션과 교차 검증 필수.`,
      section,
    ].join("\n");

    await setCached(bare, filing.form, filing.filedDate, result);
    console.log(`[sec-edgar] ${bare} 10-K 추출 완료 (${result.length}자, ${filing.filedDate})`);
    return result;

  } catch (e) {
    console.warn("[sec-edgar] 조회 실패:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

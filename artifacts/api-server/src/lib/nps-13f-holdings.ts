/**
 * nps-13f-holdings.ts
 * 국민연금(NPS) SEC 13F 보고서 기반 미국 상장주식 포트폴리오
 *
 * - CIK: 0001608046 (National Pension Service)
 * - SEC EDGAR API로 최신 13F-HR 자동 탐지
 * - 직전 분기와 비중 비교(weightChange) 제공
 * - 값 단위: USD (달러, not thousands)
 * - 24시간 캐시
 */

const NPS_CIK = "1608046";
const EDGAR_HEADERS = {
  "User-Agent": "aibvida-research/1.0 contact@aibvida.com",
  "Accept-Encoding": "identity",
};
const CACHE_TTL = 24 * 60 * 60 * 1000;
const TOP_N = 100;
const USD_KRW = 1544;

export interface NPS13FHolding {
  rank: number;
  stockName: string;
  cusip: string;
  valueUsd: number;
  valueKrw100M: number;
  weight: number;
  weightChange?: number;   // 전분기 대비 비중 변화 (%p), undefined = 신규 편입
  prevWeight?: number;     // 전분기 비중
  shares: number;
}

interface CacheEntry {
  holdings: NPS13FHolding[];
  periodDate: string;
  prevPeriodDate: string;
  filedDate: string;
  totalUsd: number;
  ts: number;
}

let cache13F: CacheEntry | null = null;
let loadingPromise: Promise<CacheEntry> | null = null;

// ── SEC EDGAR: 최신 2분기 13F-HR 목록 ──────────────────────────────────────────

interface FilingInfo {
  accessionNo: string;
  periodOfReport: string;
  filedDate: string;
}

async function fetchFilings(): Promise<[FilingInfo, FilingInfo | null]> {
  const url = `https://data.sec.gov/submissions/CIK${NPS_CIK.padStart(10, "0")}.json`;
  const res = await fetch(url, { headers: EDGAR_HEADERS, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`SEC submissions 조회 실패: ${res.status}`);
  const d = await res.json() as {
    filings: { recent: { form: string[]; accessionNumber: string[]; filingDate: string[]; reportDate: string[] } };
  };

  const { form, accessionNumber, filingDate, reportDate } = d.filings.recent;
  const list: FilingInfo[] = [];
  for (let i = 0; i < form.length; i++) {
    if (form[i] === "13F-HR") {
      list.push({ accessionNo: accessionNumber[i], periodOfReport: reportDate[i], filedDate: filingDate[i] });
    }
  }
  list.sort((a, b) => (a.periodOfReport > b.periodOfReport ? -1 : 1));
  const current = list[0];
  const prev    = list[1] ?? null;
  if (!current) throw new Error("NPS 13F-HR 보고서를 찾을 수 없음");
  console.log(`[NPS-13F] 최신: ${current.periodOfReport} | 전분기: ${prev?.periodOfReport ?? "없음"}`);
  return [current, prev];
}

// ── 디렉토리 HTML에서 infoTable XML 파일명 탐색 ────────────────────────────────

async function findInfoTableUrl(accessionNo: string): Promise<string> {
  const noDashes = accessionNo.replace(/-/g, "");
  const dirUrl = `https://www.sec.gov/Archives/edgar/data/${NPS_CIK}/${noDashes}/`;
  try {
    const res = await fetch(dirUrl, { headers: EDGAR_HEADERS, signal: AbortSignal.timeout(10_000) });
    if (res.ok) {
      const html = await res.text();
      // Find all .xml hrefs, exclude primary_doc
      const matches = [...html.matchAll(/href="([^"]+\.xml)"/gi)]
        .map(m => m[1].split("/").pop()!)
        .filter(n => n && !n.startsWith("primary_doc"));
      if (matches.length > 0) {
        return `${dirUrl}${matches[0]}`;
      }
    }
  } catch {
    // fall through to hardcoded fallbacks
  }
  // Hardcoded fallback by known accession
  const KNOWN: Record<string, string> = {
    "000119312526217663": "53310.xml",
    "000160804626000001": "4q25v2.xml",
  };
  const fallback = KNOWN[noDashes] ?? "infotable.xml";
  return `${dirUrl}${fallback}`;
}

// ── infoTable XML 파싱 ─────────────────────────────────────────────────────────

interface RawEntry { name: string; cusip: string; value: number; shares: number; }

function parseInfoTable(xml: string): RawEntry[] {
  const entries: RawEntry[] = [];
  // Handle both plain <infoTable> and namespaced <ns1:infoTable> formats
  const blockRe = /<(?:[\w]+:)?infoTable[^>]*>([\s\S]*?)<\/(?:[\w]+:)?infoTable>/gi;
  let m: RegExpExecArray | null;

  const tag = (src: string, t: string) => {
    // Match <tag> or <ns:tag>
    const r = new RegExp(`<(?:[\\w]+:)?${t}[^>]*>([^<]*)</(?:[\\w]+:)?${t}>`, "i");
    return src.match(r)?.[1]?.trim() ?? "";
  };
  const decode = (s: string) =>
    s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
     .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'");

  while ((m = blockRe.exec(xml)) !== null) {
    const blk = m[1];
    const name  = decode(tag(blk, "nameOfIssuer"));
    const cusip = tag(blk, "cusip");
    const value  = parseInt(tag(blk, "value").replace(/,/g, ""), 10) || 0;
    const shares = parseInt(tag(blk, "sshPrnamt").replace(/,/g, ""), 10) || 0;
    if (name && value > 0) entries.push({ name, cusip, value, shares });
  }
  return entries;
}

async function fetchAndParse(filing: FilingInfo): Promise<{ raw: RawEntry[]; total: number }> {
  const xmlUrl = await findInfoTableUrl(filing.accessionNo);
  console.log(`[NPS-13F] 다운로드: ${filing.periodOfReport} → ${xmlUrl}`);
  const res = await fetch(xmlUrl, { headers: EDGAR_HEADERS, signal: AbortSignal.timeout(25_000) });
  if (!res.ok) throw new Error(`13F XML 다운로드 실패 (${filing.periodOfReport}): ${res.status}`);
  const raw = parseInfoTable(await res.text());
  const total = raw.reduce((s, x) => s + x.value, 0);
  console.log(`[NPS-13F] 파싱 완료 ${filing.periodOfReport}: ${raw.length}개, $${(total / 1e9).toFixed(1)}B`);
  return { raw, total };
}

// ── 메인 로드 ──────────────────────────────────────────────────────────────────

async function load13FData(): Promise<CacheEntry> {
  const [current, prev] = await fetchFilings();

  // 병렬 다운로드
  const [curData, prevData] = await Promise.all([
    fetchAndParse(current),
    prev ? fetchAndParse(prev).catch(e => { console.warn("[NPS-13F] 전분기 로드 실패:", e); return null; }) : null,
  ]);

  curData.raw.sort((a, b) => b.value - a.value);
  const totalUsd = curData.total;

  // 전분기 CUSIP → 비중 맵
  const prevMap = new Map<string, number>();
  if (prevData) {
    const prevTotal = prevData.total;
    for (const h of prevData.raw) {
      prevMap.set(h.cusip, prevTotal > 0 ? (h.value / prevTotal) * 100 : 0);
    }
  }

  const holdings: NPS13FHolding[] = curData.raw.slice(0, TOP_N).map((h, i) => {
    const weight = totalUsd > 0 ? (h.value / totalUsd) * 100 : 0;
    const prevW  = prevMap.size > 0 ? prevMap.get(h.cusip) : undefined;
    return {
      rank: i + 1,
      stockName: h.name.replace(/\s+/g, " "),
      cusip: h.cusip,
      valueUsd: h.value,
      valueKrw100M: Math.round(h.value * USD_KRW / 1e8),
      weight: parseFloat(weight.toFixed(4)),
      weightChange: prevW !== undefined ? parseFloat((weight - prevW).toFixed(4)) : undefined,
      prevWeight:   prevW !== undefined ? parseFloat(prevW.toFixed(4)) : undefined,
      shares: h.shares,
    };
  });

  const result: CacheEntry = {
    holdings,
    periodDate: current.periodOfReport,
    prevPeriodDate: prev?.periodOfReport ?? "",
    filedDate: current.filedDate,
    totalUsd,
    ts: Date.now(),
  };
  cache13F = result;
  loadingPromise = null;
  return result;
}

export async function getNPS13FHoldings(): Promise<{
  holdings: NPS13FHolding[];
  periodDate: string;
  prevPeriodDate: string;
  filedDate: string;
  totalUsd: number;
  totalKrw100M: number;
  totalHoldings: number;
}> {
  if (cache13F && Date.now() - cache13F.ts < CACHE_TTL) {
    return toResult(cache13F);
  }
  if (!loadingPromise) {
    loadingPromise = load13FData().catch(err => {
      console.error("[NPS-13F] 로드 실패:", err);
      loadingPromise = null;
      throw err;
    });
  }
  return toResult(await loadingPromise);
}

function toResult(c: CacheEntry) {
  return {
    holdings: c.holdings,
    periodDate: c.periodDate,
    prevPeriodDate: c.prevPeriodDate,
    filedDate: c.filedDate,
    totalUsd: c.totalUsd,
    totalKrw100M: Math.round(c.totalUsd * USD_KRW / 1e8),
    totalHoldings: c.holdings.length,
  };
}

export function invalidate13FCache(): void {
  cache13F = null;
  loadingPromise = null;
}

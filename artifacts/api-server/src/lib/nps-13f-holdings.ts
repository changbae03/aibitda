/**
 * nps-13f-holdings.ts
 * 국민연금(NPS) SEC 13F 보고서 기반 미국 상장주식 포트폴리오
 *
 * - CIK: 0001608046 (National Pension Service)
 * - SEC EDGAR API로 최신 13F-HR 자동 탐지
 * - 분기별 갱신 (Q1 2026 기준 = 2026-03-31)
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
const USD_KRW = 1544; // approximate — could be fetched live

export interface NPS13FHolding {
  rank: number;
  stockName: string;
  cusip: string;
  valueUsd: number;         // USD
  valueKrw100M: number;     // 억원
  weight: number;           // 포트폴리오 비중 %
  shares: number;
}

interface CacheEntry {
  holdings: NPS13FHolding[];
  periodDate: string;
  filedDate: string;
  totalUsd: number;
  ts: number;
}

let cache13F: CacheEntry | null = null;
let loadingPromise: Promise<CacheEntry> | null = null;

// ── SEC EDGAR: 최신 13F-HR 조회 ────────────────────────────────────────────────

interface FilingInfo {
  accessionNo: string;
  periodOfReport: string;
  filedDate: string;
}

async function fetchLatest13F(): Promise<FilingInfo> {
  const url = `https://data.sec.gov/submissions/CIK${NPS_CIK.padStart(10, "0")}.json`;
  const res = await fetch(url, { headers: EDGAR_HEADERS, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`SEC submissions 조회 실패: ${res.status}`);
  const d = await res.json() as {
    filings: {
      recent: {
        form: string[];
        accessionNumber: string[];
        filingDate: string[];
        reportDate: string[];
      };
    };
  };

  const { form, accessionNumber, filingDate, reportDate } = d.filings.recent;
  let best: FilingInfo | null = null;
  for (let i = 0; i < form.length; i++) {
    if (form[i] === "13F-HR") {
      const info: FilingInfo = {
        accessionNo: accessionNumber[i],
        periodOfReport: reportDate[i],
        filedDate: filingDate[i],
      };
      if (!best || info.periodOfReport > best.periodOfReport) best = info;
    }
  }
  if (!best) throw new Error("NPS 13F-HR 보고서를 찾을 수 없음");
  console.log(`[NPS-13F] 최신 보고서: period=${best.periodOfReport} filed=${best.filedDate} accession=${best.accessionNo}`);
  return best;
}

// ── 13F 파일 목록에서 infoTable XML URL 탐색 ───────────────────────────────────

async function findInfoTableUrl(accessionNo: string): Promise<string> {
  const noDashes = accessionNo.replace(/-/g, "");
  const indexUrl = `https://www.sec.gov/Archives/edgar/data/${NPS_CIK}/${noDashes}/${accessionNo}-index.json`;
  const res = await fetch(indexUrl, { headers: EDGAR_HEADERS, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    // fallback: known pattern
    return `https://www.sec.gov/Archives/edgar/data/${NPS_CIK}/${noDashes}/53310.xml`;
  }
  const idx = await res.json() as { directory: { item: { name: string; type: string }[] } };
  const items = idx.directory?.item ?? [];
  const xml = items.find(
    it => it.name.endsWith(".xml") && !it.name.startsWith("primary_doc")
  );
  if (xml) {
    return `https://www.sec.gov/Archives/edgar/data/${NPS_CIK}/${noDashes}/${xml.name}`;
  }
  return `https://www.sec.gov/Archives/edgar/data/${NPS_CIK}/${noDashes}/53310.xml`;
}

// ── infoTable XML 파싱 ─────────────────────────────────────────────────────────

interface RawEntry {
  name: string;
  cusip: string;
  value: number;
  shares: number;
}

function parseInfoTable(xml: string): RawEntry[] {
  // Namespace-agnostic regex-based parse for speed/robustness
  const entries: RawEntry[] = [];
  const blockRe = /<infoTable[^>]*>([\s\S]*?)<\/infoTable>/gi;
  let m: RegExpExecArray | null;

  const tag = (src: string, t: string) => {
    const r = new RegExp(`<${t}[^>]*>([^<]*)</${t}>`, "i");
    return src.match(r)?.[1]?.trim() ?? "";
  };

  const decodeHtml = (s: string) =>
    s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
     .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'");

  while ((m = blockRe.exec(xml)) !== null) {
    const blk = m[1];
    const name  = decodeHtml(tag(blk, "nameOfIssuer"));
    const cusip = tag(blk, "cusip");
    const valStr = tag(blk, "value");
    const shrStr = tag(blk, "sshPrnamt");

    const value  = parseInt(valStr.replace(/,/g, ""), 10) || 0;
    const shares = parseInt(shrStr.replace(/,/g, ""), 10) || 0;
    if (name && value > 0) {
      entries.push({ name, cusip, value, shares });
    }
  }
  return entries;
}

// ── 메인 로드 함수 ─────────────────────────────────────────────────────────────

async function load13FData(): Promise<CacheEntry> {
  const filing = await fetchLatest13F();
  const xmlUrl = await findInfoTableUrl(filing.accessionNo);

  console.log(`[NPS-13F] infoTable URL: ${xmlUrl}`);
  const xmlRes = await fetch(xmlUrl, { headers: EDGAR_HEADERS, signal: AbortSignal.timeout(20_000) });
  if (!xmlRes.ok) throw new Error(`13F XML 다운로드 실패: ${xmlRes.status}`);
  const xmlText = await xmlRes.text();

  const raw = parseInfoTable(xmlText);
  console.log(`[NPS-13F] 파싱 완료: ${raw.length}개 종목`);

  raw.sort((a, b) => b.value - a.value);
  const totalUsd = raw.reduce((s, x) => s + x.value, 0);

  const holdings: NPS13FHolding[] = raw.slice(0, TOP_N).map((h, i) => ({
    rank: i + 1,
    stockName: h.name.replace(/\s+/g, " "),
    cusip: h.cusip,
    valueUsd: h.value,
    valueKrw100M: Math.round(h.value * USD_KRW / 1e8),
    weight: totalUsd > 0 ? parseFloat(((h.value / totalUsd) * 100).toFixed(4)) : 0,
    shares: h.shares,
  }));

  const result: CacheEntry = {
    holdings,
    periodDate: filing.periodOfReport,
    filedDate: filing.filedDate,
    totalUsd,
    ts: Date.now(),
  };
  cache13F = result;
  loadingPromise = null;
  console.log(`[NPS-13F] 캐시 저장 완료 — 기준: ${filing.periodOfReport}, 총 ${raw.length}개, $${(totalUsd / 1e9).toFixed(1)}B`);
  return result;
}

export async function getNPS13FHoldings(): Promise<{
  holdings: NPS13FHolding[];
  periodDate: string;
  filedDate: string;
  totalUsd: number;
  totalKrw100M: number;
  totalHoldings: number;
}> {
  if (cache13F && Date.now() - cache13F.ts < CACHE_TTL) {
    return {
      holdings: cache13F.holdings,
      periodDate: cache13F.periodDate,
      filedDate: cache13F.filedDate,
      totalUsd: cache13F.totalUsd,
      totalKrw100M: Math.round(cache13F.totalUsd * USD_KRW / 1e8),
      totalHoldings: cache13F.holdings.length,
    };
  }

  if (!loadingPromise) {
    loadingPromise = load13FData().catch(err => {
      console.error("[NPS-13F] 로드 실패:", err);
      loadingPromise = null;
      throw err;
    });
  }

  const result = await loadingPromise;
  return {
    holdings: result.holdings,
    periodDate: result.periodDate,
    filedDate: result.filedDate,
    totalUsd: result.totalUsd,
    totalKrw100M: Math.round(result.totalUsd * USD_KRW / 1e8),
    totalHoldings: result.holdings.length,
  };
}

export function invalidate13FCache(): void {
  cache13F = null;
  loadingPromise = null;
}

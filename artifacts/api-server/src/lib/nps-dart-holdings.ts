/**
 * nps-dart-holdings.ts
 * NPS 대량보유 공시 데이터 (DART API 기반, 분기별 최신 데이터)
 *
 * 전략:
 * 1. NPS 연간 Excel(fund.nps.or.kr)에서 지분율 4% 이상 종목 추출 (~250개)
 * 2. 각 종목에 대해 DART majorstock.json 병렬 조회
 * 3. repror = "국민연금" 필터 → 가장 최신 신고 기준 지분율
 * 4. 24시간 캐시
 */

import AdmZip from "adm-zip";
import { loadKRXList, lookupCodeByName, getKRXCache } from "./krx-cache.js";
import { getCorpCodeFromCache } from "./dart-corp-cache.js";
import { pool } from "@workspace/db";

const NPS_FILE_URL = "https://fund.nps.or.kr/fileDown.do?atchFileId=FL25002092&atchFileSn=1";
const DART_API_KEY = process.env["DART_API_KEY"] ?? "";
const CACHE_TTL = 24 * 60 * 60 * 1000;
const OWNERSHIP_THRESHOLD = 4.5;
const CONCURRENCY = 15;
const DB_CACHE_KEY = "nps_dart_v2";

export interface NPSDartHolding {
  rank: number;
  stockCode: string;
  stockName: string;
  ownershipPct: number;
  reportDate: string;
  shares: number;
  sharesChange: number;
}

interface DartMajorItem {
  rcept_dt: string;
  repror: string;
  stkqy: string;
  stkqy_irds: string;
  stkrt: string;
  stkrt_irds: string;
}

let dartCache: {
  holdings: NPSDartHolding[];
  ts: number;
  latestDate: string;
} | null = null;

let loadingPromise: Promise<typeof dartCache> | null = null;

// ── NPS Excel에서 지분율 4.5%+ 종목 코드 추출 ──────────────────────────────

const NPS_NAME_TO_CODE: Record<string, string> = {
  "현대차": "005380", "현대자동차": "005380",
  "삼성화재": "000810", "LIG넥스원": "079550",
  "LS ELECTRIC": "010120", "LS일렉트릭": "010120",
  "KT&G": "033780", "케이티앤지": "033780",
  "KT": "030200", "HD현대미포": "010620",
  "한국전력": "015760", "한국전력공사": "015760",
  "SK바이오팜": "326030", "엔씨소프트": "036570",
  "현대차2우B": "005387", "금호석유": "011780",
};

function resolveCode(name: string): string {
  const t = name.trim();
  return NPS_NAME_TO_CODE[t] ?? lookupCodeByName(t) ?? "";
}

function parseSharedStrings(xml: string): string[] {
  return (xml.match(/<si>[\s\S]*?<\/si>/g) ?? []).map(si =>
    (si.match(/<t[^>]*>[^<]*<\/t>/g) ?? [])
      .map(t => t.replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&").replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">").replace(/&apos;/g, "'").replace(/&quot;/g, '"'))
      .join("")
  );
}

function parseRows(xml: string, strings: string[]): string[][] {
  return (xml.match(/<row[^>]*>[\s\S]*?<\/row>/g) ?? []).map(rowXml =>
    (rowXml.match(/<c[^>]*>[\s\S]*?<\/c>/g) ?? []).map(cXml => {
      const t = cXml.match(/\bt="([^"]*)"/)?.[1] ?? "";
      const v = cXml.match(/<v>([^<]*)<\/v>/)?.[1];
      if (!v) return "";
      return t === "s" ? (strings[parseInt(v)] ?? "") : v;
    })
  );
}

async function getSeedStocks(): Promise<{ code: string; name: string }[]> {
  await loadKRXList();
  const res = await fetch(NPS_FILE_URL, {
    headers: { Referer: "https://fund.nps.or.kr/", "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`NPS Excel 다운로드 실패: ${res.status}`);

  const buf = Buffer.from(await res.arrayBuffer());
  const zip = new AdmZip(buf);
  const ssEntry = zip.getEntry("xl/sharedStrings.xml");
  const wsEntry = zip.getEntry("xl/worksheets/sheet1.xml");
  if (!ssEntry || !wsEntry) throw new Error("Excel 구조 오류");

  const strings = parseSharedStrings(ssEntry.getData().toString("utf-8"));
  const rows = parseRows(wsEntry.getData().toString("utf-8"), strings);

  const result: { code: string; name: string }[] = [];
  for (const row of rows.slice(3)) {
    if (!row[1] || !row[4]) continue;
    const ownership = parseFloat(row[4]) * 100;
    if (isNaN(ownership) || ownership < OWNERSHIP_THRESHOLD) continue;
    const code = resolveCode(row[1].trim());
    if (code) result.push({ code, name: row[1].trim() });
  }
  return result;
}

// ── DART majorstock 조회 ──────────────────────────────────────────────────────

async function queryDartMajorstock(
  corpCode: string
): Promise<{ ownershipPct: number; reportDate: string; shares: number; sharesChange: number } | null> {
  try {
    const url = `https://opendart.fss.or.kr/api/majorstock.json?crtfc_key=${DART_API_KEY}&corp_code=${corpCode}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const d = await res.json() as { status: string; list?: DartMajorItem[] };
    if (d.status !== "000" || !d.list?.length) return null;

    const npsItems = d.list.filter(x => x.repror?.includes("국민연금"));
    if (!npsItems.length) return null;

    npsItems.sort((a, b) => b.rcept_dt.localeCompare(a.rcept_dt));
    const latest = npsItems[0];
    return {
      ownershipPct: parseFloat(latest.stkrt) || 0,
      reportDate: latest.rcept_dt,
      shares: parseInt(latest.stkqy.replace(/,/g, ""), 10) || 0,
      sharesChange: parseInt(latest.stkqy_irds.replace(/,/g, ""), 10) || 0,
    };
  } catch {
    return null;
  }
}

// ── 배치 처리 ──────────────────────────────────────────────────────────────────

async function buildDartHoldings(): Promise<typeof dartCache> {
  console.log("[NPS-DART] 대량보유 데이터 로드 시작...");
  const seeds = await getSeedStocks();
  console.log(`[NPS-DART] seed 종목: ${seeds.length}개 (지분율 ${OWNERSHIP_THRESHOLD}%+)`);

  const holdings: NPSDartHolding[] = [];
  let latestDate = "";

  for (let i = 0; i < seeds.length; i += CONCURRENCY) {
    const chunk = seeds.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map(async ({ code, name }) => {
        const corpCode = getCorpCodeFromCache(code);
        if (!corpCode) return null;
        const data = await queryDartMajorstock(corpCode);
        if (!data || data.ownershipPct < 1) return null;
        return { code, name, ...data };
      })
    );

    for (const r of results) {
      if (r.status !== "fulfilled" || !r.value) continue;
      const { code, name, ownershipPct, reportDate, shares, sharesChange } = r.value;
      holdings.push({
        rank: 0,
        stockCode: code,
        stockName: name,
        ownershipPct,
        reportDate,
        shares,
        sharesChange,
      });
      if (reportDate > latestDate) latestDate = reportDate;
    }

    if (i % (CONCURRENCY * 4) === 0 && i > 0) {
      console.log(`[NPS-DART] 진행: ${i}/${seeds.length}`);
    }
  }

  holdings.sort((a, b) => b.ownershipPct - a.ownershipPct);
  holdings.forEach((h, i) => (h.rank = i + 1));

  console.log(`[NPS-DART] 완료: ${holdings.length}개 종목, 최신: ${latestDate}`);
  const result = { holdings, ts: Date.now(), latestDate };
  dartCache = result;
  loadingPromise = null;
  saveToDb(result).catch(e => console.warn("[NPS-DART] DB 저장 실패:", e?.message));
  return result;
}

// ── DB 퍼시스턴스 ──────────────────────────────────────────────────────────────

async function saveToDb(data: typeof dartCache): Promise<void> {
  await pool.query(
    `INSERT INTO system_cache (key, data, expires_at)
     VALUES ($1, $2::jsonb, NOW() + INTERVAL '25 hours')
     ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, expires_at = EXCLUDED.expires_at`,
    [DB_CACHE_KEY, JSON.stringify(data)],
  );
  console.log("[NPS-DART] DB 캐시 저장 완료");
}

async function restoreFromDb(): Promise<boolean> {
  try {
    const r = await pool.query<{ data: typeof dartCache }>(
      `SELECT data FROM system_cache WHERE key = $1 AND expires_at > NOW()`,
      [DB_CACHE_KEY],
    );
    const row = r.rows[0]?.data;
    if (!row?.holdings?.length) return false;
    dartCache = { ...row, ts: Date.now() };
    console.log(`[NPS-DART] DB 캐시 복원 완료: ${row.holdings.length}개 (기준: ${row.latestDate})`);
    return true;
  } catch (e: any) {
    console.warn("[NPS-DART] DB 복원 실패:", e?.message);
    return false;
  }
}

export async function getNPSDartHoldings(): Promise<{
  holdings: NPSDartHolding[];
  latestDate: string;
  totalHoldings: number;
  loading?: boolean;
}> {
  // 1순위: 메모리 캐시
  if (dartCache && Date.now() - dartCache.ts < CACHE_TTL) {
    return { holdings: dartCache.holdings, latestDate: dartCache.latestDate, totalHoldings: dartCache.holdings.length };
  }
  // 2순위: DB 캐시 (서버 재시작 후 즉시 서빙)
  if (!dartCache) {
    const restored = await restoreFromDb();
    if (restored && dartCache) {
      // 백그라운드에서 신선도 확인 후 필요 시 갱신
      if (!loadingPromise) {
        loadingPromise = buildDartHoldings().catch(e => { console.warn("[NPS-DART] 백그라운드 갱신 실패:", e?.message); loadingPromise = null; return dartCache; });
      }
      return { holdings: dartCache.holdings, latestDate: dartCache.latestDate, totalHoldings: dartCache.holdings.length };
    }
  }
  // 3순위: 새로 빌드
  if (!loadingPromise) {
    loadingPromise = buildDartHoldings();
  }
  const result = await loadingPromise;
  return {
    holdings: result?.holdings ?? [],
    latestDate: result?.latestDate ?? "",
    totalHoldings: result?.holdings.length ?? 0,
  };
}

/** 서버 시작 시 백그라운드 예열 — DB 캐시에서 즉시 복원 */
export async function warmupNpsDart(): Promise<void> {
  if (dartCache) return;
  const ok = await restoreFromDb();
  if (!ok) {
    console.log("[NPS-DART] DB 캐시 없음 — 첫 요청 시 빌드 예정");
  }
}

export function invalidateDartNPSCache(): void {
  dartCache = null;
  loadingPromise = null;
}

export function isDartNPSLoading(): boolean {
  return loadingPromise !== null && dartCache === null;
}

export function getDartNPSCacheAge(): number {
  if (!dartCache) return Infinity;
  return Date.now() - dartCache.ts;
}

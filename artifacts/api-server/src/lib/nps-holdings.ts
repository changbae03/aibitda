import AdmZip from "adm-zip";
import { loadKRXList, lookupCodeByName, getKRXCache } from "./krx-cache.js";

const NPS_NAME_TO_CODE: Record<string, string> = {
  "현대차":     "005380",
  "현대자동차": "005380",
  "삼성화재":   "000810",
  "LIG넥스원":  "079550",
  "LS ELECTRIC":"010120",
  "LS일렉트릭": "010120",
  "KT&G":       "033780",
  "케이티앤지": "033780",
  "KT":         "030200",
  "HD현대미포": "010620",
  "한국전력":   "015760",
  "한국전력공사":"015760",
  "SK바이오팜": "326030",
  "엔씨소프트": "036570",
  "현대차2우B": "005387",
  "금호석유":   "011780",
  "금호석유화학":"011780",
};

function resolveCode(name: string): string {
  const trimmed = name.trim();

  const fromMap = NPS_NAME_TO_CODE[trimmed];
  if (fromMap) return fromMap;

  return lookupCodeByName(trimmed) ?? "";
}

const NPS_FILE_URL = "https://fund.nps.or.kr/fileDown.do?atchFileId=FL25002092&atchFileSn=1";
const NPS_DATA_DATE = "2024년 12월 31일";
const CACHE_TTL = 12 * 60 * 60 * 1000;
const TOP_N = 100;

export interface NPSHolding {
  rank: number;
  stockCode: string;
  stockName: string;
  weight: number;
  valueBillion: number;
  ownershipPct: number;
}

let npsCache: { holdings: NPSHolding[]; ts: number; totalBillion: number } | null = null;

function parseSharedStrings(xml: string): string[] {
  const siBlocks = xml.match(/<si>[\s\S]*?<\/si>/g) ?? [];
  return siBlocks.map(si => {
    const texts = (si.match(/<t[^>]*>([^<]*)<\/t>/g) ?? [])
      .map(t => t.replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&").replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">").replace(/&apos;/g, "'").replace(/&quot;/g, '"'));
    return texts.join("");
  });
}

function parseRows(xml: string, strings: string[]): string[][] {
  const rows: string[][] = [];
  const rowBlocks = xml.match(/<row[^>]*>[\s\S]*?<\/row>/g) ?? [];
  for (const rowXml of rowBlocks) {
    const cells: string[] = [];
    const cellBlocks = rowXml.match(/<c[^>]*>[\s\S]*?<\/c>/g) ?? [];
    for (const cXml of cellBlocks) {
      const typeMatch = cXml.match(/\bt="([^"]*)"/);
      const t = typeMatch?.[1] ?? "";
      const vMatch = cXml.match(/<v>([^<]*)<\/v>/);
      if (vMatch) {
        cells.push(t === "s" ? (strings[parseInt(vMatch[1])] ?? "") : vMatch[1]);
      } else {
        cells.push("");
      }
    }
    rows.push(cells);
  }
  return rows;
}

export async function getNPSHoldings(): Promise<{
  holdings: NPSHolding[];
  dataDate: string;
  totalHoldings: number;
  totalBillion: number;
}> {
  if (npsCache && Date.now() - npsCache.ts < CACHE_TTL) {
    return {
      holdings: npsCache.holdings,
      dataDate: NPS_DATA_DATE,
      totalHoldings: npsCache.holdings.length,
      totalBillion: npsCache.totalBillion,
    };
  }

  await loadKRXList();

  const res = await fetch(NPS_FILE_URL, {
    headers: {
      Referer: "https://fund.nps.or.kr/oprtprcn/ivsmprcn/getOHED0003M0.do",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`NPS 파일 다운로드 실패: ${res.status}`);

  const buf = Buffer.from(await res.arrayBuffer());
  const zip = new AdmZip(buf);

  const ssEntry = zip.getEntry("xl/sharedStrings.xml");
  const wsEntry = zip.getEntry("xl/worksheets/sheet1.xml");
  if (!ssEntry || !wsEntry) throw new Error("Excel 구조 오류");

  const strings = parseSharedStrings(ssEntry.getData().toString("utf-8"));
  const rows = parseRows(wsEntry.getData().toString("utf-8"), strings);

  const allHoldings: NPSHolding[] = [];
  let totalBillion = 0;

  for (const row of rows.slice(3)) {
    if (!row[1] || !row[2]) continue;
    const rank = parseInt(row[0]);
    if (!rank || isNaN(rank)) continue;

    const name = row[1].trim();
    const value = parseFloat(row[2]);
    if (isNaN(value) || value <= 0) continue;

    const weight = parseFloat(row[3]) * 100;
    const ownership = parseFloat(row[4]) * 100;

    const code = resolveCode(name);
    allHoldings.push({
      rank,
      stockCode: code,
      stockName: name,
      weight: parseFloat(weight.toFixed(4)),
      valueBillion: parseFloat(value.toFixed(2)),
      ownershipPct: parseFloat(ownership.toFixed(2)),
    });
    totalBillion += value;
  }

  allHoldings.sort((a, b) => a.rank - b.rank);
  const top = allHoldings.slice(0, TOP_N);

  npsCache = { holdings: top, ts: Date.now(), totalBillion };
  return { holdings: top, dataDate: NPS_DATA_DATE, totalHoldings: allHoldings.length, totalBillion };
}

export function invalidateNPSCache() {
  npsCache = null;
}

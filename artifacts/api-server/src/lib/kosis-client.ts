/**
 * KOSIS (통계청 국가통계포털) API 클라이언트
 * 산업별 생산지수·수출입 통계를 AI 분석 컨텍스트에 주입
 *
 * 주요 통계표:
 *   - 광업제조업동향조사: 산업생산지수 (orgId=101, tblId=DT_1J20006)
 *   - 수출입 통계: 품목별 수출입 실적 (orgId=360, tblId=DT_045_N_TOT)
 *   - 서비스업동향조사 (orgId=101, tblId=DT_1J22003)
 */

const KOSIS_BASE = "https://kosis.kr/openapi/Param/statisticsParamData.do";
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12시간

interface KosisRow {
  PRD_DE: string;
  DT: string;
  C1_OBJ_NM?: string;
  C1_NM?: string;
  C2_NM?: string;
}

interface IndustryStat {
  period: string;
  value: number;
  itemName: string;
}

interface KosisData {
  manufacturing: IndustryStat[];
  services: IndustryStat[];
  exports: IndustryStat[];
  fetchedAt: number;
}

let _cache: KosisData | null = null;

function getKey(): string | null {
  return process.env["KOSIS_API_KEY"] ?? null;
}

async function kosisFetch(orgId: string, tblId: string, objL1: string, itmId: string, prdSe: string, startPrd: string, endPrd: string): Promise<KosisRow[]> {
  const key = getKey();
  if (!key) return [];
  try {
    const params = new URLSearchParams({
      method: "getList",
      apiKey: key,
      itmId,
      objL1,
      format: "json",
      jsonVD: "Y",
      userStatsId: "",
      prdSe,
      startPrd,
      endPrd,
      orgId,
      tblId,
    });
    const url = `${KOSIS_BASE}?${params}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = await res.json() as any;
    if (!Array.isArray(data)) return [];
    return data as KosisRow[];
  } catch (e) {
    console.warn(`[kosis] fetch error ${orgId}/${tblId}:`, (e as Error).message?.slice(0, 80));
    return [];
  }
}

function prdRange(months: number): { start: string; end: string } {
  const now = new Date();
  const end = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const start = new Date(now.getFullYear(), now.getMonth() - months, 1);
  const startStr = `${start.getFullYear()}${String(start.getMonth() + 1).padStart(2, "0")}`;
  return { start: startStr, end };
}

export async function fetchKOSISData(): Promise<KosisData | null> {
  if (_cache && Date.now() - _cache.fetchedAt < CACHE_TTL_MS) return _cache;

  const key = getKey();
  if (!key) {
    console.warn("[kosis] KOSIS_API_KEY 미설정");
    return null;
  }

  const { start, end } = prdRange(6);

  try {
    const [mfgRows, svcRows, expRows] = await Promise.allSettled([
      // 광업제조업 생산지수 — 제조업 전체
      kosisFetch("101", "DT_1J20006", "ALL", "ALL", "M", start, end),
      // 서비스업 동향 — 서비스업 전체
      kosisFetch("101", "DT_1J22003", "ALL", "ALL", "M", start, end),
      // 수출입 통계 — 전체
      kosisFetch("360", "DT_045_N_TOT", "ALL", "ALL", "M", start, end),
    ]);

    const parseRows = (settled: PromiseSettledResult<KosisRow[]>): IndustryStat[] => {
      if (settled.status !== "fulfilled") return [];
      return settled.value
        .filter(r => r.DT && r.PRD_DE)
        .map(r => ({
          period: r.PRD_DE,
          value: parseFloat(r.DT.replace(/,/g, "")),
          itemName: r.C1_NM ?? r.C2_NM ?? r.C1_OBJ_NM ?? "",
        }))
        .filter(r => !isNaN(r.value))
        .sort((a, b) => b.period.localeCompare(a.period))
        .slice(0, 6);
    };

    _cache = {
      manufacturing: parseRows(mfgRows),
      services:      parseRows(svcRows),
      exports:       parseRows(expRows),
      fetchedAt:     Date.now(),
    };

    console.log(`[kosis] 데이터 갱신 — 제조업:${_cache.manufacturing.length}건 서비스:${_cache.services.length}건 수출:${_cache.exports.length}건`);
    return _cache;
  } catch (e) {
    console.error("[kosis] fetchKOSISData 오류:", e);
    return null;
  }
}

// 섹터 키워드 → KOSIS 관련 산업 매핑
const SECTOR_KEYWORDS: Record<string, string[]> = {
  반도체:    ["반도체", "전자부품", "전자"],
  디스플레이: ["디스플레이", "평판", "전자"],
  자동차:    ["자동차", "수송기계"],
  화학:      ["화학", "석유", "정유"],
  철강:      ["철강", "금속"],
  바이오:    ["의약품", "의료"],
  건설:      ["건설", "부동산"],
  금융:      ["금융", "보험"],
  서비스:    ["서비스", "도소매", "음식"],
  IT:        ["정보통신", "소프트웨어", "IT"],
};

function matchSector(industry: string): string[] {
  const ind = (industry ?? "").toLowerCase();
  for (const [sector, keywords] of Object.entries(SECTOR_KEYWORDS)) {
    if (keywords.some(k => ind.includes(k.toLowerCase()))) return [sector, ...keywords];
  }
  return [];
}

export function buildKOSISContext(data: KosisData | null, industry: string): string | null {
  if (!data) return null;

  const sectorKw = matchSector(industry);
  const lines: string[] = [`\n[📊 KOSIS 산업동향 통계 — 거시 섹터 배경]`];

  let hasData = false;

  // 제조업 지수
  if (data.manufacturing.length > 0) {
    const relevant = sectorKw.length > 0
      ? data.manufacturing.filter(r => sectorKw.some(k => r.itemName.includes(k)))
      : [];
    const toShow = relevant.length > 0 ? relevant : data.manufacturing.slice(0, 3);
    if (toShow.length > 0) {
      lines.push(`\n▸ 산업생산지수 (제조업)`);
      for (const r of toShow.slice(0, 4)) {
        const prd = r.period.replace(/(\d{4})(\d{2})/, "$1년 $2월");
        lines.push(`  ${prd}: ${r.value.toFixed(1)} ${r.itemName ? `(${r.itemName})` : ""}`);
      }
      hasData = true;
    }
  }

  // 수출입
  if (data.exports.length > 0) {
    lines.push(`\n▸ 수출입 통계`);
    for (const r of data.exports.slice(0, 3)) {
      const prd = r.period.replace(/(\d{4})(\d{2})/, "$1년 $2월");
      lines.push(`  ${prd}: ${r.value.toLocaleString("ko-KR")} ${r.itemName ? `(${r.itemName})` : ""}`);
    }
    hasData = true;
  }

  if (!hasData) return null;

  lines.push(`\n⭐ 위 산업통계를 섹터/거시 분석 배경으로 활용하세요. 해당 종목 산업의 생산지수 추세가 상승이면 업황 호조, 하락이면 업황 둔화로 해석하세요.`);
  return lines.join("\n");
}

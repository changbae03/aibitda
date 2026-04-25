/**
 * 한국은행 ECOS API 클라이언트
 * 주요 거시경제 지표를 실시간으로 가져와 AI 분석 컨텍스트에 주입
 *
 * 통계코드:
 *   722Y001 / 0101000  — 한국은행 기준금리 (월)
 *   901Y009 / 0        — 소비자물가지수 CPI (월)
 *   731Y001 / 0000001  — 원/달러 매매기준율 (일)
 *   111Y002 / C        — 실질GDP 성장률 (분기, 전기대비)
 */

const BASE_URL = "https://ecos.bok.or.kr/api/StatisticSearch";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6시간 캐시

interface EcosMacro {
  baseRate: number | null;           // 한국은행 기준금리 (%)
  cpiIndex: number | null;          // CPI 지수 (2020=100)
  cpiYoY: number | null;            // CPI 전년동월비 (%)
  usdKrw: number | null;            // 원/달러 환율
  gdpQoQ: number | null;            // 실질GDP 전기대비 성장률 (%)
  gdpYoY: number | null;            // 실질GDP 전년동기비 성장률 (%)
  fetchedAt: number;
  latestPeriods: {
    baseRate: string;
    cpi: string;
    usdKrw: string;
    gdp: string;
  };
}

let macroCache: EcosMacro | null = null;

function getApiKey(): string | null {
  return process.env["ECOS_API_KEY"] ?? null;
}

function yyyymm(offsetMonths = 0): string {
  const d = new Date();
  d.setMonth(d.getMonth() + offsetMonths);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}${m}`;
}

function yyyymmdd(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${dd}`;
}

function yyyyq(offsetQuarters = 0): string {
  const d = new Date();
  const totalQ = Math.floor(d.getMonth() / 3) + offsetQuarters;
  const y = d.getFullYear() + Math.floor(totalQ / 4);
  const q = ((totalQ % 4) + 4) % 4 + 1;
  return `${y}Q${q}`;
}

async function ecosFetch(
  statCode: string,
  period: string,
  startDate: string,
  endDate: string,
  itemCode: string,
  count = 15
): Promise<Array<{ TIME: string; DATA_VALUE: string }>> {
  const key = getApiKey();
  if (!key) return [];
  const url = `${BASE_URL}/${key}/json/kr/1/${count}/${statCode}/${period}/${startDate}/${endDate}/${itemCode}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = await res.json() as any;
    return data?.StatisticSearch?.row ?? [];
  } catch {
    return [];
  }
}

function latestValue(rows: Array<{ TIME: string; DATA_VALUE: string }>): { val: number | null; time: string } {
  if (rows.length === 0) return { val: null, time: "" };
  const sorted = [...rows].sort((a, b) => b.TIME.localeCompare(a.TIME));
  const val = parseFloat(sorted[0].DATA_VALUE);
  return { val: isNaN(val) ? null : val, time: sorted[0].TIME };
}

export async function fetchECOSMacro(): Promise<EcosMacro | null> {
  // 캐시 유효 시 반환
  if (macroCache && Date.now() - macroCache.fetchedAt < CACHE_TTL_MS) {
    return macroCache;
  }

  const key = getApiKey();
  if (!key) {
    console.warn("[ECOS] ECOS_API_KEY 미설정, 거시지표 스킵");
    return null;
  }

  try {
    const [baseRateRows, cpiRows, cpiPrevRows, usdKrwRows, gdpRows] = await Promise.all([
      // 기준금리 — 최근 3개월
      ecosFetch("722Y001", "M", yyyymm(-3), yyyymm(0), "0101000", 5),
      // CPI 현재 — 최근 2개월
      ecosFetch("901Y009", "M", yyyymm(-2), yyyymm(0), "0", 3),
      // CPI 전년 동월 — YoY 계산용
      ecosFetch("901Y009", "M", yyyymm(-14), yyyymm(-12), "0", 3),
      // 원달러 환율 — 최근 10거래일
      ecosFetch("731Y001", "D", yyyymmdd(-15), yyyymmdd(0), "0000001", 10),
      // 실질GDP 전기대비 — 최근 4분기
      ecosFetch("111Y002", "Q", yyyyq(-5), yyyyq(0), "C", 6),
    ]);

    const baseRateResult  = latestValue(baseRateRows);
    const cpiResult       = latestValue(cpiRows);
    const cpiPrevResult   = latestValue(cpiPrevRows);
    const usdKrwResult    = latestValue(usdKrwRows);
    const gdpResult       = latestValue(gdpRows);

    // CPI YoY 계산
    let cpiYoY: number | null = null;
    if (cpiResult.val !== null && cpiPrevResult.val !== null && cpiPrevResult.val !== 0) {
      cpiYoY = ((cpiResult.val - cpiPrevResult.val) / cpiPrevResult.val) * 100;
    }

    // GDP YoY — 전년동기비 항목코드 "A"
    const gdpYoYRows = await ecosFetch("111Y002", "Q", yyyyq(-5), yyyyq(0), "A", 6);
    const gdpYoYResult = latestValue(gdpYoYRows);

    macroCache = {
      baseRate:   baseRateResult.val,
      cpiIndex:   cpiResult.val,
      cpiYoY,
      usdKrw:     usdKrwResult.val,
      gdpQoQ:     gdpResult.val,
      gdpYoY:     gdpYoYResult.val,
      fetchedAt:  Date.now(),
      latestPeriods: {
        baseRate: baseRateResult.time,
        cpi:      cpiResult.time,
        usdKrw:   usdKrwResult.time,
        gdp:      gdpResult.time,
      },
    };

    console.log("[ECOS] 거시지표 업데이트:", JSON.stringify({
      기준금리: macroCache.baseRate,
      CPI_YoY: macroCache.cpiYoY?.toFixed(2),
      원달러: macroCache.usdKrw,
      GDP_QoQ: macroCache.gdpQoQ,
      GDP_YoY: macroCache.gdpYoY,
    }));

    return macroCache;
  } catch (err: any) {
    console.error("[ECOS] 거시지표 조회 실패:", err.message);
    return null;
  }
}

/**
 * AI 프롬프트에 주입할 거시경제 컨텍스트 문자열 생성
 */
export function buildECOSContext(macro: EcosMacro | null): string {
  if (!macro) return "";

  const fmt = (v: number | null, decimals = 2, unit = "") =>
    v !== null ? `${v.toFixed(decimals)}${unit}` : "N/A";

  const period = (t: string) => {
    if (!t) return "";
    if (t.length === 6) return `${t.slice(0, 4)}년 ${t.slice(4)}월`;
    if (t.length === 7 && t.includes("Q")) return `${t.slice(0, 4)}년 ${t.slice(5)}분기`;
    if (t.length === 8) return `${t.slice(0, 4)}.${t.slice(4, 6)}.${t.slice(6)}`;
    return t;
  };

  const cpiTrend = macro.cpiYoY !== null
    ? (macro.cpiYoY >= 3.0 ? "⚠️ 물가 상승 압력 지속" : macro.cpiYoY >= 2.0 ? "물가 안정권 상단" : "✅ 물가 안정")
    : "";

  const rateCycle = macro.baseRate !== null
    ? (macro.baseRate >= 3.5 ? "고금리 긴축 국면" : macro.baseRate >= 2.5 ? "금리 인하 사이클 진입" : "완화적 통화정책")
    : "";

  return `\n[🏦 한국은행 ECOS 실시간 거시경제 지표]
⚠️ 아래는 ECOS API로 실시간 조회한 데이터입니다. AI 학습 데이터 대신 이 값을 최우선으로 사용하세요.

  한국은행 기준금리: ${fmt(macro.baseRate, 2, "%")} (${period(macro.latestPeriods.baseRate)}) — ${rateCycle}
  소비자물가(CPI): ${fmt(macro.cpiIndex, 2)} (2020=100, ${period(macro.latestPeriods.cpi)}) / 전년동월비: ${fmt(macro.cpiYoY, 2, "%")} ${cpiTrend}
  원/달러 환율: ${fmt(macro.usdKrw, 0, "원")} (${period(macro.latestPeriods.usdKrw)})
  실질GDP 성장률: 전기대비 ${fmt(macro.gdpQoQ, 1, "%")} / 전년동기비 ${fmt(macro.gdpYoY, 1, "%")} (${period(macro.latestPeriods.gdp)})

→ WACC 산출 기준: 무위험수익률(Rf) = 기준금리 ${fmt(macro.baseRate, 2, "%")} 기반으로 추정 (국고채 3년/10년 스프레드 고려)
→ 환율 ${fmt(macro.usdKrw, 0, "원")} 기준으로 달러 표시 수익/비용 환산
→ 금리 사이클 "${rateCycle}" 반영하여 할인율 및 밸류에이션 배수 조정`;
}

// 서버 시작 시 프리로드
fetchECOSMacro().catch(() => {});

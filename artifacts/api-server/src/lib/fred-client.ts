/**
 * FRED (Federal Reserve Economic Data) API 클라이언트
 * 미국 거시경제 지표를 실시간으로 가져와 미국 주식 AI 분석 컨텍스트에 주입
 *
 * 시리즈 ID:
 *   FEDFUNDS        — 연방기금금리 (월, %)
 *   DGS10           — 10년 국채수익률 (일, %)
 *   DGS2            — 2년 국채수익률 (일, %)
 *   CPIAUCSL        — CPI 지수 (월, 계절조정, 1982-84=100)
 *   A191RL1Q225SBEA — 실질GDP 성장률 (분기, 전기대비 연율 %)
 *   UNRATE          — 실업률 (월, %)
 */

const BASE_URL = "https://api.stlouisfed.org/fred/series/observations";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6시간 캐시

export interface FredMacro {
  fedFundsRate: number | null;   // 연방기금금리 (%)
  t10y: number | null;           // 10년 국채수익률 (%)
  t2y: number | null;            // 2년 국채수익률 (%)
  yieldSpread: number | null;    // 10Y-2Y 장단기 스프레드 (%)
  cpiIndex: number | null;       // CPI 지수
  cpiYoY: number | null;         // CPI 전년동월비 (%)
  gdpGrowth: number | null;      // 실질GDP 성장률 전기대비 연율 (%)
  unemploymentRate: number | null; // 실업률 (%)
  fetchedAt: number;
  latestDates: {
    fedFunds: string;
    treasury: string;
    cpi: string;
    gdp: string;
  };
}

let macroCache: FredMacro | null = null;

function getApiKey(): string | null {
  return process.env["FRED_API_KEY"] ?? null;
}

async function fredFetch(
  seriesId: string,
  limit = 3,
  sortOrder: "desc" | "asc" = "desc"
): Promise<Array<{ date: string; value: string }>> {
  const key = getApiKey();
  if (!key) return [];
  const url = `${BASE_URL}?series_id=${seriesId}&api_key=${key}&file_type=json&sort_order=${sortOrder}&limit=${limit}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = await res.json() as any;
    return (data?.observations ?? []).filter((o: any) => o.value !== ".");
  } catch {
    return [];
  }
}

function latestVal(
  obs: Array<{ date: string; value: string }>
): { val: number | null; date: string } {
  if (obs.length === 0) return { val: null, date: "" };
  const v = parseFloat(obs[0].value);
  return { val: isNaN(v) ? null : v, date: obs[0].date };
}

export async function fetchFREDMacro(): Promise<FredMacro | null> {
  if (macroCache && Date.now() - macroCache.fetchedAt < CACHE_TTL_MS) {
    return macroCache;
  }

  const key = getApiKey();
  if (!key) {
    console.warn("[FRED] FRED_API_KEY 미설정, 미국 거시지표 스킵");
    return null;
  }

  try {
    // CPI YoY 계산: 현재 + 13개월 전 (오름차순으로 가져와 끝에서 계산)
    const [
      fedFundsObs,
      t10yObs,
      t2yObs,
      cpiObs,
      gdpObs,
      unrateObs,
    ] = await Promise.all([
      fredFetch("FEDFUNDS", 2),
      fredFetch("DGS10", 5),
      fredFetch("DGS2", 5),
      fredFetch("CPIAUCSL", 14, "desc"),  // 현재 + 13개월치 (YoY 계산)
      fredFetch("A191RL1Q225SBEA", 3),
      fredFetch("UNRATE", 2),
    ]);

    const fedResult    = latestVal(fedFundsObs);
    const t10yResult   = latestVal(t10yObs);
    const t2yResult    = latestVal(t2yObs);
    const gdpResult    = latestVal(gdpObs);
    const unrateResult = latestVal(unrateObs);

    // CPI YoY 계산
    const cpiCurrent = latestVal(cpiObs);
    let cpiYoY: number | null = null;
    if (cpiObs.length >= 13) {
      const prevVal = parseFloat(cpiObs[12]?.value ?? "");
      if (!isNaN(prevVal) && prevVal !== 0 && cpiCurrent.val !== null) {
        cpiYoY = ((cpiCurrent.val - prevVal) / prevVal) * 100;
      }
    }

    // 10Y-2Y 스프레드 (장단기 금리차)
    const yieldSpread =
      t10yResult.val !== null && t2yResult.val !== null
        ? t10yResult.val - t2yResult.val
        : null;

    macroCache = {
      fedFundsRate:     fedResult.val,
      t10y:             t10yResult.val,
      t2y:              t2yResult.val,
      yieldSpread,
      cpiIndex:         cpiCurrent.val,
      cpiYoY,
      gdpGrowth:        gdpResult.val,
      unemploymentRate: unrateResult.val,
      fetchedAt:        Date.now(),
      latestDates: {
        fedFunds:  fedResult.date,
        treasury:  t10yResult.date,
        cpi:       cpiCurrent.date,
        gdp:       gdpResult.date,
      },
    };

    console.log("[FRED] 거시지표 업데이트:", JSON.stringify({
      Fed금리: macroCache.fedFundsRate,
      "10Y": macroCache.t10y,
      "2Y": macroCache.t2y,
      장단기스프레드: macroCache.yieldSpread?.toFixed(2),
      CPI_YoY: macroCache.cpiYoY?.toFixed(2),
      GDP: macroCache.gdpGrowth,
      실업률: macroCache.unemploymentRate,
    }));

    return macroCache;
  } catch (err: any) {
    console.error("[FRED] 거시지표 조회 실패:", err.message);
    return null;
  }
}

/**
 * AI 프롬프트에 주입할 미국 거시경제 컨텍스트 문자열 생성
 */
export function buildFREDContext(macro: FredMacro | null): string {
  if (!macro) return "";

  const fmt = (v: number | null, d = 2, unit = "") =>
    v !== null ? `${v.toFixed(d)}${unit}` : "N/A";

  const fmt0 = (v: number | null, unit = "") =>
    v !== null ? `${v.toFixed(0)}${unit}` : "N/A";

  // 금리 사이클 해석
  const rateCycle =
    macro.fedFundsRate !== null
      ? macro.fedFundsRate >= 5.0
        ? "고금리 긴축 국면 (밸류에이션 압박)"
        : macro.fedFundsRate >= 3.5
        ? "금리 인하 사이클 초입"
        : macro.fedFundsRate >= 2.0
        ? "완화적 통화정책 국면"
        : "초완화 저금리 환경"
      : "";

  // 수익률 곡선 해석
  const curveSignal =
    macro.yieldSpread !== null
      ? macro.yieldSpread < 0
        ? `⚠️ 역전 (${fmt(macro.yieldSpread, 2)}%p) — 경기침체 선행 신호`
        : macro.yieldSpread < 0.5
        ? `평탄 (${fmt(macro.yieldSpread, 2)}%p) — 경기 불확실성`
        : `정상 우상향 (${fmt(macro.yieldSpread, 2)}%p) — 경기 회복 국면`
      : "";

  // CPI 국면
  const cpiPhase =
    macro.cpiYoY !== null
      ? macro.cpiYoY >= 4.0
        ? "⚠️ 고인플레이션 (Fed 추가 긴축 리스크)"
        : macro.cpiYoY >= 2.5
        ? "인플레이션 둔화 중 (목표치 상회)"
        : "✅ 물가 안정 (Fed 목표 2% 근접)"
      : "";

  const rf = macro.t10y ?? macro.fedFundsRate;

  return `\n[🇺🇸 FRED 실시간 미국 거시경제 지표]
⚠️ 아래는 FRED API로 실시간 조회한 데이터입니다. AI 학습 데이터 대신 이 값을 최우선으로 사용하세요.

  연방기금금리(Fed Funds): ${fmt(macro.fedFundsRate, 2, "%")} (${macro.latestDates.fedFunds}) — ${rateCycle}
  10년 국채수익률(DGS10): ${fmt(macro.t10y, 2, "%")} | 2년(DGS2): ${fmt(macro.t2y, 2, "%")} (${macro.latestDates.treasury})
  장단기 금리차(10Y-2Y): ${curveSignal}
  미국 CPI: ${fmt0(macro.cpiIndex)} (${macro.latestDates.cpi}) / 전년동월비: ${fmt(macro.cpiYoY, 2, "%")} ${cpiPhase}
  실질GDP 성장률(전기대비 연율): ${fmt(macro.gdpGrowth, 1, "%")} (${macro.latestDates.gdp})
  실업률(UNRATE): ${fmt(macro.unemploymentRate, 1, "%")}

→ WACC 무위험수익률(Rf): 10Y UST ${fmt(macro.t10y, 2, "%")} 기준으로 설정${rf !== macro.t10y ? ` (또는 Fed Funds ${fmt(macro.fedFundsRate, 2, "%")})` : ""}
→ DCF 할인율 조정: 현재 금리 사이클 "${rateCycle}" 반영
→ 수익률 곡선 ${curveSignal ? `(${curveSignal})` : ""} — 섹터별 상대 밸류에이션에 반영
→ ERP(Equity Risk Premium) 추정 시 현재 10Y UST ${fmt(macro.t10y, 2, "%")} 기준`;
}

// 서버 시작 시 프리로드
fetchFREDMacro().catch(() => {});

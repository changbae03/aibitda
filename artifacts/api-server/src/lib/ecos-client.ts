/**
 * 한국은행 ECOS API 클라이언트
 * 주요 거시경제 지표를 실시간으로 가져와 AI 분석 컨텍스트에 주입
 *
 * ECOS 통계코드:
 *   722Y001 / 0101000   — 한국은행 기준금리 (월)
 *   901Y009 / 0         — 소비자물가지수 CPI (월)
 *   731Y001 / 0000001   — 원/달러 매매기준율 (일)
 *   111Y002 / C         — 실질GDP 전기대비 (분기) — 샘플키 제한으로 보통 0 rows
 *   817Y002 / 010202000 — 국고채 3년 (일/월) — 샘플키 제한으로 보통 0 rows
 *   817Y002 / 010204000 — 국고채 10년 (일/월) — 샘플키 제한으로 보통 0 rows
 *
 * FRED 폴백 (ECOS 샘플키 접근 불가 시):
 *   NAEXKP01KRQ657S — 한국 실질GDP 전기대비 성장률 (OECD/분기, %)
 *   IRLTLT01KRM156N — 한국 장기국채수익률 10Y (OECD/월, %)
 *   국고채 3년: FRED 미제공 → 10년물 – 0.4%p 추정
 */

const BASE_URL = "https://ecos.bok.or.kr/api/StatisticSearch";
const FRED_BASE = "https://api.stlouisfed.org/fred/series/observations";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6시간 캐시

export interface EcosMacro {
  baseRate: number | null;           // 한국은행 기준금리 (%)
  cpiIndex: number | null;          // CPI 지수 (2020=100)
  cpiYoY: number | null;            // CPI 전년동월비 (%)
  usdKrw: number | null;            // 원/달러 환율
  gdpQoQ: number | null;            // 실질GDP 전기대비 성장률 (%)
  gdpYoY: number | null;            // 실질GDP 전년동기비 성장률 (%)
  bondYield3Y: number | null;       // 국고채 3년 금리 (%)
  bondYield10Y: number | null;      // 국고채 10년 금리 (%)
  fetchedAt: number;
  latestPeriods: {
    baseRate: string;
    cpi: string;
    usdKrw: string;
    gdp: string;
    bond: string;
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
    if (!res.ok) {
      console.warn(`[ECOS] HTTP ${res.status} for ${statCode}/${itemCode}`);
      return [];
    }
    const data = await res.json() as any;
    const rows = data?.StatisticSearch?.row ?? [];
    if (rows.length === 0) {
      const errMsg = data?.RESULT?.MESSAGE ?? JSON.stringify(data).slice(0, 120);
      console.warn(`[ECOS] 0 rows for ${statCode}/${itemCode} (${period} ${startDate}~${endDate}): ${errMsg}`);
    }
    return rows;
  } catch (e) {
    console.warn(`[ECOS] fetch error for ${statCode}/${itemCode}:`, e);
    return [];
  }
}

function latestValue(rows: Array<{ TIME: string; DATA_VALUE: string }>): { val: number | null; time: string } {
  if (rows.length === 0) return { val: null, time: "" };
  const sorted = [...rows].sort((a, b) => b.TIME.localeCompare(a.TIME));
  const val = parseFloat(sorted[0].DATA_VALUE);
  return { val: isNaN(val) ? null : val, time: sorted[0].TIME };
}

/** FRED 한국 전용 시리즈 폴백 (ECOS에서 누락되는 GDP, 국채금리) */
async function fredKorFetch(seriesId: string, limit = 4): Promise<number | null> {
  const key = process.env["FRED_API_KEY"];
  if (!key) return null;
  const url = `${FRED_BASE}?series_id=${seriesId}&api_key=${key}&file_type=json&sort_order=desc&limit=${limit}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json() as any;
    const obs: Array<{ date: string; value: string }> = (data?.observations ?? []).filter((o: any) => o.value !== ".");
    if (obs.length === 0) return null;
    const val = parseFloat(obs[0].value);
    return isNaN(val) ? null : val;
  } catch {
    return null;
  }
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
    // ── 1단계: ECOS API 동시 조회 ────────────────────────────────────────
    const [
      baseRateRows, cpiRows, cpiPrevRows, usdKrwRows,
      gdpQoQRows,
      // 국고채: 일별(D)과 월별(M) 두 가지 동시 시도 — ECOS 샘플키는 보통 월별만 허용
      bond3Y_D, bond10Y_D,
      bond3Y_M, bond10Y_M,
    ] = await Promise.all([
      ecosFetch("722Y001", "M", yyyymm(-3), yyyymm(0),    "0101000",  5),  // 기준금리
      ecosFetch("901Y009", "M", yyyymm(-2), yyyymm(0),    "0",        3),  // CPI 현재
      ecosFetch("901Y009", "M", yyyymm(-14), yyyymm(-12), "0",        3),  // CPI 전년
      ecosFetch("731Y001", "D", yyyymmdd(-15), yyyymmdd(0),"0000001", 10), // 원달러
      // GDP 전기대비 — 항목코드 "C" (계절조정 전기대비) 시도
      ecosFetch("111Y002", "Q", yyyyq(-12), yyyyq(-1),    "C",        12),
      // 국고채 일별 (D)
      ecosFetch("817Y002", "D", yyyymmdd(-30), yyyymmdd(0), "010202000", 30),
      ecosFetch("817Y002", "D", yyyymmdd(-30), yyyymmdd(0), "010204000", 30),
      // 국고채 월별 (M)
      ecosFetch("817Y002", "M", yyyymm(-3), yyyymm(0), "010202000", 5),
      ecosFetch("817Y002", "M", yyyymm(-3), yyyymm(0), "010204000", 5),
    ]);

    const baseRateResult  = latestValue(baseRateRows);
    const cpiResult       = latestValue(cpiRows);
    const cpiPrevResult   = latestValue(cpiPrevRows);
    const usdKrwResult    = latestValue(usdKrwRows);
    const gdpQoQResult    = latestValue(gdpQoQRows);

    // 일별 > 월별 순으로 사용 가능한 첫 번째 채택
    const bond3YResult  = latestValue(bond3Y_D.length  ? bond3Y_D  : bond3Y_M);
    const bond10YResult = latestValue(bond10Y_D.length ? bond10Y_D : bond10Y_M);

    // CPI YoY
    let cpiYoY: number | null = null;
    if (cpiResult.val !== null && cpiPrevResult.val !== null && cpiPrevResult.val !== 0) {
      cpiYoY = ((cpiResult.val - cpiPrevResult.val) / cpiPrevResult.val) * 100;
    }

    // GDP YoY — ECOS 항목코드 "A" 시도
    const gdpYoYRows = await ecosFetch("111Y002", "Q", yyyyq(-5), yyyyq(0), "A", 6);
    const gdpYoYResult = latestValue(gdpYoYRows);

    // ── 2단계: FRED 폴백 (ECOS 샘플키 제한 항목 보완) ───────────────────
    // GDP가 ECOS에서 null이면 FRED 한국 GDP QoQ 시리즈로 대체
    // NAEXKP01KRQ657S: 한국 실질GDP 전기대비 성장률 (OECD, 분기, %)
    // IRLTLT01KRM156N: 한국 장기 국채수익률 10Y (OECD, 월, %)
    let finalGdpQoQ = gdpQoQResult.val;
    let finalGdpYoY = gdpYoYResult.val;
    let finalBond10Y = bond10YResult.val;
    let finalBond3Y  = bond3YResult.val;

    const needFredGdp  = finalGdpQoQ === null && finalGdpYoY === null;
    const needFredBond = finalBond10Y === null;

    if (needFredGdp || needFredBond) {
      const [fredGdpQoQ, fredBond10Y] = await Promise.all([
        needFredGdp  ? fredKorFetch("NAEXKP01KRQ657S", 4) : Promise.resolve(null),
        needFredBond ? fredKorFetch("IRLTLT01KRM156N", 3) : Promise.resolve(null),
      ]);
      if (finalGdpQoQ === null) finalGdpQoQ = fredGdpQoQ;
      if (finalBond10Y === null) finalBond10Y = fredBond10Y;
      // 3년물: ECOS도 FRED도 없으면 10년물에서 약 0.4%p 차감 추정
      if (finalBond3Y === null && finalBond10Y !== null) {
        finalBond3Y = parseFloat((finalBond10Y - 0.4).toFixed(3));
      }
      if (fredGdpQoQ !== null || fredBond10Y !== null) {
        console.log("[ECOS] FRED 폴백 적용:", { fredGdpQoQ, fredBond10Y });
      }
    }

    macroCache = {
      baseRate:     baseRateResult.val,
      cpiIndex:     cpiResult.val,
      cpiYoY,
      usdKrw:       usdKrwResult.val,
      gdpQoQ:       finalGdpQoQ,
      gdpYoY:       finalGdpYoY,
      bondYield3Y:  finalBond3Y,
      bondYield10Y: finalBond10Y,
      fetchedAt:    Date.now(),
      latestPeriods: {
        baseRate: baseRateResult.time,
        cpi:      cpiResult.time,
        usdKrw:   usdKrwResult.time,
        gdp:      gdpQoQResult.time,
        bond:     bond3YResult.time || bond10YResult.time,
      },
    };

    console.log("[ECOS] 거시지표 업데이트:", JSON.stringify({
      기준금리: macroCache.baseRate,
      CPI_YoY: macroCache.cpiYoY?.toFixed(2),
      원달러: macroCache.usdKrw,
      GDP_QoQ: macroCache.gdpQoQ,
      GDP_YoY: macroCache.gdpYoY,
      국고채3Y: macroCache.bondYield3Y,
      국고채10Y: macroCache.bondYield10Y,
    }));

    return macroCache;
  } catch (err: any) {
    console.error("[ECOS] 거시지표 조회 실패:", err.message);
    return null;
  }
}

/** 캐시된 ECOS 매크로 즉시 반환 (네트워크 호출 없음) */
export function getCachedEcosMacro(): EcosMacro | null {
  return macroCache;
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

  // 금리 사이클 해석 — 기준금리 레벨 + CPI 동향 복합 판단
  const cpiPressure = macro.cpiYoY !== null && macro.cpiYoY >= 2.5;
  const rateCycle = macro.baseRate !== null
    ? macro.baseRate >= 3.5
      ? "고금리 긴축 국면"
      : macro.baseRate >= 2.5
      ? cpiPressure
        ? "금리 동결 국면 — 물가 상승 압력으로 추가 인하 여력 제한"
        : "금리 인하 사이클 진입 (물가 안정 조건부)"
      : "완화적 통화정책"
    : "";

  // 국고채 스프레드 해석 (기준금리 대비 10년)
  const bondSpread = macro.bondYield10Y !== null && macro.baseRate !== null
    ? macro.bondYield10Y - macro.baseRate
    : null;
  const bondSignal = bondSpread !== null
    ? bondSpread > 1.5 ? "✅ 장기 금리 프리미엄 정상"
    : bondSpread > 0 ? "완만한 우상향"
    : "⚠️ 장단기 역전 — 경기 불확실성"
    : "";

  const rfForWacc = macro.bondYield10Y ?? macro.baseRate;

  return `\n[🏦 한국은행 ECOS 실시간 거시경제 지표]
⚠️ 아래는 ECOS API로 실시간 조회한 데이터입니다. AI 학습 데이터 대신 이 값을 최우선으로 사용하세요.

  한국은행 기준금리: ${fmt(macro.baseRate, 2, "%")} (${period(macro.latestPeriods.baseRate)}) — ${rateCycle}
  소비자물가(CPI): ${fmt(macro.cpiIndex, 2)} (2020=100, ${period(macro.latestPeriods.cpi)}) / 전년동월비: ${fmt(macro.cpiYoY, 2, "%")} ${cpiTrend}
  원/달러 환율: ${fmt(macro.usdKrw, 0, "원")} (${period(macro.latestPeriods.usdKrw)})
  실질GDP 성장률: 전기대비 ${fmt(macro.gdpQoQ, 1, "%")} / 전년동기비 ${fmt(macro.gdpYoY, 1, "%")} (${period(macro.latestPeriods.gdp)})
  국고채 금리: 3년 ${fmt(macro.bondYield3Y, 2, "%")} / 10년 ${fmt(macro.bondYield10Y, 2, "%")} (${period(macro.latestPeriods.bond)}) ${bondSignal}

→ WACC 무위험수익률(Rf): 국고채 10년 ${fmt(macro.bondYield10Y, 2, "%")} 기준으로 설정${rfForWacc !== macro.bondYield10Y ? ` (또는 기준금리 ${fmt(macro.baseRate, 2, "%")})` : ""}
→ 환율 ${fmt(macro.usdKrw, 0, "원")} 기준으로 달러 표시 수익/비용 환산
→ 금리 사이클 "${rateCycle}" 반영하여 할인율 및 밸류에이션 배수 조정`;
}

/** 한국은행 기준금리 월별 시계열 (최대 60개월) — 지표 히스토리 차트용 */
export async function fetchECOSBaseRateHistory(): Promise<Array<{ date: string; value: number }>> {
  const key = getApiKey();
  if (!key) return [];
  // 5년치 요청 (YoY 계산 여유 포함)
  const start = new Date();
  start.setFullYear(start.getFullYear() - 5);
  const startYYYYMM = `${start.getFullYear()}${String(start.getMonth() + 1).padStart(2, "0")}`;
  const endYYYYMM   = yyyymm(0);
  const rows = await ecosFetch("722Y001", "M", startYYYYMM, endYYYYMM, "0101000", 65);
  return rows
    .map(r => {
      const val = parseFloat(r.DATA_VALUE);
      if (isNaN(val)) return null;
      // TIME 형식: "202501" → "2025-01-01"
      const t = r.TIME.trim();
      const date = t.length === 6
        ? `${t.slice(0, 4)}-${t.slice(4, 6)}-01`
        : t;
      return { date, value: val };
    })
    .filter((x): x is { date: string; value: number } => x !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

// 서버 시작 시 프리로드
fetchECOSMacro().catch(() => {});

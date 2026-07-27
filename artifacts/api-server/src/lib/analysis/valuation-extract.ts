/**
 * valuation-extract.ts — 분석 본문에서 밸류에이션·실적전망 수치를 뽑아낸다.
 *
 * AI는 relative_valuation 단계 끝에 두 개의 JSON 블록을 내보낸다:
 *   FINAL_VALUATION_DATA:{"current":8080,"bear":12000,"base":18000,...}
 *   SEGMENT_FORECAST_DATA:{"currency":"KRW","segments":[{"name":"...","rev26":420,...}]}
 *
 * 예전에는 앞 블록의 base 하나만 목표주가로 옮기고 나머지를 버렸다.
 * 이 모듈은 그 값들을 구조화된 형태로 바꿔 저장할 수 있게 한다.
 *
 * 파싱은 반드시 실패에 관대해야 한다 — LLM 출력이라 필드가 빠지거나 형식이
 * 흔들릴 수 있고, 여기서 예외가 나면 분석 전체가 멈춘다.
 */

import { extractFvdJson, extractJsonSafe } from "./json-repair.js";

export interface ValuationSnapshot {
  currentPrice: number | null;
  bear: number | null;
  base: number | null;
  bull: number | null;
  absModel: string | null;
  absBear: number | null;
  absBase: number | null;
  absBull: number | null;
  relBear: number | null;
  relBase: number | null;
  relBull: number | null;
}

export interface SegmentForecastRow {
  segmentName: string;
  currency: string;
  fiscalYear: number;
  revenue: number | null;
  operatingIncome: number | null;
}

/** 숫자로 쓸 수 있는 값만 통과시킨다. "12,000원" 같은 표기도 받아준다. */
function num(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const cleaned = v.replace(/[^0-9.\-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === ".") return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * FINAL_VALUATION_DATA 블록을 뽑는다. 블록이 없거나 숫자가 하나도 없으면 null.
 * (목표가가 전혀 없는 스냅샷은 저장해봐야 쓸 데가 없다.)
 */
export function extractValuation(content: string): ValuationSnapshot | null {
  const fvd = extractFvdJson(content);
  if (!fvd) return null;

  const snap: ValuationSnapshot = {
    currentPrice: num(fvd.current),
    bear: num(fvd.bear),
    base: num(fvd.base ?? fvd.target ?? fvd.target_price),
    bull: num(fvd.bull),
    absModel: typeof fvd.abs_model === "string" ? fvd.abs_model.slice(0, 120) : null,
    absBear: num(fvd.abs_bear),
    absBase: num(fvd.abs_base),
    absBull: num(fvd.abs_bull),
    relBear: num(fvd.rel_bear),
    relBase: num(fvd.rel_base),
    relBull: num(fvd.rel_bull),
  };

  const hasAnyPrice = [snap.bear, snap.base, snap.bull, snap.absBase, snap.relBase]
    .some((v) => v != null);
  return hasAnyPrice ? snap : null;
}

/** `rev26` → 2026, `op27` → 2027. 두 자리 연도만 쓰므로 2000년대로 해석한다. */
function yearFromKey(key: string): number | null {
  const m = key.match(/^(rev|op)(\d{2})$/);
  if (!m) return null;
  return 2000 + parseInt(m[2], 10);
}

/**
 * SEGMENT_FORECAST_DATA 블록을 연도별 행으로 펼친다.
 * `{name, rev26, rev27, op26, op27}` → 부문×연도 조합마다 한 행.
 * 매출·영업이익이 둘 다 없는 조합은 버린다.
 */
/**
 * 부문 이름을 표준형으로 다듬는다.
 *
 * AI가 같은 사업부를 분석마다 다르게 적는다. 한화시스템에서 실제로 이렇게 갈렸다.
 *   "ICT 서비스"  (4건)  vs  "ICT 서비스 사업부"  (1건)
 *   "방산전자"    (4건)  vs  "방산전자 사업부"    (1건)
 *
 * 이러면 연도·부문별 정본을 고를 때 같은 부문이 둘로 남아, 저장된 전망을 그대로
 * 갖다 쓸 수가 없다. 뜻이 같은 꼬리말만 떼어낸다 — 이름 자체를 바꾸지는 않는다.
 */
export function normalizeSegmentName(raw: string): string {
  return raw
    .trim()
    .replace(/[()（）]\s*$/, "")
    .replace(/\s*(사업\s*부문|사업부|사업\s*본부|부문|BU|Division|Segment)\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 200);
}

export function extractSegmentForecasts(content: string): SegmentForecastRow[] {
  const key = "SEGMENT_FORECAST_DATA";
  const idx = content.indexOf(key);
  if (idx === -1) return [];

  const parsed = extractJsonSafe(content.slice(idx + key.length));
  const segments = parsed?.segments;
  if (!Array.isArray(segments)) return [];

  const currency = typeof parsed.currency === "string" ? parsed.currency : "KRW";
  const rows: SegmentForecastRow[] = [];

  for (const seg of segments) {
    if (!seg || typeof seg !== "object") continue;
    const name = normalizeSegmentName(typeof seg.name === "string" ? seg.name : "");
    if (!name) continue;

    // 부문 하나에서 등장하는 연도를 모두 모은 뒤 조합별로 행을 만든다.
    const years = new Set<number>();
    for (const k of Object.keys(seg)) {
      const y = yearFromKey(k);
      if (y != null) years.add(y);
    }

    for (const year of [...years].sort()) {
      const yy = String(year).slice(2);
      const revenue = num(seg[`rev${yy}`]);
      const operatingIncome = num(seg[`op${yy}`]);
      if (revenue == null && operatingIncome == null) continue;
      rows.push({ segmentName: name, currency, fiscalYear: year, revenue, operatingIncome });
    }
  }

  return rows;
}

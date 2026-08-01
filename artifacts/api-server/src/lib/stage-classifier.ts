/**
 * stage-classifier.ts — 사업 국면(라이프사이클)을 **코드가** 판정한다.
 *
 * 애빛다의 핵심 질문: "시장의 기대가 실체(펀더멘털)를 앞섰나, 실체가 기대를 넘었나."
 * 한 줄(곡선)로는 답이 안 나온다 — 두 축이 필요하다.
 *
 *   실체(펀더멘털) 축 = 매출성장·OPM추세·CapEx방향·가동률·인력·CCC·부문 신규/소멸
 *   기대(시장)   축 = PER/PBR이 업종 밴드에서 어느 분위인가 (프리미엄 vs 할인)
 *
 * 두 축의 조합이 국면을 만든다(국면 지도의 6칸 + 턴어라운드):
 *
 *   실체 \ 기대 |   할인          |   프리미엄
 *   ───────────┼────────────────┼──────────────────
 *   강함        | ② 실체 확인     | ③ 숫자 싸움
 *   둔화        | ⑤ 성장→가치     | ④ 피크아웃 전조
 *   역성장      | 🔻 쇠퇴          | ① 기대 선반영(거품)
 *   반등        | 🔄 턴어라운드    | 🔄 턴어라운드
 *
 * ①을 "거품 위험" 자리에 둔 것이 고도화의 핵심이다 — "기대만 급등"은 실체 없이
 * 프리미엄만 붙은 상태이므로 라이프사이클의 시작이 아니라 경계 신호다.
 *
 * DB·네트워크를 모르는 순수 함수만 둔다. 수집·주입은 호출부(pipeline)가 한다.
 * 가중치는 실측으로 조정할 수 있도록 상수로 모아 둔다.
 */

export type Phase =
  | "hype"        // ① 기대 선반영 — 실체 없는 프리미엄(거품 위험)
  | "proving"     // ② 실체 확인 — 저평가가 증명되는 구간
  | "numbers"     // ③ 숫자 싸움 — 실체가 프리미엄을 정당화
  | "peakout"     // ④ 피크아웃 전조 — 기대가 실체를 추월
  | "value"       // ⑤ 성장→가치 — 성장 멈추고 재평가
  | "decline"     // 🔻 쇠퇴 — 실체·기대 동반 하락
  | "turnaround"; // 🔄 턴어라운드 — 실체 반등

export interface PhaseMeta {
  phase: Phase;
  /** 사용자 모델의 단계 번호(1~5). 쇠퇴·턴어라운드는 없음 */
  stageNumber: number | null;
  labelKo: string;
  tagline: string;
}

const META: Record<Phase, PhaseMeta> = {
  hype:       { phase: "hype",       stageNumber: 1, labelKo: "기대 선반영", tagline: "실체 없는 주가 프리미엄 — 거품 위험" },
  proving:    { phase: "proving",    stageNumber: 2, labelKo: "실체 확인",   tagline: "저평가가 증명되는 구간" },
  numbers:    { phase: "numbers",    stageNumber: 3, labelKo: "숫자 싸움",   tagline: "실체가 프리미엄을 정당화" },
  peakout:    { phase: "peakout",    stageNumber: 4, labelKo: "피크아웃 전조", tagline: "기대가 실체를 추월" },
  value:      { phase: "value",      stageNumber: 5, labelKo: "성장→가치",   tagline: "성장 멈추고 재평가" },
  decline:    { phase: "decline",    stageNumber: null, labelKo: "쇠퇴",     tagline: "실체·기대 동반 하락" },
  turnaround: { phase: "turnaround", stageNumber: null, labelKo: "턴어라운드", tagline: "실체가 바닥에서 반등" },
};

export function phaseMeta(p: Phase): PhaseMeta {
  return META[p];
}

// ─── 입력 신호 ────────────────────────────────────────────────────────────────

/** 각 신호는 없을 수 있다(null). 없는 신호는 채점에서 빠지고 근거에 명시된다. */
export interface StageSignals {
  /** 매출성장률(%) — 최근 확정 기준 */
  revGrowthPct?: number | null;
  /** OPM 추세(최근 − 직전, %p). 양수면 마진 개선 */
  opmDeltaPp?: number | null;
  /** CapEx 방향 */
  capexTrend?: "expanding" | "flat" | "cutting" | null;
  /** 가동률 변화(%p) */
  utilizationDeltaPp?: number | null;
  /** 임직원 증감률(%) */
  headcountGrowthPct?: number | null;
  /** CCC 변화(일). 음수면 운전자본 개선 */
  cccDeltaDays?: number | null;
  /** 이번 기 새로 등장한 사업부문 수 */
  segmentsAdded?: number | null;
  /** 이번 기 사라진 사업부문 수 */
  segmentsDropped?: number | null;
  /** PER/PBR의 업종 밴드 분위(0~100). 높을수록 프리미엄 */
  valuationPercentile?: number | null;
  /** 직전 기 실체 점수 — 궤적/턴어라운드 감지용 */
  priorSubstanceScore?: number | null;
}

// ─── 가중치 (실측으로 조정) ───────────────────────────────────────────────────

const W = {
  strong: 30,      // 실체 "강함" 문턱
  contracting: -15, // 실체 "역성장" 문턱
  rebound: 20,      // 직전 대비 이만큼 개선되면 반등으로 본다
  premium: 55,      // 밴드 분위 이상이면 프리미엄
} as const;

// ─── 실체 채점 ────────────────────────────────────────────────────────────────

export interface SubstanceResult {
  score: number; // -100 ~ +100
  state: "strong" | "slowing" | "contracting" | "rebounding";
  reasons: string[];
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * 실체 신호들을 하나의 점수(-100~+100)와 상태로 모은다.
 * 각 신호가 왜 점수에 기여했는지 reasons에 남긴다(조용한 판정 금지).
 */
export function scoreSubstance(s: StageSignals): SubstanceResult {
  let score = 0;
  const reasons: string[] = [];
  const add = (pts: number, why: string) => { score += pts; reasons.push(`${pts >= 0 ? "+" : ""}${pts} ${why}`); };

  if (s.revGrowthPct != null) {
    const g = s.revGrowthPct;
    if (g >= 20) add(25, `매출성장 ${g.toFixed(0)}%`);
    else if (g >= 10) add(12, `매출성장 ${g.toFixed(0)}%`);
    else if (g >= 0) add(3, `매출성장 ${g.toFixed(0)}%`);
    else if (g >= -15) add(-18, `매출역성장 ${g.toFixed(0)}%`);
    else add(-30, `매출급감 ${g.toFixed(0)}%`);
  }
  if (s.opmDeltaPp != null) {
    // 문턱 하나로 ±15을 몰아주면 −2.1%p 같은 경계값이 판정을 통째로 뒤집는다(칼날).
    // 완만하게 나눠 한 지표가 국면을 좌우하지 못하게 한다.
    const d = s.opmDeltaPp;
    if (d >= 3) add(15, `마진개선 ${d.toFixed(1)}%p`);
    else if (d >= 1) add(7, `마진개선 ${d.toFixed(1)}%p`);
    else if (d <= -3) add(-15, `마진악화 ${d.toFixed(1)}%p`);
    else if (d <= -1) add(-8, `마진악화 ${d.toFixed(1)}%p`);
  }
  if (s.capexTrend === "expanding") add(12, "설비투자 확대");
  else if (s.capexTrend === "cutting") add(-8, "설비투자 축소");
  if (s.utilizationDeltaPp != null) {
    if (s.utilizationDeltaPp >= 3) add(8, `가동률 상승 ${s.utilizationDeltaPp.toFixed(0)}%p`);
    else if (s.utilizationDeltaPp <= -3) add(-8, `가동률 하락 ${s.utilizationDeltaPp.toFixed(0)}%p`);
  }
  if (s.headcountGrowthPct != null) {
    if (s.headcountGrowthPct >= 5) add(8, `인력 확장 ${s.headcountGrowthPct.toFixed(0)}%`);
    else if (s.headcountGrowthPct <= -3) add(-10, `인력 감축 ${s.headcountGrowthPct.toFixed(0)}%`);
  }
  if (s.cccDeltaDays != null) {
    if (s.cccDeltaDays <= -10) add(8, `운전자본 개선 ${s.cccDeltaDays.toFixed(0)}일`);
    else if (s.cccDeltaDays >= 15) add(-8, `운전자본 악화 +${s.cccDeltaDays.toFixed(0)}일`);
  }
  const dropped = s.segmentsDropped ?? 0, added = s.segmentsAdded ?? 0;
  if (dropped > added) add(-8, `사업부문 ${dropped}개 소멸`);
  else if (added > dropped) add(6, `사업부문 ${added}개 신규`);

  score = clamp(score, -100, 100);

  // 상태 판정 — 반등은 "직전이 바닥이었는데 이번에 크게 올라온 것"
  let state: SubstanceResult["state"];
  const prior = s.priorSubstanceScore;
  if (prior != null && prior <= W.contracting && score - prior >= W.rebound && score > W.contracting) {
    state = "rebounding";
    reasons.push(`직전 ${prior} → 이번 ${score}: 바닥 반등`);
  } else if (score >= W.strong) state = "strong";
  else if (score <= W.contracting) state = "contracting";
  else state = "slowing";

  return { score, state, reasons };
}

// ─── 국면 판정 (2축 매트릭스) ─────────────────────────────────────────────────

export interface StageVerdict {
  phase: Phase;
  meta: PhaseMeta;
  substance: SubstanceResult;
  /** 기대 상태 */
  expectation: "premium" | "discount" | "unknown";
  /** 판정의 신뢰도 — 채워진 신호 비율 기반 */
  confidence: "high" | "medium" | "low";
  reasons: string[];
}

const SIGNAL_KEYS: Array<keyof StageSignals> = [
  "revGrowthPct", "opmDeltaPp", "capexTrend", "utilizationDeltaPp",
  "headcountGrowthPct", "cccDeltaDays", "valuationPercentile",
];

/** 두 축을 조합해 국면을 판정한다. */
export function classifyStage(s: StageSignals): StageVerdict {
  const substance = scoreSubstance(s);

  const pct = s.valuationPercentile;
  const expectation: StageVerdict["expectation"] =
    pct == null ? "unknown" : pct >= W.premium ? "premium" : "discount";
  // 기대를 모르면 실체만으로 근사한다(강함=프리미엄 취급하지 않고 보수적으로 할인 취급)
  const premium = expectation === "premium";

  let phase: Phase;
  if (substance.state === "rebounding") phase = "turnaround";
  else if (substance.state === "strong") phase = premium ? "numbers" : "proving";
  else if (substance.state === "slowing") phase = premium ? "peakout" : "value";
  else /* contracting */ phase = premium ? "hype" : "decline";

  const filled = SIGNAL_KEYS.filter(k => s[k] != null).length;
  const confidence = filled >= 5 ? "high" : filled >= 3 ? "medium" : "low";

  const reasons = [
    `실체 ${substance.state} (점수 ${substance.score})`,
    `기대 ${expectation === "unknown" ? "미상(밴드 없음)" : expectation}${pct != null ? ` (밴드 ${pct}분위)` : ""}`,
    ...substance.reasons,
  ];

  return { phase, meta: META[phase], substance, expectation, confidence, reasons };
}

// ─── 신호 계산 헬퍼 (순수) ────────────────────────────────────────────────────

/** 최근값의 전기 대비 변화율(%). 둘 중 하나라도 없거나 분모 0이면 null */
export function pctChange(latest: number | null | undefined, prev: number | null | undefined): number | null {
  if (latest == null || prev == null || prev === 0) return null;
  return ((latest - prev) / Math.abs(prev)) * 100;
}

/** 시리즈(오래된→최신)의 마지막 두 값으로 CapEx 방향을 판정한다. */
export function capexTrendOf(series: Array<number | null>): "expanding" | "flat" | "cutting" | null {
  const vals = series.filter((v): v is number => v != null);
  if (vals.length < 2) return null;
  const prev = vals[vals.length - 2], latest = vals[vals.length - 1];
  if (prev <= 0) return null;
  if (latest >= prev * 1.15) return "expanding";
  if (latest <= prev * 0.85) return "cutting";
  return "flat";
}

/**
 * 값이 업종 밴드(p25·p50·p75)에서 몇 분위인지 근사한다(0~100).
 * 프리미엄/할인 축의 재료다. 밴드가 없으면 null.
 */
export function percentileAgainst(
  value: number | null | undefined,
  band: { p25: number | null; p50: number | null; p75: number | null } | null | undefined,
): number | null {
  if (value == null || value <= 0 || !band) return null;
  const { p25, p50, p75 } = band;
  if (p25 == null || p50 == null || p75 == null) return null;
  const lerp = (v: number, lo: number, hi: number, plo: number, phi: number) =>
    hi <= lo ? (plo + phi) / 2 : plo + ((v - lo) / (hi - lo)) * (phi - plo);
  if (value <= p25) return Math.max(2, lerp(value, 0, p25, 0, 25));
  if (value <= p50) return lerp(value, p25, p50, 25, 50);
  if (value <= p75) return lerp(value, p50, p75, 50, 75);
  return Math.min(98, lerp(value, p75, p75 * 2, 75, 95));
}

/** PER·PBR 분위를 평균해 하나의 기대 분위로 합친다(있는 것만). */
export function expectationPercentile(perPct: number | null, pbrPct: number | null): number | null {
  const xs = [perPct, pbrPct].filter((x): x is number => x != null);
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

// ─── 프롬프트 블록 ────────────────────────────────────────────────────────────

const PHASE_ICON: Record<Phase, string> = {
  hype: "①", proving: "②", numbers: "③", peakout: "④", value: "⑤", decline: "🔻", turnaround: "🔄",
};

/**
 * 국면 판정을 프롬프트 블록으로 만든다. **AI에게 판정을 맡기지 않고, 서버 판정을
 * 근거와 함께 준 뒤 "지지/반박할 정황을 사업보고서에서 찾으라"고 지시한다.**
 */
export function renderStageVerdict(v: StageVerdict): string {
  const confKo = { high: "높음", medium: "보통", low: "낮음(신호 부족)" }[v.confidence];
  return [
    "",
    "[🧭 사업 국면 판정 — 서버가 실측 신호로 계산]",
    `· 현재 국면: ${PHASE_ICON[v.phase]} ${v.meta.labelKo} — ${v.meta.tagline}`,
    `· 실체(펀더멘털): ${v.substance.state} (점수 ${v.substance.score}/100)`,
    `· 기대(시장): ${v.expectation === "unknown" ? "밴드 없음" : v.expectation}`,
    `· 판정 신뢰도: ${confKo}`,
    `· 근거 신호: ${v.substance.reasons.join(", ") || "없음"}`,
    "",
    "⚠️ 이 국면은 서버가 계산한 것입니다. 본문에서 이 판정을 **지지하거나 반박하는 정황**을",
    "   사업보고서 원문(경영진 언어·투자 계획·신사업·리스크)에서 찾아 설명하세요.",
    "   원문 근거가 다른 국면을 가리키면 다른 판정을 제시하되, **무엇을 보고 그렇게 봤는지** 밝히세요.",
  ].join("\n");
}

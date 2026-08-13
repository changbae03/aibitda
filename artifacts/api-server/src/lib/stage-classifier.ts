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

/**
 * 주식 관점에서 기업이 놓이는 자리. **투자자가 실제로 쓰는 말**로 나눈다 —
 * 같은 "성장"이라도 밸류에이션을 안 보고 속도만 보는 구간(폭발 성장)과, 높은 눈높이를
 * 매분기 증명해야 하는 구간(숫자 싸움)은 투자 판단이 전혀 다르다.
 */
export type Phase =
  | "hypergrowth" // 🚀 폭발 성장 — 성장 속도가 전부인 구간(밸류에이션은 뒷전)
  | "numbers"     // 📈 숫자 싸움 — 실적이 높은 기대를 매번 증명해야 유지
  | "proving"     // 🔍 실체 확인 — 실적은 좋은데 시장이 아직 안 알아줌(저평가)
  | "turnaround"  // 🔄 턴어라운드 — 바닥 찍고 실적이 돌아서는 중
  | "waiting"     // ⏳ 증명 대기 — 기대는 붙었고 숫자는 아직. 다음 실적이 가른다
  | "peakout"     // ⚠️ 피크아웃 전조 — 정점을 지나 성장이 식는데 기대는 남아 있음
  | "value"       // 🏦 성숙·가치 — 성장은 멈췄고 기대도 낮다. 이익·배당으로 보는 구간
  | "hype"        // 🫧 기대 선반영 — 실적은 뒷걸음인데 주가에 기대만 붙음(거품 경계)
  | "decline";    // 🔻 쇠퇴 — 실적도 기대도 함께 내려감

export interface PhaseMeta {
  phase: Phase;
  /** 성장 사이클 상의 순번(1~5). 턴어라운드·쇠퇴는 사이클 밖이라 null */
  stageNumber: number | null;
  labelKo: string;
  tagline: string;
  /** 이 단계에서 **무엇을 봐야 하는가** — 판정보다 이게 실제로 쓸모 있다 */
  watchKo: string;
}

const META: Record<Phase, PhaseMeta> = {
  hypergrowth: { phase: "hypergrowth", stageNumber: 3, labelKo: "폭발 성장",
    tagline: "성장 속도가 전부인 구간 — 밸류에이션은 뒷전",
    watchKo: "성장률이 꺾이는 첫 신호. 이 구간은 속도가 멈추는 순간 평가가 통째로 바뀝니다" },
  numbers:     { phase: "numbers",     stageNumber: 3, labelKo: "숫자 싸움",
    tagline: "실적이 높은 눈높이를 매번 증명해야 유지",
    watchKo: "다음 실적이 시장 기대를 넘는지. 눈높이가 이미 높아 '잘 나와도' 부족할 수 있습니다" },
  proving:     { phase: "proving",     stageNumber: 2, labelKo: "실체 확인",
    tagline: "실적은 좋은데 시장이 아직 안 알아줌",
    watchKo: "저평가가 해소될 계기(실적 발표·수주·정책). 계기가 없으면 오래 방치되기도 합니다" },
  turnaround:  { phase: "turnaround",  stageNumber: null, labelKo: "턴어라운드",
    tagline: "바닥 찍고 실적이 돌아서는 중",
    watchKo: "반등이 이어지는지. 한 분기 반짝인지, 다음 분기도 이어지는지가 갈림길입니다" },
  waiting:     { phase: "waiting",     stageNumber: 2, labelKo: "증명 대기",
    tagline: "기대는 붙었고 숫자는 아직 — 다음 실적이 가른다",
    watchKo: "기대의 근거가 숫자로 나오는 시점. 증명되면 재평가, 밀리면 실망이 큽니다" },
  peakout:     { phase: "peakout",     stageNumber: 4, labelKo: "피크아웃 전조",
    tagline: "정점을 지나 성장이 식는데 기대는 남아 있음",
    watchKo: "성장 둔화가 일시적인지 추세인지. 기대가 먼저 빠지면 낙폭이 큽니다" },
  value:       { phase: "value",       stageNumber: 5, labelKo: "성숙·가치",
    tagline: "성장은 멈췄고 기대도 낮다 — 이익·배당으로 보는 구간",
    watchKo: "이익의 안정성과 주주환원(배당·자사주). 성장 재점화 재료가 있는지도" },
  hype:        { phase: "hype",        stageNumber: 1, labelKo: "기대 선반영",
    tagline: "실적은 뒷걸음인데 주가에 기대만 붙음",
    watchKo: "기대가 실체로 바뀌는 증거. 없으면 되돌림이 빠릅니다 — 거품을 경계할 자리" },
  decline:     { phase: "decline",     stageNumber: null, labelKo: "쇠퇴",
    tagline: "실적도 기대도 함께 내려감",
    watchKo: "바닥의 신호(구조조정·사업 재편·적자 축소). 반등 근거 없이 싸다는 이유만으론 부족합니다" },
};

/** 화면에 단계 지도를 그릴 때 쓰는 순서 — 좋은 자리부터 나쁜 자리로 */
export const PHASE_ORDER: Phase[] = [
  "hypergrowth", "numbers", "proving", "turnaround",
  "waiting", "peakout", "value", "hype", "decline",
];

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

  // ── 최신 확정 분기 YoY (전년 동기 대비) ────────────────────────────────────
  // 연간만 보면 턴어라운드를 1년 늦게 안다. 동양파일은 FY2025가 적자(−47억)라
  // "쇠퇴"로 판정됐지만, 2026 1분기에 이미 흑자(+10억)로 돌아서 있었다.
  // 계절성을 피하려 직전 분기가 아니라 **전년 같은 분기**와 비교한다.
  /** 최신 분기 매출 YoY(%) */
  recentQuarterRevGrowthPct?: number | null;
  /** 최신 분기 OPM YoY 변화(%p) */
  recentQuarterOpmDeltaPp?: number | null;
  /**
   * 최신 분기 영업이익률 **수준**(%). 채점에는 쓰지 않고 화면(여정 그래프)이 쓴다 —
   * 변화폭(%p)만으로는 "적자에서 흑자로 넘어왔다"를 그릴 수 없다.
   */
  recentQuarterOpmPct?: number | null;
  /** 전년 동기 적자 → 이번 분기 흑자 */
  recentQuarterSwungToProfit?: boolean | null;

  /**
   * 임상단계 바이오인가 — **제조업 잣대가 통하지 않는 회사**.
   *
   * 메디포스트가 "쇠퇴"로 나왔다. 근거는 마진악화 −2.9%p와 최근 분기 마진 급악화였는데,
   * 바이오는 임상을 돌릴수록 마진이 나빠지는 게 정상이다. 인력 확장 6%도 감점이 아니라
   * 연구인력 채용이다. 매출·마진으로 재면 **임상에 돈을 쓸수록 쇠퇴로 읽힌다.**
   */
  isClinicalBio?: boolean | null;
}

// ─── 가중치 (실측으로 조정) ───────────────────────────────────────────────────

const W = {
  strong: 30,      // 실체 "강함" 문턱
  contracting: -15, // 실체 "역성장" 문턱
  rebound: 20,      // 직전 대비 이만큼 개선되면 반등으로 본다
  // 기대(밸류) 축은 **셋으로** 나눈다. 예전엔 55 하나로 갈라서, 분위 55.6이 문턱을
  // 0.6 넘었다는 이유로 "거품(hype)"이 되고 54.9면 "쇠퇴(decline)"가 됐다 —
  // 판정이 소수점에 뒤집히는 칼날이었다(메디포스트: PBR 1.55, 섹터 중앙값 1.18).
  // 중앙값 언저리는 "평범한 밸류"이지 프리미엄이 아니다.
  premium: 60,      // 이 이상이라야 진짜 프리미엄
  discount: 40,     // 이 이하라야 진짜 저평가. 사이는 중립
  hyper: 40,        // 매출 성장률이 이 이상이면 '폭발 성장'(밸류에이션보다 속도)
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
    // 초고성장(40%+)은 20%대 성장과 다른 신호다 — 상한을 하나 더 둬서 마진·운전자본
    // 감점 하나에 "둔화"로 눌리지 않게 한다(NVDA 매출 +65%가 피크아웃으로 오분류되던 사례).
    if (g >= 40) add(35, `초고성장 ${g.toFixed(0)}%`);
    else if (g >= 20) add(25, `매출성장 ${g.toFixed(0)}%`);
    else if (g >= 10) add(12, `매출성장 ${g.toFixed(0)}%`);
    else if (g >= 0) add(3, `매출성장 ${g.toFixed(0)}%`);
    else if (g >= -15) add(-18, `매출역성장 ${g.toFixed(0)}%`);
    else add(-30, `매출급감 ${g.toFixed(0)}%`);
  }
  // 임상 바이오는 마진 악화를 감점하지 않는다 — 그게 곧 사업(임상 투자)이기 때문이다.
  // 대신 매출이 실제로 꺾이는지(제품·기술료)와 반등 여부만 본다.
  const bio = s.isClinicalBio === true;
  if (bio) reasons.push("임상단계 바이오 — 마진 대신 매출·현금 흐름으로 판단");

  if (!bio && s.opmDeltaPp != null) {
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
    // 음수 = 현금전환주기가 짧아진 것(개선). "개선 −336일"은 읽기 헷갈려 단축/증가로 쓴다.
    if (s.cccDeltaDays <= -10) add(8, `운전자본 ${Math.abs(s.cccDeltaDays).toFixed(0)}일 단축`);
    else if (s.cccDeltaDays >= 15) add(-8, `운전자본 ${s.cccDeltaDays.toFixed(0)}일 증가`);
  }
  const dropped = s.segmentsDropped ?? 0, added = s.segmentsAdded ?? 0;
  if (dropped > added) add(-8, `사업부문 ${dropped}개 소멸`);
  else if (added > dropped) add(6, `사업부문 ${added}개 신규`);

  // 최신 확정 분기(YoY) — 연간보다 신선한 신호. 연간이 아직 적자여도 분기가 먼저 돌아선다.
  if (s.recentQuarterSwungToProfit) add(20, "최근 분기 흑자전환(YoY)");
  if (!bio && s.recentQuarterOpmDeltaPp != null) {
    const d = s.recentQuarterOpmDeltaPp;
    if (d >= 10) add(12, `최근 분기 마진 급개선 ${d.toFixed(0)}%p(YoY)`);
    else if (d >= 3) add(6, `최근 분기 마진개선 ${d.toFixed(1)}%p(YoY)`);
    else if (d <= -10) add(-12, `최근 분기 마진 급악화 ${d.toFixed(0)}%p(YoY)`);
    else if (d <= -3) add(-6, `최근 분기 마진악화 ${d.toFixed(1)}%p(YoY)`);
  }
  if (s.recentQuarterRevGrowthPct != null) {
    const g = s.recentQuarterRevGrowthPct;
    if (g >= 20) add(12, `최근 분기 매출 ${g.toFixed(0)}%(YoY)`);
    else if (g >= 5) add(6, `최근 분기 매출 ${g.toFixed(0)}%(YoY)`);
    else if (g <= -20) add(-12, `최근 분기 매출 ${g.toFixed(0)}%(YoY)`);
  }

  score = clamp(score, -100, 100);

  // 상태 판정 — 반등은 "직전이 바닥이었는데 이번에 크게 올라온 것"
  //
  // 연간 실적이 아직 나쁜데 **최신 분기가 먼저 돌아선** 경우도 반등이다. 연간만 보면
  // 턴어라운드를 1년 늦게 알게 된다(동양파일: FY2025 적자 → 2026 Q1 흑자전환).
  const annualWeak = (s.revGrowthPct ?? 0) < 5 || (s.opmDeltaPp ?? 0) < 0;
  const quarterTurned = !!s.recentQuarterSwungToProfit
    || (s.recentQuarterOpmDeltaPp != null && s.recentQuarterOpmDeltaPp >= 10);

  let state: SubstanceResult["state"];
  const prior = s.priorSubstanceScore;
  if (quarterTurned && annualWeak) {
    state = "rebounding";
    reasons.push("연간은 부진하나 최신 확정 분기가 먼저 반등");
  } else if (prior != null && prior <= W.contracting && score - prior >= W.rebound && score > W.contracting) {
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
  /** 기대 상태. 중앙값 언저리는 "중립" — 프리미엄도 저평가도 아니다 */
  expectation: "premium" | "neutral" | "discount" | "unknown";
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
    pct == null ? "unknown"
      : pct >= W.premium ? "premium"
      : pct <= W.discount ? "discount"
      : "neutral";
  // 국면을 가를 때 중립은 **저평가 쪽**으로 둔다. "기대 선반영(거품)"·"피크아웃"은
  // 시장이 실제로 비싸게 볼 때만 붙어야 하는 이름이고, 평범한 밸류에 그 딱지를 붙이면
  // 판정이 과해진다. 기대를 모를 때(unknown)도 같은 이유로 보수적으로 본다.
  const premium = expectation === "premium";

  // 폭발 성장: 매출이 연간이든 최신 분기든 40% 이상 뛰는 구간. 투자자는 이때
  // 밸류에이션을 뒤로 미루고 성장 속도만 본다 — "숫자 싸움"과는 판단 기준이 다르다.
  const hyper = (s.revGrowthPct ?? 0) >= W.hyper || (s.recentQuarterRevGrowthPct ?? 0) >= W.hyper;

  // 증명 대기 vs 피크아웃: 둘 다 "기대는 높은데 실체는 아직"이지만 방향이 반대다.
  // 직전보다 나아지는 중이면 아직 증명 전(대기), 나빠지는 중이면 정점을 지난 것(피크아웃).
  const improving = s.priorSubstanceScore != null && substance.score > s.priorSubstanceScore;

  let phase: Phase;
  if (substance.state === "rebounding") phase = "turnaround";
  else if (substance.state === "strong") phase = hyper ? "hypergrowth" : premium ? "numbers" : "proving";
  else if (substance.state === "slowing") phase = premium ? (improving ? "waiting" : "peakout") : "value";
  else /* contracting */ phase = premium ? "hype" : "decline";

  const filled = SIGNAL_KEYS.filter(k => s[k] != null).length;
  const confidence = filled >= 5 ? "high" : filled >= 3 ? "medium" : "low";

  const reasons = [
    `실체 ${substance.state} (점수 ${substance.score})`,
    `기대 ${({ premium: "프리미엄", neutral: "중립", discount: "저평가", unknown: "미상(밴드 없음)" } as const)[expectation]}${pct != null ? ` (밴드 ${pct.toFixed(0)}분위)` : ""}`,
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
  hypergrowth: "🚀", numbers: "📈", proving: "🔍", turnaround: "🔄", waiting: "⏳",
  peakout: "⚠️", value: "🏦", hype: "🫧", decline: "🔻",
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
    `· 이 단계에서 볼 것: ${v.meta.watchKo}`,
    "",
    "⚠️ 이 국면은 서버가 계산한 것입니다. 본문에서 이 판정을 **지지하거나 반박하는 정황**을",
    "   사업보고서 원문(경영진 언어·투자 계획·신사업·리스크)에서 찾아 설명하세요.",
    "   원문 근거가 다른 국면을 가리키면 다른 판정을 제시하되, **무엇을 보고 그렇게 봤는지** 밝히세요.",
  ].join("\n");
}

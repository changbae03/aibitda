import { describe, it, expect } from "vitest";
import { classifyStage, scoreSubstance, phaseMeta } from "./stage-classifier.js";

/**
 * 국면 판정의 안전망. 실제 SK하이닉스 궤적(쇠퇴→턴어라운드→숫자싸움)을 픽스처로 고정한다.
 * 매트릭스 칸이 바뀌거나 문턱을 잘못 만지면 여기서 깨진다.
 */

describe("2축 매트릭스 — 실체 × 기대", () => {
  // 40% 이상은 '폭발 성장'으로 따로 빠지므로, 매트릭스 칸 자체를 보려면 그 아래 성장률을 쓴다.
  it("실체 강함 + 프리미엄 → 숫자 싸움(3)", () => {
    const v = classifyStage({ revGrowthPct: 25, opmDeltaPp: 4, capexTrend: "expanding", headcountGrowthPct: 7, valuationPercentile: 75 });
    expect(v.phase).toBe("numbers");
    expect(v.meta.stageNumber).toBe(3);
  });

  it("초고성장(40%+)은 마진·운전자본이 삐끗해도 둔화로 눌리지 않는다 — NVDA 회귀", () => {
    // 매출 +65%, 마진 -2%p, 운전자본 악화 → 실체는 '강함'을 유지해야 한다(둔화로 눌리면 안 됨)
    const v = classifyStage({ revGrowthPct: 65, opmDeltaPp: -2, capexTrend: "expanding", cccDeltaDays: 26, valuationPercentile: 65 });
    expect(v.substance.state).toBe("strong");
    expect(v.phase).toBe("hypergrowth"); // 40%+라 폭발 성장으로 간다
  });

  it("실체 강함 + 할인 → 실체 확인(2)", () => {
    const v = classifyStage({ revGrowthPct: 25, opmDeltaPp: 4, capexTrend: "expanding", valuationPercentile: 30 });
    expect(v.phase).toBe("proving");
    expect(v.meta.stageNumber).toBe(2);
  });

  it("실체 둔화 + 프리미엄 → 피크아웃 전조(4)", () => {
    const v = classifyStage({ revGrowthPct: 3, valuationPercentile: 80 });
    expect(v.phase).toBe("peakout");
    expect(v.meta.stageNumber).toBe(4);
  });

  it("실체 둔화 + 할인 → 성장→가치(5)", () => {
    const v = classifyStage({ revGrowthPct: 3, valuationPercentile: 25 });
    expect(v.phase).toBe("value");
    expect(v.meta.stageNumber).toBe(5);
  });

  it("실체 역성장 + 프리미엄 → 기대 선반영/거품(1)", () => {
    const v = classifyStage({ revGrowthPct: -25, opmDeltaPp: -5, valuationPercentile: 85 });
    expect(v.phase).toBe("hype");
    expect(v.meta.stageNumber).toBe(1);
  });

  it("실체 역성장 + 할인 → 쇠퇴", () => {
    const v = classifyStage({ revGrowthPct: -25, opmDeltaPp: -5, headcountGrowthPct: -5, valuationPercentile: 20 });
    expect(v.phase).toBe("decline");
  });
});

describe("투자자 언어로 나눈 단계 — 폭발 성장·증명 대기", () => {
  /**
   * 같은 "성장"이라도 판단 기준이 다르다. 매출이 40%+ 뛰는 구간에서 투자자는
   * 밸류에이션을 뒤로 미루고 속도만 본다 — "숫자 싸움"과 한 칸에 두면 안 된다.
   */
  it("매출 40%+ 고성장은 프리미엄이어도 '폭발 성장'", () => {
    const v = classifyStage({ revGrowthPct: 90, opmDeltaPp: 8, capexTrend: "expanding", valuationPercentile: 75 });
    expect(v.phase).toBe("hypergrowth");
  });

  it("저평가여도 40%+면 폭발 성장 — 속도가 먼저다", () => {
    const v = classifyStage({ revGrowthPct: 55, opmDeltaPp: 5, capexTrend: "expanding", valuationPercentile: 20 });
    expect(v.phase).toBe("hypergrowth");
  });

  it("연간은 느려도 최신 분기가 40%+면 폭발 성장으로 잡는다", () => {
    const v = classifyStage({
      revGrowthPct: 15, opmDeltaPp: 4, capexTrend: "expanding",
      recentQuarterRevGrowthPct: 62, valuationPercentile: 70,
    });
    expect(v.phase).toBe("hypergrowth");
  });

  it("20~30%대 성장은 폭발이 아니라 숫자 싸움", () => {
    const v = classifyStage({ revGrowthPct: 25, opmDeltaPp: 4, capexTrend: "expanding", valuationPercentile: 70 });
    expect(v.phase).toBe("numbers");
  });

  /**
   * 증명 대기와 피크아웃은 둘 다 "기대는 높은데 실체는 아직"이지만 방향이 반대다.
   * 나아지는 중이면 아직 증명 전, 나빠지는 중이면 정점을 지난 것.
   */
  it("기대는 높고 실체가 나아지는 중이면 '증명 대기'", () => {
    const v = classifyStage({ revGrowthPct: 8, opmDeltaPp: 1, valuationPercentile: 75, priorSubstanceScore: 5 });
    expect(v.phase).toBe("waiting");
  });

  it("기대는 높은데 실체가 나빠지는 중이면 '피크아웃 전조'", () => {
    const v = classifyStage({ revGrowthPct: 3, opmDeltaPp: -1, valuationPercentile: 75, priorSubstanceScore: 28 });
    expect(v.phase).toBe("peakout");
  });

  it("직전 점수가 없으면 증명 대기로 지레짐작하지 않는다", () => {
    const v = classifyStage({ revGrowthPct: 3, valuationPercentile: 75 });
    expect(v.phase).toBe("peakout");
  });

  it("모든 단계가 '무엇을 봐야 하나'를 갖는다", () => {
    for (const p of ["hypergrowth", "numbers", "proving", "turnaround", "waiting", "peakout", "value", "hype", "decline"] as const) {
      expect(phaseMeta(p).watchKo.length, p).toBeGreaterThan(10);
    }
  });
});

describe("턴어라운드는 궤적으로만 감지된다", () => {
  it("직전이 바닥(쇠퇴)이었다가 이번에 크게 올라오면 턴어라운드", () => {
    const v = classifyStage({ revGrowthPct: 15, opmDeltaPp: 4, capexTrend: "expanding", priorSubstanceScore: -40, valuationPercentile: 35 });
    expect(v.phase).toBe("turnaround");
  });

  it("직전 점수가 없으면 같은 신호라도 턴어라운드가 아니다 — 단순 실체확인", () => {
    // 궤적 정보 없이 반등을 지어내지 않는다
    const v = classifyStage({ revGrowthPct: 15, opmDeltaPp: 4, capexTrend: "expanding", valuationPercentile: 35 });
    expect(v.phase).not.toBe("turnaround");
  });
});

describe("최신 분기가 먼저 돌아서면 턴어라운드로 잡는다 — 동양파일 회귀", () => {
  /**
   * 연간만 보면 턴어라운드를 1년 늦게 안다. 동양파일(228340)은 FY2025가 적자(−47억)라
   * "쇠퇴"로 판정됐지만, 2026 1분기엔 이미 흑자(+10억)로 돌아서 있었다.
   * 실측: 2026 Q1 매출 157억(+32% YoY), OPM −21.8% → +6.4% (+28%p), 흑자전환.
   */
  it("연간 적자여도 최신 분기 흑자전환이면 턴어라운드", () => {
    const v = classifyStage({
      revGrowthPct: -1.2, opmDeltaPp: -0.7,          // 연간은 여전히 부진
      recentQuarterRevGrowthPct: 32, recentQuarterOpmDeltaPp: 28.2,
      recentQuarterSwungToProfit: true,
      valuationPercentile: 20,
    });
    expect(v.phase).toBe("turnaround");
  });

  it("분기 정보가 없으면 예전처럼 연간으로 판단한다 — 쇠퇴", () => {
    const v = classifyStage({ revGrowthPct: -1.2, opmDeltaPp: -0.7, valuationPercentile: 20 });
    expect(v.phase).toBe("decline");
  });

  it("최신 분기가 나빠지면 반등으로 오인하지 않는다", () => {
    const v = classifyStage({
      revGrowthPct: -1.2, opmDeltaPp: -0.7,
      recentQuarterRevGrowthPct: -25, recentQuarterOpmDeltaPp: -12,
      recentQuarterSwungToProfit: false, valuationPercentile: 20,
    });
    expect(v.phase).toBe("decline");
  });

  it("이미 흑자인 회사의 분기 개선은 턴어라운드가 아니다", () => {
    // 연간도 좋으면(성장·마진개선) 반등이 아니라 성장 국면이어야 한다
    const v = classifyStage({
      revGrowthPct: 25, opmDeltaPp: 4, capexTrend: "expanding",
      recentQuarterRevGrowthPct: 30, recentQuarterOpmDeltaPp: 5,
      recentQuarterSwungToProfit: false, valuationPercentile: 70,
    });
    expect(v.phase).toBe("numbers");
  });
});

describe("SK하이닉스 3년 궤적", () => {
  // 2023 다운사이클: 매출 급감·마진 붕괴 → 쇠퇴
  const y2023 = classifyStage({ revGrowthPct: -30, opmDeltaPp: -20, capexTrend: "cutting", headcountGrowthPct: 1, valuationPercentile: 30 });
  // 2024 반등 시작
  const y2024 = classifyStage({ revGrowthPct: 25, opmDeltaPp: 15, capexTrend: "expanding", headcountGrowthPct: 1, valuationPercentile: 45, priorSubstanceScore: y2023.substance.score });
  // 2025 실적 폭발 + 프리미엄
  const y2025 = classifyStage({ revGrowthPct: 90, opmDeltaPp: 8, capexTrend: "expanding", headcountGrowthPct: 7, cccDeltaDays: -24, valuationPercentile: 70, priorSubstanceScore: y2024.substance.score });

  it("2023은 쇠퇴", () => expect(y2023.phase).toBe("decline"));
  it("2024는 턴어라운드", () => expect(y2024.phase).toBe("turnaround"));
  // 2025는 매출 +90% — 눈높이를 증명하는 '숫자 싸움'이 아니라 속도가 전부인 '폭발 성장'이다
  it("2025는 폭발 성장", () => expect(y2025.phase).toBe("hypergrowth"));
});

describe("조용한 판정을 만들지 않는다", () => {
  it("신호가 부족하면 confidence가 낮다", () => {
    expect(classifyStage({ revGrowthPct: 10 }).confidence).toBe("low");
  });

  it("모든 기여가 근거로 남는다", () => {
    const r = scoreSubstance({ revGrowthPct: 90, capexTrend: "expanding" });
    expect(r.reasons.some(x => x.includes("성장"))).toBe(true);
    expect(r.reasons.some(x => x.includes("설비투자 확대"))).toBe(true);
  });

  it("밴드가 없으면 기대는 미상으로 남고 할인처럼 보수 판정한다", () => {
    // 40% 미만이라 폭발 성장으로 빠지지 않고, 프리미엄으로 지레짐작하지도 않는다
    const v = classifyStage({ revGrowthPct: 25, opmDeltaPp: 4, capexTrend: "expanding" });
    expect(v.expectation).toBe("unknown");
    expect(v.phase).toBe("proving");
  });
});

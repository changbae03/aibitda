import { describe, it, expect } from "vitest";
import { computeYearlyStages, detectMajorChanges, renderTrajectory, type FinYear } from "./stage-trajectory.js";

/**
 * 실제 종목의 궤적을 픽스처로 고정한다. 흐름 계산·전환점 탐지가 무너지면 여기서 깨진다.
 * NVDA형(다운→반등→고성장)과 INTC형(지속 위축·적자전환)을 대표로.
 */

// NVDA형: 2022 기준 → 2023 위축 → 2024 흑자전환·반등·급성장 → 2025 성장
const NVDA: FinYear[] = [
  { fy: 2022, revenue: 27e9, operatingIncome: 5e9 },
  { fy: 2023, revenue: 22e9, operatingIncome: -1e9 },
  { fy: 2024, revenue: 61e9, operatingIncome: 33e9 },
  { fy: 2025, revenue: 130e9, operatingIncome: 81e9 },
];

describe("연도별 국면 흐름", () => {
  const stages = computeYearlyStages(NVDA);

  it("기준 연도(첫 해)는 흐름에 안 들어간다 — 직전이 없어 비교 불가", () => {
    expect(stages[0].fy).toBe(2023);
    expect(stages.map(s => s.fy)).toEqual([2023, 2024, 2025]);
  });

  it("2023은 위축(매출 급감 + 마진 붕괴)", () => {
    expect(stages.find(s => s.fy === 2023)!.substanceState).toBe("contracting");
  });

  it("2024는 반등 — 직전 바닥에서 크게 올라옴", () => {
    expect(stages.find(s => s.fy === 2024)!.substanceState).toBe("rebounding");
  });

  it("2025는 성장", () => {
    expect(stages.find(s => s.fy === 2025)!.substanceState).toBe("strong");
  });
});

describe("주요 전환점 탐지", () => {
  const stages = computeYearlyStages(NVDA);
  const changes = detectMajorChanges(NVDA, stages);
  const at = (fy: number) => changes.filter(c => c.fy === fy).map(c => c.kind);

  it("2024 흑자전환을 잡는다", () => expect(at(2024)).toContain("흑자전환"));
  it("2024 반등을 잡는다", () => expect(at(2024)).toContain("반등"));
  it("2024 성장가속을 잡는다", () => expect(at(2024)).toContain("성장가속"));
  it("2023 역성장전환을 잡는다", () => expect(at(2023)).toContain("역성장전환"));

  it("적자전환도 잡는다 — 흑자→적자", () => {
    const intc: FinYear[] = [
      { fy: 2022, revenue: 63e9, operatingIncome: 2e9 },
      { fy: 2023, revenue: 54e9, operatingIncome: 0.1e9 },
      { fy: 2024, revenue: 53e9, operatingIncome: -12e9 },
    ];
    const ch = detectMajorChanges(intc, computeYearlyStages(intc));
    expect(ch.filter(c => c.fy === 2024).map(c => c.kind)).toContain("적자전환");
  });

  it("같은 해 같은 종류를 중복으로 담지 않는다", () => {
    const kinds = changes.filter(c => c.fy === 2024).map(c => c.kind);
    expect(kinds.length).toBe(new Set(kinds).size);
  });
});

describe("흐름 렌더", () => {
  it("연도 화살표 흐름과 전환점을 담는다", () => {
    const t = renderTrajectory({ years: computeYearlyStages(NVDA), changes: detectMajorChanges(NVDA, computeYearlyStages(NVDA)) });
    expect(t).toContain("2023 위축");
    expect(t).toContain("→");
    expect(t).toContain("주요 전환점");
  });

  it("데이터가 한 해뿐이면 빈 문자열 — 흐름을 지어내지 않는다", () => {
    expect(renderTrajectory({ years: [], changes: [] })).toBe("");
  });
});

import { describe, it, expect } from "vitest";
import {
  auditReconciliation,
  formatReconcileIssues,
  type ReconcileInput,
} from "./reconcile-audit";

/**
 * 메디포스트(분석 1132)에서 실제로 나온 값이다.
 * rNPV 41,325원과 피어 9,000원이 359% 벌어졌는데, "rNPV에 더 큰 신뢰를 두어
 * 조율합니다"라고 써놓고 base에는 41,325를 그대로 넣었다.
 * 상대가치 3시나리오는 전부 9,000으로 같았다.
 */
const MEDIPOST: ReconcileInput = {
  base: 41_325,
  absBase: 41_325, absBear: 29_714, absBull: 52_936,
  relBase: 9_000, relBear: 9_000, relBull: 9_000,
  absWeight: 0.7, // rNPV 모델
};

const clean = (over: Partial<ReconcileInput> = {}): ReconcileInput => ({
  base: 24_000,
  absBase: 30_000, absBear: 22_000, absBull: 38_000,
  relBase: 10_000, relBear: 8_000, relBull: 13_000,
  absWeight: 0.7,
  ...over,
});

describe("메디포스트 사고를 잡는다", () => {
  const issues = auditReconciliation(MEDIPOST);
  const codes = issues.map(i => i.code);

  it("조율하지 않은 것을 잡는다", () => {
    expect(codes).toContain("not-reconciled");
  });

  it("상대가치 3시나리오가 같은 것을 잡는다", () => {
    expect(codes).toContain("flat-relative");
  });

  it("얼마가 나왔어야 하는지 알려준다", () => {
    // 41,325 × 0.7 + 9,000 × 0.3 = 31,627 (부동소수점 탓에 31627.4999…라 내림된다)
    const msg = issues.find(i => i.code === "not-reconciled")!.message;
    expect(msg).toContain("31,627");
    expect(msg).toContain("359%"); // 괴리율
  });
});

describe("정상 조율은 통과시킨다", () => {
  it("가중평균을 지켰으면 문제 없음", () => {
    // 30,000 × 0.7 + 10,000 × 0.3 = 24,000
    expect(auditReconciliation(clean())).toEqual([]);
  });

  it("반올림·시나리오 조정 정도의 오차는 봐준다", () => {
    expect(auditReconciliation(clean({ base: 25_500 }))).toEqual([]); // +6%
  });

  it("허용 오차를 넘으면 잡는다", () => {
    const codes = auditReconciliation(clean({ base: 29_000 })).map(i => i.code); // +21%
    expect(codes).toContain("not-reconciled");
  });
});

describe("값을 복사한 흔적을 잡는다", () => {
  it("절대가치와 상대가치가 정확히 같으면 잡는다", () => {
    const codes = auditReconciliation(clean({ absBase: 10_000, relBase: 10_000, base: 10_000 }))
      .map(i => i.code);
    expect(codes).toContain("abs-equals-rel");
  });

  it("절대가치 3시나리오가 같으면 잡는다", () => {
    const codes = auditReconciliation(
      clean({ absBear: 30_000, absBase: 30_000, absBull: 30_000 }),
    ).map(i => i.code);
    expect(codes).toContain("flat-absolute");
  });
});

describe("값이 없으면 판정하지 않는다", () => {
  // 파싱 실패나 미기재를 오류로 몰면 정상 분석이 막힌다
  it("상대가치가 없으면 조율 검산을 건너뛴다", () => {
    expect(auditReconciliation(clean({ relBase: null, relBear: null, relBull: null })))
      .toEqual([]);
  });

  it("base가 없으면 조율 검산을 건너뛴다", () => {
    expect(auditReconciliation(clean({ base: null }))).toEqual([]);
  });

  it("0이나 음수는 값으로 치지 않는다", () => {
    expect(auditReconciliation(clean({ relBase: 0, relBear: 0, relBull: 0 }))).toEqual([]);
  });
});

describe("QC 피드백 문자열", () => {
  it("문제가 없으면 null", () => {
    expect(formatReconcileIssues([])).toBeNull();
  });

  it("문제를 번호 매겨 알린다", () => {
    const t = formatReconcileIssues(auditReconciliation(MEDIPOST))!;
    expect(t).toContain("조율 검산 실패");
    expect(t).toContain("1.");
    expect(t).toContain("2.");
  });
});

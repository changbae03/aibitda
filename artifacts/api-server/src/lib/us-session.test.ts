import { describe, it, expect } from "vitest";
import { US_SESSIONS, describeUsSession, isUsSessionInProgress, usTenseRule } from "./us-session.js";

describe("미국 세션 설명", () => {
  it("모든 세션이 자기 설명을 갖는다 — 기본값으로 조용히 떨어지지 않는다", () => {
    // us_midday가 빠져 장중 2차가 "주말 휴장"으로 설명됐던 회귀
    const descs = US_SESSIONS.map(describeUsSession);
    expect(new Set(descs).size, descs.join(" / ")).toBe(US_SESSIONS.length);
  });

  it("장중 2차는 휴장이 아니다", () => {
    expect(describeUsSession("us_midday")).not.toContain("휴장");
    expect(describeUsSession("us_midday")).toContain("정규 거래");
  });

  it("모르는 값은 주말 휴장으로 둔다 — 장중이라고 우기지 않는다", () => {
    expect(describeUsSession("뭔가이상한값")).toContain("주말 휴장");
    expect(isUsSessionInProgress("뭔가이상한값")).toBe(false);
  });
});

describe("시제 규칙", () => {
  it("장중에는 마감 말투를 금지한다", () => {
    for (const s of ["us_premarket", "us_open", "us_midday"]) {
      expect(isUsSessionInProgress(s), s).toBe(true);
      const rule = usTenseRule(s);
      expect(rule, s).toContain("돌아가는 중");
      expect(rule, s).toContain("진행형");        // 진행형을 쓰라고 직접 지시해야 한다
      expect(rule, s).toContain("주도하고 있고"); // 바꿔 쓸 본보기가 있어야 한다
    }
  });

  it("마감 후에는 정리하는 시제를 쓴다", () => {
    for (const s of ["us_afterhours", "us_overnight", "us_weekend"]) {
      expect(isUsSessionInProgress(s), s).toBe(false);
      expect(usTenseRule(s), s).toContain("끝난 뒤");
    }
  });
});

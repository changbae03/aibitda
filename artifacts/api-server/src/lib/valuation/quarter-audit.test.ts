import { describe, it, expect } from "vitest";
import { auditQuarters, formatQuarterIssues } from "./quarter-audit";

/** 메디포스트(분석 1132) 화면에 나온 표를 그대로 옮긴 것 */
const MEDIPOST = `
Q1 확정 실적이 초기 기대치 대비 +1.2% → 구조적 개선으로 판단, 연간E를 기존 743.7억원 → 743.7억원으로 상향 조정

| 구분 | Q1(★확정) | Q2E | Q3E | Q4E | 연간계 |
|------|-----------|-----|-----|-----|--------|
| 매출 (억원) | 194.6 | 179.9 | 188.5 | 180.6 | 743.7 |
| 영업이익 (억원) | -168.5 | -169.7 | -163.1 | -175.9 | -677.2 |
| 영업이익률 (%) | -86.6 | -94.3 | -86.5 | -97.4 | -91.1 |
`;

const CONFIRMED = [{ quarter: 1, revenue: 194.6, operatingIncome: -168.5 }];

describe("메디포스트 표를 읽는다", () => {
  const issues = auditQuarters({ content: MEDIPOST, confirmed: CONFIRMED });

  it("분기 합이 연간계와 맞으면 그 항목은 걸지 않는다", () => {
    // 194.6+179.9+188.5+180.6 = 743.6 ≈ 743.7 (반올림 오차 이내)
    expect(issues.filter(i => i.code === "sum-mismatch")).toEqual([]);
  });

  it("확정 분기를 그대로 썼으면 걸지 않는다", () => {
    expect(issues.filter(i => i.code === "confirmed-changed")).toEqual([]);
  });

  /**
   * "연간E를 기존 743.7억원 → 743.7억원으로 상향 조정" —
   * 같은 숫자를 놓고 조정했다고 쓴 것이다. 조정이 일어난 적이 없다.
   */
  it("숫자가 그대로인 '조정'을 잡는다", () => {
    expect(issues.map(i => i.code)).toContain("empty-adjustment");
    expect(formatQuarterIssues(issues)).toContain("앞뒤 숫자가 같습니다");
  });
});

describe("분기 합이 연간과 어긋나면 잡는다", () => {
  it("매출 합계 불일치", () => {
    const t = MEDIPOST.replace("| 743.7 |", "| 900.0 |");
    const codes = auditQuarters({ content: t, confirmed: CONFIRMED }).map(i => i.code);
    expect(codes).toContain("sum-mismatch");
  });

  it("얼마가 어긋났는지 알려준다", () => {
    const t = MEDIPOST.replace("| 743.7 |", "| 900.0 |");
    const msg = formatQuarterIssues(auditQuarters({ content: t, confirmed: CONFIRMED }))!;
    expect(msg).toContain("743.6");   // 실제 분기 합
    expect(msg).toContain("900.0");   // 적어낸 연간계
  });

  it("반올림 수준의 차이는 넘어간다", () => {
    const codes = auditQuarters({ content: MEDIPOST, confirmed: CONFIRMED }).map(i => i.code);
    expect(codes).not.toContain("sum-mismatch");
  });
});

describe("확정 분기를 바꾸면 잡는다", () => {
  it("공시된 매출을 다른 값으로 적으면 불승인", () => {
    const t = MEDIPOST.replace("| 194.6 | 179.9", "| 220.0 | 179.9");
    const codes = auditQuarters({ content: t, confirmed: CONFIRMED }).map(i => i.code);
    expect(codes).toContain("confirmed-changed");
  });

  it("확정값 정보가 없으면 판정하지 않는다", () => {
    const codes = auditQuarters({ content: MEDIPOST, confirmed: [] }).map(i => i.code);
    expect(codes).not.toContain("confirmed-changed");
  });
});

describe("판정할 근거가 없으면 나서지 않는다", () => {
  it("분기 표가 없으면 통과 — 분기 전망이 없는 보고서를 막지 않는다", () => {
    expect(auditQuarters({ content: "## DCF\n매출 1,000억원", confirmed: CONFIRMED }))
      .toEqual([]);
  });

  it("분기가 4개 다 없으면 합을 따지지 않는다", () => {
    const t = `
| 구분 | Q1 | Q2E | 연간계 |
|---|---|---|---|
| 매출 (억원) | 194.6 | 179.9 | 743.7 |
`;
    expect(auditQuarters({ content: t, confirmed: [] })).toEqual([]);
  });

  it("열 순서가 바뀌어도 읽는다", () => {
    const t = `
| 구분 | 연간계 | Q1 | Q2E | Q3E | Q4E |
|---|---|---|---|---|---|
| 매출 (억원) | 900.0 | 194.6 | 179.9 | 188.5 | 180.6 |
`;
    expect(auditQuarters({ content: t, confirmed: [] }).map(i => i.code))
      .toContain("sum-mismatch");
  });
});

describe("QC 피드백 문자열", () => {
  it("문제가 없으면 null", () => {
    expect(formatQuarterIssues([])).toBeNull();
  });

  it("번호를 매겨 알린다", () => {
    const t = formatQuarterIssues(auditQuarters({ content: MEDIPOST, confirmed: CONFIRMED }))!;
    expect(t).toContain("분기·연간 정합성 검산 실패");
    expect(t).toContain("1.");
  });
});

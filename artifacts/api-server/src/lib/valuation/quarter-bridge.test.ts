import { describe, it, expect } from "vitest";
import {
  sortChronologically,
  quarterOf,
  buildQuarterBridge,
  renderQuarterBridge,
  type QuarterRow,
} from "./quarter-bridge";

const 억 = (n: number) => n * 1e8;

/** 메디포스트(078160) 실제 DART 값 */
const MEDIPOST: QuarterRow[] = [
  { bsnsYear: 2025, reprtCode: "11013", periodLabel: "2025 Q1",     revenue: 억(192.2), operatingIncome: 억(-136.7) },
  { bsnsYear: 2025, reprtCode: "11012", periodLabel: "2025 Q2(H1)", revenue: 억(178.4), operatingIncome: 억(-189.9) },
  { bsnsYear: 2025, reprtCode: "11014", periodLabel: "2025 Q3",     revenue: 억(186.9), operatingIncome: 억(-140.6) },
  { bsnsYear: 2025, reprtCode: "11011", periodLabel: "2025 FY",     revenue: 억(736.6), operatingIncome: 억(-679.8) },
  { bsnsYear: 2026, reprtCode: "11013", periodLabel: "2026 Q1",     revenue: 억(194.6), operatingIncome: 억(-168.5) },
];

describe("보고서 코드는 시간 순이 아니다", () => {
  /**
   * 코드는 11011(연간)·11012(반기)·11013(1분기)·11014(3분기)다.
   * `ORDER BY reprt_code`로 정렬하면 Q2가 Q1보다 앞에 온다. 실제로 Q1·Q2가 확정된
   * 종목에서 "최신 확정 분기"로 Q1이 집혔고, OPM 추세 판단이 한 분기 뒤진 값으로 돌았다.
   */
  it("코드 번호 순서와 분기 순서가 어긋난다", () => {
    expect(quarterOf("11013")).toBe(1);
    expect(quarterOf("11012")).toBe(2); // 코드는 더 작은데 분기는 더 뒤
    expect(quarterOf("11014")).toBe(3);
  });

  it("시간 순으로 정렬한다", () => {
    const sorted = sortChronologically(MEDIPOST.filter(r => r.bsnsYear === 2025 && r.reprtCode !== "11011"));
    expect(sorted.map(r => quarterOf(r.reprtCode))).toEqual([1, 2, 3]);
  });

  it("Q1·Q2만 있어도 최신은 Q2다", () => {
    const rows = MEDIPOST.filter(r => ["11013", "11012"].includes(r.reprtCode) && r.bsnsYear === 2025);
    const sorted = sortChronologically(rows);
    expect(quarterOf(sorted[sorted.length - 1].reprtCode)).toBe(2);
  });
});

describe("확정 분기를 작년 같은 기간과 묶는다", () => {
  const b = buildQuarterBridge(MEDIPOST, 2026)!;

  it("올해 확정 분기만 센다", () => {
    expect(b.confirmed).toHaveLength(1);
    expect(b.remaining).toBe(3);
  });

  it("확정 합계", () => {
    expect(b.confirmedRevenue! / 1e8).toBeCloseTo(194.6, 1);
    expect(b.confirmedOp! / 1e8).toBeCloseTo(-168.5, 1);
  });

  it("작년 같은 분기(Q1)와 비교할 값을 준다", () => {
    expect(b.priorYearSameRevenue! / 1e8).toBeCloseTo(192.2, 1);
    expect(b.priorYearSameOp! / 1e8).toBeCloseTo(-136.7, 1);
  });

  it("작년 남은 분기(Q2·Q3) 합계를 준다 — 올해 남은 분기의 출발점", () => {
    expect(b.priorYearRestRevenue! / 1e8).toBeCloseTo(178.4 + 186.9, 1);
    expect(b.priorYearRestOp! / 1e8).toBeCloseTo(-189.9 + -140.6, 1);
  });

  it("연간 보고서는 분기로 세지 않는다", () => {
    expect(b.confirmed.every(r => r.reprtCode !== "11011")).toBe(true);
  });

  it("올해 분기가 없으면 만들지 않는다", () => {
    expect(buildQuarterBridge(MEDIPOST, 2027)).toBeNull();
  });
});

describe("역산 순서를 프롬프트에 못박는다", () => {
  const t = renderQuarterBridge(buildQuarterBridge(MEDIPOST, 2026)!, 2026);

  it("확정값과 남은 분기 수를 알려준다", () => {
    expect(t).toContain("확정: Q1 (1개) · 남은 분기: 3개");
    expect(t).toContain("194.6억원");
  });

  it("전년 동기 대비를 함께 보여준다", () => {
    expect(t).toContain("전년 동기 대비"); // 194.6 vs 192.2
  });

  it("연간을 먼저 정하는 것을 금지한다", () => {
    expect(t).toContain("연간E를 먼저 정하고 분기를 끼워 맞추지 마세요");
    expect(t).toContain("확정값은 **고정**");
  });

  /**
   * 메디포스트 본문에 이런 문장이 있었다 —
   * "연간E를 기존 743.7억원 → 743.7억원으로 상향 조정".
   * 같은 숫자를 놓고 조정했다고 쓴 것이다.
   */
  it("숫자 없는 '조정'을 금지한다", () => {
    expect(t).toContain("바뀐 값");
    expect(t).toContain("같은 숫자를 놓고 조정했다고 쓰면 불승인");
  });

  it("분기 합 검산을 예고한다", () => {
    expect(t).toContain("분기 4개의 합이 연간E와 다르면");
  });
});

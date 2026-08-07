import { describe, it, expect } from "vitest";
import { renderTimelineBody, BODY_BUDGET } from "./biz-timeline-extract.js";

/**
 * 원문 다듬기의 안전망.
 *
 * 16개 기간을 통째로 넣으면 10만 자가 넘어(동양파일 102,006자) 생성이 느려진다.
 * 숫자·전략은 이미 코드가 표로 뽑아 주므로, 원문은 "표에 안 잡히는 맥락"만 맡는다.
 * 그 맥락은 최근일수록 중요하므로 최근은 넉넉히, 과거는 짧게 준다.
 */

const mk = (n: number, chars = 8000) =>
  Array.from({ length: n }, (_, i) => ({
    bsnsYear: 2022 + Math.floor(i / 4),
    quarter: (i % 4) + 1,
    reportNm: "분기보고서",
    content: "가".repeat(chars),
  }));

describe("최근은 넉넉히, 과거는 짧게", () => {
  const out = renderTimelineBody(mk(16));

  it("전체 분량이 원문보다 크게 줄어든다", () => {
    const raw = 16 * 8000;
    expect(out.length).toBeLessThan(raw * 0.5);
  });

  it("최근 기간은 recentChars까지 담는다", () => {
    // 마지막 기간(2025년 4분기) 블록이 recentChars 근처여야 한다
    const blocks = out.split("─────────").filter(b => b.includes("가"));
    const last = blocks[blocks.length - 1];
    expect(last.length).toBeGreaterThan(BODY_BUDGET.recentChars - 200);
  });

  it("과거 기간은 olderChars로 줄인다", () => {
    const blocks = out.split("─────────").filter(b => b.includes("가"));
    expect(blocks[0].length).toBeLessThan(BODY_BUDGET.olderChars + 400);
  });
});

describe("조용히 자르지 않는다", () => {
  it("자른 기간에는 줄였다는 표시와 원래 길이가 남는다", () => {
    const out = renderTimelineBody(mk(16));
    expect(out).toContain("이 기간 원문은 여기서 줄임");
    expect(out).toContain("8,000자");
  });

  it("짧은 원문은 자르지 않고 표시도 붙이지 않는다", () => {
    const out = renderTimelineBody([
      { bsnsYear: 2025, quarter: 4, reportNm: "사업보고서", content: "짧은 내용" },
    ]);
    expect(out).toContain("짧은 내용");
    expect(out).not.toContain("줄임");
  });

  it("기간 라벨은 유지된다 — 어느 기간 서술인지 알아야 한다", () => {
    const out = renderTimelineBody(mk(8));
    expect(out).toMatch(/2022년/);
    expect(out).toMatch(/2023년/);
  });
});

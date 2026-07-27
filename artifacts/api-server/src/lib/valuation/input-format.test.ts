import { describe, it, expect } from "vitest";
import {
  findMissingInputs,
  completeness,
  renderMissingBlock,
  type InputPresence,
} from "./input-format";

/** 다 갖춰진 상태 — 여기서 하나씩 빼면서 판정을 확인한다 */
const full = (over: Partial<InputPresence> = {}): InputPresence => ({
  market: "KR",
  currentPrice: 25_000,
  sharesOut: 100_000_000,
  netDebt: { netDebt: -5e11 },
  financialYears: 3,
  peerCount: 5,
  bandUsable: true,
  segmentText: "부문별 매출 …",
  backlogText: null,
  beta: 1.2,
  needsSegments: false,
  ...over,
});

describe("다 갖춰지면 아무 말도 하지 않는다", () => {
  it("누락 0건", () => {
    expect(findMissingInputs(full())).toEqual([]);
  });

  it("갖춰짐 100%", () => {
    expect(completeness(findMissingInputs(full()))).toBe(1);
  });

  it("프롬프트 블록이 비어 있다 — 잡음을 만들지 않는다", () => {
    expect(renderMissingBlock(findMissingInputs(full()))).toBe("");
  });
});

describe("목표주가를 무너뜨리는 입력은 critical", () => {
  const criticalOf = (over: Partial<InputPresence>) =>
    findMissingInputs(full(over)).filter(m => m.severity === "critical").map(m => m.key);

  it("순차입금", () => {
    expect(criticalOf({ netDebt: null })).toContain("netDebt");
  });

  it("발행주식수", () => {
    expect(criticalOf({ sharesOut: null })).toContain("sharesOut");
  });

  it("현재가", () => {
    expect(criticalOf({ currentPrice: null })).toContain("currentPrice");
  });

  it("재무가 아예 없으면 critical, 1년만 있으면 major", () => {
    expect(criticalOf({ financialYears: 0 })).toContain("financials");
    expect(criticalOf({ financialYears: 1 })).not.toContain("financials");
    expect(findMissingInputs(full({ financialYears: 1 })).find(m => m.key === "financials")?.severity)
      .toBe("major");
  });

  it("SOTP 모델인데 부문 자료가 없으면 critical", () => {
    expect(criticalOf({ needsSegments: true, segmentText: null })).toContain("segments");
    // SOTP가 아니면 부문 자료가 없어도 문제 삼지 않는다
    expect(findMissingInputs(full({ needsSegments: false, segmentText: null })).map(m => m.key))
      .not.toContain("segments");
  });
});

describe("추정 금지 지시가 프롬프트에 들어간다", () => {
  /**
   * 한화시스템 사고의 재발 방지선. 순부채가 안 들어오자 AI가 추정했고
   * 목표주가가 실제의 6배로 나왔다. 데이터가 없으면 **없다고 말해야** 한다.
   */
  it("순차입금이 없으면 추정하지 말라고 명시한다", () => {
    const t = renderMissingBlock(findMissingInputs(full({ netDebt: null })));
    expect(t).toContain("추정하지 마세요");
    expect(t).toContain("6배");
  });

  it("업종 밴드가 없으면 기억 속 평균을 쓰지 말라고 한다", () => {
    const t = renderMissingBlock(findMissingInputs(full({ bandUsable: false })));
    expect(t).toContain("기억에 있는 업종 평균을 적어넣지 마세요");
  });

  it("critical이 있으면 결론에 불확실성을 적으라고 요구한다", () => {
    const t = renderMissingBlock(findMissingInputs(full({ netDebt: null })));
    expect(t).toContain("불확실성을 결론에 반드시");
  });

  it("minor만 빠졌으면 그 요구는 붙지 않는다", () => {
    const t = renderMissingBlock(findMissingInputs(full({ beta: null })));
    expect(t).toContain("베타");
    expect(t).not.toContain("불확실성을 결론에 반드시");
  });
});

describe("갖춰짐 비율은 심각도로 가중한다", () => {
  it("순차입금 하나가 베타 하나보다 무겁다", () => {
    const withoutNetDebt = completeness(findMissingInputs(full({ netDebt: null })));
    const withoutBeta = completeness(findMissingInputs(full({ beta: null })));
    expect(withoutNetDebt).toBeLessThan(withoutBeta);
  });

  it("0~1 범위를 벗어나지 않는다", () => {
    const nothing = findMissingInputs({
      market: "KR", currentPrice: null, sharesOut: null, netDebt: null,
      financialYears: 0, peerCount: 0, bandUsable: false,
      segmentText: null, backlogText: null, beta: null, needsSegments: true,
    });
    const c = completeness(nothing);
    expect(c).toBeGreaterThanOrEqual(0);
    expect(c).toBeLessThanOrEqual(1);
  });
});

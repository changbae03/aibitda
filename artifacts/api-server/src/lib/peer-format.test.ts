import { describe, it, expect } from "vitest";
import { formatPeerTable, type PeerWithMetrics } from "./peer-format";

function peer(over: Partial<PeerWithMetrics> = {}): PeerWithMetrics {
  return {
    ticker: "005930", name: "삼성전자", rank: 0, reason: null, source: "ai",
    market: "KR", sector: "반도체", per: 38.01, pbr: 3.9, roe: 10.5, opm: 12.3,
    marketCap: 4.5e14, currentPrice: 75000, ...over,
  };
}

describe("피어 표 — 통화 표기", () => {
  // 미국 시총을 원화 단위(억·조)로 찍으면 AI가 규모를 잘못 비교한다.
  // 실제로 알파벳 시총이 "4.2조"로 나와 한국 대형주와 비슷해 보이는 문제가 있었다.
  it("미국 종목은 달러 단위로 적는다", () => {
    const t = formatPeerTable([peer({ ticker: "GOOGL", name: "Alphabet", market: "US", marketCap: 2.1e12 })]);
    expect(t).toContain("$2.10T");
    expect(t).not.toContain("조원");
  });

  it("한국 종목은 원화 단위로 적는다", () => {
    const t = formatPeerTable([peer({ marketCap: 4.5e14 })]);
    expect(t).toContain("조원");
    expect(t).not.toContain("$");
  });

  it("10억 달러 미만 미국 종목도 단위가 맞는다", () => {
    const t = formatPeerTable([peer({ ticker: "ABC", market: "US", marketCap: 5.4e8 })]);
    expect(t).toContain("$540M");
  });
});

describe("피어 표 — 결측 지표", () => {
  // 수집 실패를 0으로 채운 흔적이 있다(샘씨엔에스 PER 0.00/PBR 0.00).
  // 0을 그대로 넣으면 AI가 초저평가로 오해하므로 값 없음으로 표시해야 한다.
  it("PER·PBR이 0이면 값 없음으로 표시한다", () => {
    const t = formatPeerTable([peer({ per: 0, pbr: 0 })]);
    const cells = t.split("\n")[2].split("|").map((s) => s.trim());
    expect(cells[3]).toBe("—");
    expect(cells[4]).toBe("—");
  });

  it("null 지표도 값 없음으로 표시한다", () => {
    const t = formatPeerTable([peer({ per: null, roe: null, marketCap: null })]);
    expect(t).toContain("—");
  });

  it("음수 PER은 실제 값이므로 그대로 둔다", () => {
    // 적자 기업은 PER이 음수로 나온다 — 결측이 아니라 의미 있는 신호다.
    const t = formatPeerTable([peer({ per: -42.16 })]);
    expect(t).toContain("-42.16");
  });
});

describe("피어 표 — 형식", () => {
  it("피어가 없으면 빈 문자열", () => {
    expect(formatPeerTable([])).toBe("");
  });

  it("종목마다 한 줄씩 나온다", () => {
    const t = formatPeerTable([peer(), peer({ ticker: "000660", name: "SK하이닉스" })]);
    expect(t.split("\n")).toHaveLength(4); // 헤더 + 구분선 + 2행
    expect(t).toContain("(005930)");
    expect(t).toContain("(000660)");
  });
});

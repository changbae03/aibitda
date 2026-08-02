import { describe, it, expect } from "vitest";
import { extractSignals, buildSignalTimeline, emergingTerms, renderBizSignals } from "./biz-signals.js";

describe("전략 행동 문장 추출", () => {
  it("양산/증설 문장을 잡는다", () => {
    const hits = extractSignals("지난 9월 세계 최초로 HBM4 양산 체제를 확보하였습니다.");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].sentence).toContain("HBM4");
  });

  it("인수/합병 문장을 M&A로 잡는다", () => {
    const hits = extractSignals("당사는 인텔의 NAND 사업 부문 전체의 인수 절차를 완료하였습니다.");
    expect(hits.some(h => h.theme === "M&A·제휴")).toBe(true);
  });

  it("목차·번호 머리글은 행동이 아니다 — 거른다", () => {
    expect(extractSignals("(2) 연구개발 실적 총괄표는 다음과 같습니다")).toEqual([]);
  });

  it("전략 신호가 없으면 빈 배열", () => {
    expect(extractSignals("당사의 사업은 반도체 메모리 제조입니다.")).toEqual([]);
  });
});

describe("기간 간 중복 제거 — 그 해 새로 나온 것만", () => {
  const periods = [
    { label: "2024년 연간", content: "당사는 세계 최초 HBM4 양산 체제를 확보했습니다." },
    { label: "2025년 연간", content: "당사는 세계 최초 HBM4 양산 체제를 확보했습니다. 또한 GDDR7 양산 체제를 새로 구축했습니다." },
  ];
  const tl = buildSignalTimeline(periods);

  it("반복된 문장은 첫 등장 연도에만 남는다", () => {
    const y2025 = tl.find(p => p.label === "2025년 연간");
    // HBM4는 2024에 이미 나왔으니 2025에선 빠지고, GDDR7만 남아야 한다
    expect(y2025?.hits.some(h => h.sentence.includes("HBM4"))).toBe(false);
    expect(y2025?.hits.some(h => h.sentence.includes("GDDR7"))).toBe(true);
  });

  it("2024엔 HBM4가 남는다", () => {
    expect(tl.find(p => p.label === "2024년 연간")?.hits.some(h => h.sentence.includes("HBM4"))).toBe(true);
  });
});

describe("새로 등장한 기술·제품 용어", () => {
  it("과거엔 없다가 최근에 2번 이상 나온 영문 용어를 잡는다", () => {
    const periods = [
      { label: "2022", content: "당사의 주력은 DDR5 제품입니다." },
      { label: "2025", content: "HBM4 개발을 완료하고 HBM4 양산을 시작했습니다." },
    ];
    const t = emergingTerms(periods);
    expect(t).toContain("HBM4");
    expect(t).not.toContain("DDR5"); // 과거에 이미 있던 것
  });

  it("흔한 약어(AI·ESG·CEO)는 신호가 아니다", () => {
    const periods = [
      { label: "2022", content: "회사 개요입니다." },
      { label: "2025", content: "AI 시대에 ESG 경영을 CEO가 강조합니다. AI ESG CEO." },
    ];
    expect(emergingTerms(periods)).toEqual([]);
  });
});

describe("영어(SEC 10-K) 패턴", () => {
  it("인수 문장을 M&A로 잡는다", () => {
    const hits = extractSignals("Our acquisition of Mellanox in 2020 expanded our networking offerings.", "en");
    expect(hits.some(h => h.theme === "M&A·제휴")).toBe(true);
  });

  it("신제품 출시를 신사업·신제품으로 잡는다", () => {
    const hits = extractSignals("In 2024, we launched the NVIDIA Blackwell architecture for data centers.", "en");
    expect(hits.some(h => h.theme === "신사업·신제품")).toBe(true);
  });

  it("FDA 승인을 기술·R&D로 잡는다", () => {
    const hits = extractSignals("The company received FDA approval for its lead drug candidate.", "en");
    expect(hits.some(h => h.theme === "기술·R&D")).toBe(true);
  });

  it("한국어 텍스트에 영어 패턴을 쓰면 안 걸린다 — 언어 분리 확인", () => {
    expect(extractSignals("당사는 반도체를 제조합니다.", "en")).toEqual([]);
  });

  it("영어도 기간 간 반복을 제거한다", () => {
    const periods = [
      { label: "FY2024", content: "We acquired Mellanox to expand networking." },
      { label: "FY2025", content: "We acquired Mellanox to expand networking. We also launched the Blackwell platform." },
    ];
    const tl = buildSignalTimeline(periods, "en");
    const y25 = tl.find(p => p.label === "FY2025");
    expect(y25?.hits.some(h => /Mellanox/.test(h.sentence))).toBe(false);
    expect(y25?.hits.some(h => /Blackwell/.test(h.sentence))).toBe(true);
  });
});

describe("렌더", () => {
  it("행동이 하나도 없으면 빈 문자열 — 잡음을 만들지 않는다", () => {
    expect(renderBizSignals([], [])).toBe("");
  });

  it("전환점과 새 용어를 담는다", () => {
    const out = renderBizSignals(
      [{ label: "2025년 연간", hits: [{ theme: "증설·양산", sentence: "HBM4 양산 체제 확보" }] }],
      ["HBM4"],
    );
    expect(out).toContain("HBM4 양산 체제 확보");
    expect(out).toContain("새로 등장한");
  });
});

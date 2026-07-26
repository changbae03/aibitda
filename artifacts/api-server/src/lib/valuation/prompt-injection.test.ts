import { describe, it, expect } from "vitest";
import { buildPrompt } from "../ai-agents.js";

/**
 * 업종 → 모델 배정을 끝에서 끝까지 확인한다.
 *
 * 예전에는 모델 지시 블록 17개가 **모든 종목**의 프롬프트에 들어갔다. 30종목을
 * 조사했더니 예외 없이 8개 블록이 함께 전달됐고, 삼성전자를 분석하면서 리츠
 * Cap Rate·은행 CCAR·광산 AISC 규칙을 함께 읽는 구조였다. 여기서는 정확히
 * 하나만 붙는지 확인한다.
 */

const MODEL_HEADER = /## ⚖️ 밸류에이션 모델: (.+)/g;

function modelsIn(ticker: string, name: string, industry: string): string[] {
  const p = buildPrompt("relative_valuation", ticker, name, industry, null, []);
  const all = p.systemPrompt + "\n" + p.userPrompt;
  return [...all.matchAll(MODEL_HEADER)].map((m) => m[1].trim());
}

describe("모델 블록은 정확히 하나만 주입된다", () => {
  const samples: Array<[string, string, string]> = [
    ["005930", "삼성전자", "Consumer Electronics"],
    ["000660", "SK하이닉스", "Semiconductors"],
    ["105560", "KB금융", "Banks - Regional"],
    ["028260", "삼성물산", "Engineering & Construction"],
    ["JPM", "JPMorgan Chase", "Banks - Diversified"],
    ["PLD", "Prologis", "REIT - Industrial"],
  ];

  it.each(samples)("%s %s → 1개", (ticker, name, industry) => {
    expect(modelsIn(ticker, name, industry)).toHaveLength(1);
  });
});

describe("한국 종목이 미국 전용 모델로 새지 않는다", () => {
  // 야후는 한국 조선사(한화오션·HD현대중공업)의 업종도 "Aerospace & Defense"로 준다.
  // 시장 구분 없이 키워드만 보면 미국 방산 모델(CCAR·EAC 정상화)이 붙어버린다.
  it("한국 조선사가 미국 방산 모델을 받지 않는다", () => {
    expect(modelsIn("042660", "한화오션", "Aerospace & Defense")[0]).not.toBe("EV/EBITDA(Adj.)");
    expect(modelsIn("329180", "HD현대중공업", "Aerospace & Defense")[0]).not.toBe("EV/EBITDA(Adj.)");
  });

  it("한국 종목에 미국 전용 모델이 배정되지 않는다", () => {
    const US_ONLY = ["P/TBVPS", "NAV+P/AFFO", "EV/EBITDA(Adj.)", "Segment SOTP"];
    const kr: Array<[string, string, string]> = [
      ["005930", "삼성전자", "Consumer Electronics"],
      ["042660", "한화오션", "Aerospace & Defense"],
      ["105560", "KB금융", "Banks - Regional"],
      ["207940", "삼성바이오로직스", "Biotechnology"],
      ["032640", "LG유플러스", "Telecom Services"],
    ];
    for (const [t, n, i] of kr) {
      expect(US_ONLY, `${n}`).not.toContain(modelsIn(t, n, i)[0]);
    }
  });
});

describe("업종별로 의도한 모델이 배정된다", () => {
  const cases: Array<[string, string, string, string]> = [
    // 한국
    ["005930", "삼성전자", "Consumer Electronics", "DCF"],
    ["105560", "KB금융", "Banks - Regional", "P/B-ROE"],
    ["402340", "SK스퀘어", "Semiconductors", "SOTP"],
    // 미국 — 각 시장 전용 모델
    ["JPM", "JPMorgan Chase", "Banks - Diversified", "P/TBVPS"],
    ["PLD", "Prologis", "REIT - Industrial", "NAV+P/AFFO"],
    ["LMT", "Lockheed Martin", "Aerospace & Defense", "EV/EBITDA(Adj.)"],
    // M7(매그니피센트 세븐)은 반도체 업종이라도 Segment SOTP를 쓴다 —
    // 이질적 사업부와 SBC 왜곡 때문에 단일 배수가 맞지 않는다.
    ["MSFT", "Microsoft Corp", "Software - Infrastructure", "Segment SOTP"],
    ["NVDA", "NVIDIA", "Semiconductors", "Segment SOTP"],
    // M7이 아닌 일반 미국 반도체는 DCF
    ["AMD", "Advanced Micro Devices", "Semiconductors", "DCF"],
  ];

  it.each(cases)("%s %s → %s", (ticker, name, industry, expected) => {
    expect(modelsIn(ticker, name, industry)[0]).toBe(expected);
  });
});

describe("공통 조율 규칙이 어느 모델에나 들어간다", () => {
  it("괴리율 처리와 3-way 금지가 항상 포함된다", () => {
    const targets: Array<[string, string, string]> = [
      ["005930", "삼성전자", "Consumer Electronics"],
      ["105560", "KB금융", "Banks - Regional"],
      ["PLD", "Prologis", "REIT - Industrial"],
    ];
    for (const [t, n, i] of targets) {
      const all = (() => {
        const p = buildPrompt("relative_valuation", t, n, i, null, []);
        return p.systemPrompt + p.userPrompt;
      })();
      expect(all, n).toContain("괴리율 20% 이내");
      expect(all, n).toContain("괴리율 30% 초과");
      expect(all, n).toContain("3개 이상 방법론의 단순 평균 금지");
      expect(all, n).toContain("같은 값을 복사해 넣는 것을 금지");
    }
  });
});

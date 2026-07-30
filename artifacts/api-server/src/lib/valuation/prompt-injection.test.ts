import { describe, it, expect } from "vitest";
import { buildPrompt, type AgentKey } from "../ai-agents.js";

/** 파이프라인에서 빠진 단계. 되살릴 때 AgentKey에 다시 넣는다 */
const RETIRED_STEP = "relative_valuation" as AgentKey;

/**
 * ⚠️ 2026-07-30부터 **전부 보류(skip)** 상태다.
 *
 * 제품 방향이 목표주가 산출에서 사업보고서 흐름 분석으로 바뀌면서 파이프라인의
 * `relative_valuation` 단계가 빠졌다. 이 파일은 그 단계의 프롬프트를 검사하므로
 * 지금은 돌릴 대상이 없다.
 *
 * **지우지 않는 이유**: lib/valuation/ 아래 모델 17개·검산 4종·실측 밴드는 그대로
 * 살아 있고, 목표주가를 다시 낼 일이 생기면 이 테스트가 그때의 안전망이 된다.
 * 여기서 지키던 것들 — 모델 블록이 정확히 하나만 붙는가, 한국 종목이 미국 전용
 * 모델로 새지 않는가, 적자 임상 바이오가 rNPV를 받고 흑자 CDMO는 DCF를 받는가 —
 * 은 전부 실제 사고에서 나온 회귀 방지선이다.
 *
 * **되살리는 법**: ai-agents.ts의 AgentKey·STEP_ORDER에 "relative_valuation"을 넣고
 * 프롬프트를 복원한 뒤(커밋 fd5d56d6 이전 버전) 아래 describe.skip을 describe로 바꾼다.
 */

const MODEL_HEADER = /## ⚖️ 밸류에이션 모델: (.+)/g;
const MODEL_HEADER_ONE = /## ⚖️ 밸류에이션 모델: (.+)/;

function modelsIn(ticker: string, name: string, industry: string): string[] {
  const p = buildPrompt(RETIRED_STEP, ticker, name, industry, null, []);
  const all = p.systemPrompt + "\n" + p.userPrompt;
  return [...all.matchAll(MODEL_HEADER)].map((m) => m[1].trim());
}

describe.skip("모델 블록은 정확히 하나만 주입된다", () => {
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

describe.skip("한국 종목이 미국 전용 모델로 새지 않는다", () => {
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

describe.skip("업종별로 의도한 모델이 배정된다", () => {
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

describe.skip("보고서 서식도 고른 모델 것만 들어간다", () => {
  // 예전에는 DCF·rNPV·EV/Sales·Gordon P/B 네 벌(640줄)이 전부 들어가고 "모델이 X인
  // 경우 이 섹션만 작성"이라는 문장으로 AI가 고르게 했다. 삼성전자 프롬프트에 임상
  // 파이프라인 rNPV 작성법 21k자가 실려 relative_valuation userPrompt의 54%를 차지했다.
  const FMT = {
    dcf: "### [모델이 DCF (NOPAT/FCFF)인 경우",
    rnpv: "### [모델이 Pipeline rNPV인 경우",
    evSales: "### [모델이 EV/Sales인 경우",
    pbDdm: "### [모델이 Gordon Growth P/B 또는 DDM인 경우",
  };

  function formatsIn(
    ticker: string, name: string, industry: string, opm?: number | null,
  ): string[] {
    const p = buildPrompt(
      RETIRED_STEP, ticker, name, industry, null, [], null, "ko", null, { opm },
    );
    const all = p.systemPrompt + p.userPrompt;
    return Object.entries(FMT).filter(([, h]) => all.includes(h)).map(([k]) => k);
  }

  it("일반 사업회사는 rNPV·P/B 서식을 받지 않는다", () => {
    // EV/Sales는 적자 성장기업 대비용이라 DCF와 짝으로 붙는다
    expect(formatsIn("005930", "삼성전자", "Consumer Electronics", 42.7))
      .toEqual(["dcf", "evSales"]);
  });

  it("금융은 P/B·DDM 서식 하나만 받는다", () => {
    expect(formatsIn("105560", "KB금융", "Banks - Regional", 60.7)).toEqual(["pbDdm"]);
  });

  it("임상 바이오는 rNPV 서식 하나만 받는다", () => {
    expect(formatsIn("217730", "강스템바이오텍", "Biotechnology", -567.6)).toEqual(["rnpv"]);
  });
});

describe.skip("한국 바이오는 접미사가 없어도 감지된다", () => {
  /**
   * 회귀 방지선. `needsKorBiotech`가 `ticker.includes(".KS")`로 한국을 판정하고 있었는데,
   * 티커를 접미사 없는 표준형(217730)으로 통일한 뒤로 이 조건이 어떤 한국 종목에도
   * 참이 되지 않았다. 그 결과 한국 바이오텍이 **하나도** rNPV를 받지 못했고
   * 강스템바이오텍이 DCF, 코오롱티슈진이 SOTP로 갔다.
   */
  it("적자 임상 바이오텍은 rNPV", () => {
    expect(modelsIn("217730", "강스템바이오텍", "Biotechnology")[0]).toBe("rNPV");
    expect(modelsIn("078160", "메디포스트", "Biotechnology")[0]).toBe("rNPV");
  });

  /**
   * 다만 rNPV는 "가치의 대부분이 아직 팔지 않은 파이프라인에 있는" 회사를 위한 방법이다.
   * 이미 이익을 내는 CDMO·바이오시밀러에 쓰면 벌고 있는 돈을 통째로 빼고 임상
   * 성공확률만 세게 된다.
   */
  it("흑자 바이오(CDMO·바이오시밀러)는 rNPV가 아니다", () => {
    const p = (t: string, n: string, opm: number) =>
      buildPrompt(RETIRED_STEP, t, n, "Biotechnology", null, [], null, "ko", null, { opm });
    for (const [t, n, opm] of [["207940", "삼성바이오로직스", 46.2], ["068270", "셀트리온", 28.1]] as const) {
      const all = p(t, n, opm).systemPrompt + p(t, n, opm).userPrompt;
      expect(all.match(MODEL_HEADER_ONE)?.[1]?.trim(), n).not.toBe("rNPV");
    }
  });

  it("지표가 없으면 예전처럼 업종으로 판단한다", () => {
    // 아직 수집되지 않은 종목에서 갑자기 동작이 달라지면 안 된다
    expect(modelsIn("217730", "강스템바이오텍", "Biotechnology")[0]).toBe("rNPV");
  });
});

describe.skip("공통 조율 규칙이 어느 모델에나 들어간다", () => {
  it("괴리율 처리와 3-way 금지가 항상 포함된다", () => {
    const targets: Array<[string, string, string]> = [
      ["005930", "삼성전자", "Consumer Electronics"],
      ["105560", "KB금융", "Banks - Regional"],
      ["PLD", "Prologis", "REIT - Industrial"],
    ];
    for (const [t, n, i] of targets) {
      const all = (() => {
        const p = buildPrompt(RETIRED_STEP, t, n, i, null, []);
        return p.systemPrompt + p.userPrompt;
      })();
      expect(all, n).toContain("괴리율 20% 이내");
      expect(all, n).toContain("괴리율 30% 초과");
      expect(all, n).toContain("3개 이상 방법론의 단순 평균 금지");
      expect(all, n).toContain("같은 값을 복사해 넣는 것을 금지");
    }
  });
});

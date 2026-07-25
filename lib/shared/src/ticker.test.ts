import { describe, it, expect } from "vitest";
import { normalizeTicker, isKoreanTicker, detectMarket, toYahooSymbol, safeTicker } from "./ticker";

// 이 파일은 "종목을 부르는 이름"의 계약을 고정한다.
// 여기가 흔들리면 지표 캐시·분석·종목 마스터가 전부 어긋난다
// (실제로 2026-07 지표 캐시 적중률이 0%였던 원인).

describe("normalizeTicker — 저장·조회 키의 표준형", () => {
  it("한국 종목의 거래소 접미사를 떼어낸다", () => {
    expect(normalizeTicker("005930.KS")).toBe("005930");
    expect(normalizeTicker("035720.KQ")).toBe("035720");
  });

  it("접미사 대소문자를 가리지 않는다", () => {
    expect(normalizeTicker("005930.ks")).toBe("005930");
    expect(normalizeTicker("005930.kq")).toBe("005930");
  });

  it("공백을 제거하고 미국 티커는 대문자로 맞춘다", () => {
    expect(normalizeTicker("  005930 ")).toBe("005930");
    expect(normalizeTicker("nvda")).toBe("NVDA");
  });

  it("이미 표준형이면 그대로 둔다 (여러 번 통과시켜도 안전)", () => {
    expect(normalizeTicker(normalizeTicker("005930.KS"))).toBe("005930");
    expect(normalizeTicker("NVDA")).toBe("NVDA");
  });

  it("빈 값은 빈 문자열로 돌려준다", () => {
    expect(normalizeTicker(null)).toBe("");
    expect(normalizeTicker(undefined)).toBe("");
    expect(normalizeTicker("")).toBe("");
  });
});

describe("시장 판별", () => {
  it("6자리 숫자는 한국", () => {
    expect(isKoreanTicker("005930")).toBe(true);
    expect(detectMarket("005930.KS")).toBe("KR");
  });

  it("영문 티커는 미국", () => {
    expect(isKoreanTicker("NVDA")).toBe(false);
    expect(detectMarket("NVDA")).toBe("US");
    expect(detectMarket("NTDOY")).toBe("US");
  });
});

describe("toYahooSymbol — 외부 호출 직전에만 쓰는 변환", () => {
  it("한국 종목은 거래소에 맞는 접미사를 붙인다", () => {
    expect(toYahooSymbol("005930", "KOSPI")).toBe("005930.KS");
    expect(toYahooSymbol("035720", "KOSDAQ")).toBe("035720.KQ");
  });

  it("거래소를 모르면 KOSPI로 가정한다", () => {
    expect(toYahooSymbol("005930")).toBe("005930.KS");
  });

  it("미국 종목은 그대로 둔다", () => {
    expect(toYahooSymbol("NVDA")).toBe("NVDA");
  });

  it("이미 접미사가 붙어 들어와도 중복해서 붙이지 않는다", () => {
    expect(toYahooSymbol("005930.KS", "KOSPI")).toBe("005930.KS");
  });
});

describe("safeTicker — 저장 전 형식 검사", () => {
  it("정상 티커는 표준형으로 통과시킨다", () => {
    expect(safeTicker("005930.KS")).toBe("005930");
    expect(safeTicker("nvda")).toBe("NVDA");
  });

  it("빈 값과 이상한 문자열은 거른다", () => {
    expect(safeTicker("")).toBeNull();
    expect(safeTicker(null)).toBeNull();
    expect(safeTicker("!!bad")).toBeNull();
  });
});

describe("회귀 — 지표 캐시 적중률 0% 사건", () => {
  // 저장은 야후 심볼(005930.KS), 조회는 분석 테이블 표기(005930)로 갈려
  // 한국 종목 120개 중 0개가 적중했다. 두 경로가 같은 키로 수렴해야 한다.
  it("야후 심볼로 저장하든 원형으로 조회하든 같은 키가 된다", () => {
    const 저장키 = normalizeTicker("005930.KS"); // financial-context가 넘기던 값
    const 조회키 = normalizeTicker("005930");    // analyses.ticker에 있는 값
    expect(저장키).toBe(조회키);
  });

  it("코스닥 종목도 마찬가지", () => {
    expect(normalizeTicker("035720.KQ")).toBe(normalizeTicker("035720"));
  });
});

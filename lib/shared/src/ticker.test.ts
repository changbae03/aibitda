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

  /**
   * KRX가 신규상장·스팩에 영문이 섞인 코드를 발급한다. 예전 규칙(6자리 전부 숫자)에서는
   * 이런 종목 55개가 "미국"으로 판정돼 KIS·DART 조회가 통째로 막혀 있었다.
   */
  it("영문이 섞인 신규 종목코드도 한국", () => {
    expect(isKoreanTicker("0004Y0"), "디비금융제14호스팩").toBe(true);
    expect(isKoreanTicker("0126Z0"), "삼성에피스홀딩스").toBe(true);
    expect(isKoreanTicker("0203K0"), "송우인포텍").toBe(true);
    expect(detectMarket("0156T0")).toBe("KR");
  });

  /**
   * 첫 글자를 숫자로 못박은 이유. 실제 데이터로 확인했다 —
   * 미국 10,448종목 중 숫자로 시작하는 티커는 0개, 6글자 티커는 전부 하이픈 우선주다.
   */
  it("미국 티커를 한국으로 오인하지 않는다", () => {
    expect(isKoreanTicker("GOOGL")).toBe(false);
    expect(isKoreanTicker("ICRPA")).toBe(false);
    expect(isKoreanTicker("ICR-PA")).toBe(false); // 6글자지만 하이픈
    expect(isKoreanTicker("ABCDEF")).toBe(false); // 6글자지만 숫자로 시작하지 않음
  });

  it("자릿수가 어긋나면 한국이 아니다", () => {
    expect(isKoreanTicker("00593")).toBe(false);   // 5자리
    expect(isKoreanTicker("0059300")).toBe(false); // 7자리
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

describe("미국 클래스주·우선주 티커 (SEC 목록에 544개)", () => {
  // SEC는 클래스주를 하이픈으로 쓴다(BRK-B, BF-A). 종목 목록을 SEC로 바꾸면서
  // 이 형식이 대량으로 들어온다. 표준화가 이들을 건드리면 안 된다.
  it("하이픈 티커를 손상시키지 않는다", () => {
    expect(normalizeTicker("BRK-B")).toBe("BRK-B");
    expect(normalizeTicker("BF-A")).toBe("BF-A");
    expect(safeTicker("MOG-A")).toBe("MOG-A");
  });

  it("하이픈 티커를 한국 종목으로 오인하지 않는다", () => {
    expect(detectMarket("BRK-B")).toBe("US");
    expect(toYahooSymbol("BRK-B")).toBe("BRK-B");
  });

  // 점이 든 티커는 예전 코드가 ticker.split(".")[0]으로 잘라 BRK만 남겼다.
  // 지금은 그 코드를 전부 normalizeTicker로 바꿨으므로 원형이 보존돼야 한다.
  it("점이 든 티커는 앞부분만 남기지 않고 그대로 둔다", () => {
    expect(normalizeTicker("BRK.B")).toBe("BRK.B");
    expect("BRK.B".split(".")[0]).toBe("BRK"); // 예전 방식이 손상시키던 모습
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

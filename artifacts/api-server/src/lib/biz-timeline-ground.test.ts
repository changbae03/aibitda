import { describe, it, expect } from "vitest";
import { findUngrounded, groundingScore, formatUngrounded, type YearSource } from "./biz-timeline-ground";

/** 메디포스트 사례를 축약한 것 — 설비투자 숫자는 2024년 원문에만 있다 */
const SOURCES: YearSource[] = [
  { bsnsYear: 2024, content: "유형자산은 136,795백만원으로 제대혈 보관탱크 취득에 517백만원, 기타 생산 및 영업설비 투자에 2,126백만원" },
  { bsnsYear: 2025, content: "국내 최초 제대조직 유래 줄기세포 보관 서비스를 시작하였습니다. 매출액 41,499백만원" },
];

describe("다른 해 숫자를 끌어온 것을 잡는다", () => {
  /**
   * 실제로 나온 문장이다. 저 세 숫자는 2024년 원문에만 있는데 2025년 값으로 적혔다.
   * 이 제품의 전제가 "원문 근거라 틀릴 수 없다"인데 첫 시험에서 바로 깨졌다.
   */
  const report = "2025년 유형자산은 136,795백만원으로, 제대혈 보관탱크 취득 517백만원이 사용되었습니다.";
  const claims = findUngrounded(report, SOURCES);

  it("근거 없는 숫자를 찾아낸다", () => {
    expect(claims.map(c => c.value)).toEqual(expect.arrayContaining(["136,795", "517"]));
  });

  it("어느 해 값을 끌어왔는지 알려준다", () => {
    expect(claims.find(c => c.value === "136,795")!.foundIn).toEqual([2024]);
  });

  it("보고문에 원인이 드러난다", () => {
    const t = formatUngrounded(claims)!;
    expect(t).toContain("2024년 원문에는 있음");
    expect(t).toContain("연도를 잘못 붙였습니다");
  });
});

describe("원문에 있는 숫자는 통과시킨다", () => {
  it("같은 해 원문에 있으면 문제 없음", () => {
    expect(findUngrounded("2025년 매출액은 41,499백만원입니다.", SOURCES)).toEqual([]);
  });

  it("쉼표 표기가 달라도 대조한다", () => {
    expect(findUngrounded("2024년 유형자산 136795백만원", SOURCES)).toEqual([]);
  });
});

describe("아무 데도 없는 값은 '지어냈다'고 한다", () => {
  it("어느 해에도 없으면 그렇게 알린다", () => {
    const claims = findUngrounded("2025년 수주잔고는 987,654백만원입니다.", SOURCES);
    expect(claims[0].foundIn).toEqual([]);
    expect(formatUngrounded(claims)).toContain("지어낸 값입니다");
  });
});

describe("애매하면 판정하지 않는다", () => {
  it("한 줄에 연도가 여럿이면 건너뛴다 — 어느 해 값인지 단정할 수 없다", () => {
    expect(findUngrounded("2024년과 2025년에 걸쳐 999,999백만원을 투자했습니다.", SOURCES))
      .toEqual([]);
  });

  it("우리가 안 가진 연도는 판정하지 않는다", () => {
    expect(findUngrounded("2019년 매출은 123,456백만원이었습니다.", SOURCES)).toEqual([]);
  });

  it("작은 수는 대조하지 않는다 — '2상', '3개년' 같은 것까지 잡으면 잡음만 는다", () => {
    expect(findUngrounded("2025년 임상 2상을 종료했고 3개 법인이 있습니다.", SOURCES)).toEqual([]);
  });

  /**
   * 처음에는 줄 안의 모든 숫자를 대조했더니 잡힌 것의 대부분이 날짜였다.
   * 2022년 사건을 2023년 보고서가 언급하는 것은 정상인데 "연도 오류"로 몰렸다.
   * 단위가 붙은 금액만 본다.
   */
  it("날짜는 대조하지 않는다", () => {
    expect(findUngrounded("2022년 대표이사가 변경되었습니다(2022.08.08).", SOURCES)).toEqual([]);
  });

  it("단위 없는 숫자는 대조하지 않는다", () => {
    expect(findUngrounded("2025년 특허 123456건을 보유합니다.", SOURCES)).toEqual([]);
  });

  it("연도 숫자 자체는 대조 대상이 아니다", () => {
    expect(findUngrounded("2025년 보고서입니다.", SOURCES)).toEqual([]);
  });
});

describe("근거 확인 비율", () => {
  it("전부 확인되면 1", () => {
    expect(groundingScore("2025년 매출액은 41,499백만원입니다.", SOURCES)).toBe(1);
  });

  it("절반이 틀리면 낮아진다", () => {
    const s = groundingScore(
      "2025년 매출액은 41,499백만원입니다.\n2025년 유형자산은 136,795백만원입니다.",
      SOURCES);
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });

  it("검증할 게 없으면 1 — 판정 못 한 것을 실패로 치지 않는다", () => {
    expect(groundingScore("이 회사는 성장하고 있습니다.", SOURCES)).toBe(1);
  });
});

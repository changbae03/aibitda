import { describe, it, expect } from "vitest";
import { parseEventDate, normalizeCategory, dedupeEvents, type UpcomingEvent } from "./event-format.js";

/**
 * 일정 추출의 안전망. 날짜를 잘못 읽으면 지난 일이 "내일 일정"으로 뜬다 —
 * 이 기능에서 가장 치명적인 오류라 여기를 두껍게 지킨다.
 */

const TODAY = "2026-08-11";

describe("날짜 해석 — 지난 일을 미래로 만들지 않는다", () => {
  it("완전한 날짜를 읽는다", () => {
    expect(parseEventDate("2026-08-14", TODAY)).toBe("2026-08-14");
    expect(parseEventDate("2026.08.14", TODAY)).toBe("2026-08-14");
  });

  it("월·일 표기를 읽는다", () => {
    expect(parseEventDate("8월 14일", TODAY)).toBe("2026-08-14");
  });

  it("일만 있으면 가장 가까운 미래로 본다 — 뉴스의 '12일'은 다가올 12일이다", () => {
    expect(parseEventDate("12일", TODAY)).toBe("2026-08-12");
  });

  it("이미 지난 날짜는 버린다", () => {
    expect(parseEventDate("2026-08-05", TODAY)).toBeNull();
    expect(parseEventDate("8월 3일", TODAY)).toBeNull();
  });

  it("일만 있고 이번 달이 지났으면 다음 달로 넘긴다", () => {
    // 오늘이 11일이므로 "5일"은 이번 달이 아니라 다음 달 5일
    expect(parseEventDate("5일", TODAY, 40)).toBe("2026-09-05");
  });

  it("너무 먼 미래는 버린다", () => {
    expect(parseEventDate("2026-12-25", TODAY, 30)).toBeNull();
  });

  it("날짜가 아닌 문자열은 null", () => {
    expect(parseEventDate("다음주 중", TODAY)).toBeNull();
    expect(parseEventDate("", TODAY)).toBeNull();
  });
});

describe("분류는 우리 목록 중 하나로 수렴한다", () => {
  it("정확한 값은 그대로", () => {
    expect(normalizeCategory("임상·허가")).toBe("임상·허가");
  });

  it("비슷한 말도 알아본다 — LLM이 뭐라 쓰든 흡수", () => {
    expect(normalizeCategory("FDA 승인")).toBe("임상·허가");
    expect(normalizeCategory("대통령 일정")).toBe("정부·정책");
    expect(normalizeCategory("수주 공시")).toBe("계약·수주");
    expect(normalizeCategory("MSCI 리밸런싱")).toBe("지수·수급");
  });

  it("모르는 값은 기타로", () => {
    expect(normalizeCategory("알수없음")).toBe("기타");
    expect(normalizeCategory(null)).toBe("기타");
  });
});

describe("같은 일정이 여러 기사로 들어와도 하나만 남는다", () => {
  const mk = (title: string, tickers: number, date = "2026-08-12"): UpcomingEvent => ({
    eventDate: date, title, category: "정부·정책", summary: null,
    tickers: Array.from({ length: tickers }, (_, i) => ({ name: `종목${i}` })),
    sectors: [], importance: 2, source: "news",
  });

  it("날짜+제목이 같으면 종목이 많은 쪽을 남긴다", () => {
    const out = dedupeEvents([mk("메가프로젝트 점검회의", 1), mk("메가프로젝트 점검회의", 3)]);
    expect(out).toHaveLength(1);
    expect(out[0].tickers).toHaveLength(3);
  });

  it("날짜가 다르면 별개다", () => {
    expect(dedupeEvents([mk("회의", 1, "2026-08-12"), mk("회의", 1, "2026-08-13")])).toHaveLength(2);
  });

  it("날짜 오름차순으로 정렬한다", () => {
    const out = dedupeEvents([mk("B", 1, "2026-08-14"), mk("A", 1, "2026-08-12")]);
    expect(out.map(e => e.eventDate)).toEqual(["2026-08-12", "2026-08-14"]);
  });
});

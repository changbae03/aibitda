import { describe, it, expect } from "vitest";
import { parseEventDate, normalizeCategory, dedupeEvents, type UpcomingEvent, isMarketRelevant } from "./event-format.js";

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

describe("주가와 무관한 지역 행사는 담지 않는다", () => {
  /**
   * 프롬프트로 "지자체 행사는 빼라"고 해도 샜다 — "속초 대포항 야간공연 '대포야 사랑해'"에
   * 강원랜드를 붙여 화면에 내보냈다. 지시는 확률이고 규칙은 확정이라 코드로 막는다.
   */
  it("공연·축제·기념식을 걸러낸다", () => {
    for (const t of [
      "속초 대포항 야간공연 '대포야 사랑해' 개최",
      "제4회 다대포선셋영화축제 개막",
      "한교총 광복 81주년 기념예배",
      "이천시 지역사회보장계획 주민 공청회",
      "고흥군 2026년산 햅쌀 예약판매 시작",
      "광명도시공사 공영주차장 다자녀 할인 확대",
      "호찌민시 1학년 및 졸업반 학생 등교",
    ]) {
      expect(isMarketRelevant(t), t).toBe(false);
    }
  });

  it("진짜 재료는 통과시킨다", () => {
    for (const t of [
      "SK스퀘어 8월 19일 실적발표",
      "혁신형 제약 인증 접수 시작",
      "인제니아, 코스닥 상장",
      "미국, 캐나다산 일부 제품 50% 추가 관세 발효",
      "NeOnc, 임상 2a상 결과 발표",
      "응에안성 3개 주요 프로젝트 건설 시작",
    ]) {
      expect(isMarketRelevant(t), t).toBe(true);
    }
  });

  it("dedupeEvents가 잡음을 통째로 뺀다", () => {
    const mk = (title: string): UpcomingEvent => ({
      eventDate: "2026-08-16", title, category: "기타", summary: null,
      tickers: [], sectors: [], importance: 1, source: "news",
    });
    const out = dedupeEvents([mk("속초 대포항 야간공연 개최"), mk("SK스퀘어 실적발표")]);
    expect(out).toHaveLength(1);
    expect(out[0].title).toContain("SK스퀘어");
  });
});

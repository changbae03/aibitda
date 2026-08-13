import { describe, it, expect } from "vitest";
import { parseEventDate, normalizeCategory, dedupeEvents, type UpcomingEvent, isMarketRelevant, isMarketRelevantSource, isOngoingVisit, dateEvidenceSupports } from "./event-format.js";

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

  /**
   * 날짜로 훑는 질의는 그날 일정이 적힌 **모든** 기사를 끌어온다.
   * 실측(2026-08-15 "8월 15일" 예정): 아이돌 방송 안내·굿즈 발매·파리 전시,
   * 그리고 Vietnam.vn의 하띤 사회주택 추첨이 그대로 일정으로 올라왔다.
   */
  it("증시와 무관한 매체는 출처에서 끊는다", () => {
    for (const src of [
      "https://www.vietnam.vn Vietnam.vn",
      "https://www.sortiraparis.com Sortir à Paris",
      "https://weverse.io Weverse",
      "https://olympics.com olympics.com",
      "https://www.insidevina.com 인사이드비나",
    ]) {
      expect(isMarketRelevantSource(src), src).toBe(false);
    }
  });

  it("종합지·경제지는 막지 않는다 — 같은 매체가 증시 기사도 쓴다", () => {
    for (const src of [
      "https://biz.heraldcorp.com 헤럴드경제",
      "https://www.hankyung.com 한국경제",
      "https://www.yna.co.kr 연합뉴스",
      "https://www.kookje.co.kr 국제신문",
      "", // 출처를 못 읽었으면 막지 않는다
    ]) {
      expect(isMarketRelevantSource(src), src).toBe(true);
    }
  });

  it("날짜 질의가 끌어온 생활 잡음도 제목에서 막는다", () => {
    for (const t of [
      "택배 없는 날",
      "제천시 공습 대비 민방위 대피훈련",
      "감리회 감독선거 선거권자 확정",
      "하띤 시범 사회주택 온라인 추첨",
      "NH농협은행 창립기념일 기념 음악회",
    ]) {
      expect(isMarketRelevant(t), t).toBe(false);
    }
  });

  it("대회·공연·소비자 박람회를 막는다 — 날짜 질의가 '개막'으로 끌어온 것들", () => {
    for (const x of [
      "구례 여자씨름 왕중왕전 개막",
      "2026 대구 세계마스터즈육상경기대회 개막",
      "뮤지컬 '엘리자벳' 개막",
      "덕적도 '주섬주섬 음악회' 개막",
      "대전 첫 코베 베이비페어 개막",
      "의왕역 한신더휴 견본주택 오픈",
      "에이치플러스 양지병원 성형외과 진료 시작",
    ]) {
      expect(isMarketRelevant(x), x).toBe(false);
    }
  });

  it("산업 전시회·실적은 그대로 통과시킨다", () => {
    for (const x of [
      "반도체 국제전시회 세미콘 개막",
      "SK스퀘어 실적 발표",
      "인제니아 코스닥 상장",
      "광저우 국제 자동차 부품 전시회 개막",
    ]) {
      expect(isMarketRelevant(x), x).toBe(true);
    }
  });

  it("공모주 청약은 막지 않는다 — 주택 추첨과 다르다", () => {
    expect(isMarketRelevant("인제니아 공모주 청약 접수 시작")).toBe(true);
  });

  /**
   * 실측(2026-08-14 로그): "빌 게이츠 방한, SMR 협력 논의"가 날짜 검산기에 걸려
   * 통째로 버려졌다 — 근거 "빌 게이츠, 소형모듈원전 협력 논의차 방한"에 일(日)이 없어서다.
   * 이런 기사에는 날짜가 안 적힌다. 이미 와 있고, 협력 논의가 그 뒤에 이어진다.
   */
  it("방한·순방은 날짜 근거가 없어도 살린다", () => {
    for (const t of [
      "빌 게이츠, 소형모듈원전 협력 논의차 방한",
      "왕이 외교부장 방한 예정",
      "젠슨 황 내한, 국내 협력사와 회동",
      "대통령 중동 순방 시작",
    ]) {
      expect(isOngoingVisit(t), t).toBe(true);
    }
  });

  it("일반 회의·행사까지 넓히지 않는다 — 지난 회의가 오늘로 올라오던 버그", () => {
    for (const t of [
      "민관합동 점검회의 개최",
      "국가바이오혁신위원회 첫 회의",
      "반도체 국제 전시회 개막",
    ]) {
      expect(isOngoingVisit(t), t).toBe(false);
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

describe("생활행정·지역행사를 코드로 거른다 — 실측으로 새어나온 것들", () => {
  /**
   * 프롬프트에 "지자체 행사는 빼라"고 적어놨는데도 화면에 떴다. 지시는 확률이고
   * 규칙은 확정이라 코드로 막는다. 게다가 '반려마루' 건에는 대한제분·우성까지
   * 종목으로 붙어 있었다 — 억지로 붙이지 말라는 지시도 안 지켜졌다.
   */
  it.each([
    "하남시 '성년 축하금' 조례안 본회의 의결",
    "경기도, '반려마루 검은 개의 날' 개최",
    "여수시의회, COP33 유치 성공 전략 토론회 개최",
    "속초 대포항 야간공연 '대포야 사랑해'",
    "제30회 바다의 날 기념행사",
  ])("버린다: %s", (title) => {
    expect(isMarketRelevant(title)).toBe(false);
  });

  it.each([
    "케이앤에스아이앤씨 신규상장",
    "에스폴리텍, 10억 규모 자사주 매입 시작",
    "사천시, 수소충전소 상업운영 개시",   // 지자체가 주어여도 산업 재료면 남긴다
    "경제관계장관회의 개최",
    "SK하이닉스 HBM4 양산 시작",
    "미국과 이란, 휴전 연장 합의 시한",
  ])("남긴다: %s", (title) => {
    expect(isMarketRelevant(title)).toBe(true);
  });

  it("한글에는 단어 경계(\\b)가 없다 — '검은 개의 날'이 그대로 통과했었다", () => {
    expect(isMarketRelevant("경기도, '반려마루 검은 개의 날' 개최")).toBe(false);
  });
});

/**
 * 실제 사고: 8월 10일에 열린 "메가프로젝트 2차 민관합동 점검회의"가 8월 13일
 * 일정으로 들어갔다. 사용자가 "3일 전에 했던 이벤트"라고 알려줘서 발견했다.
 */
describe("날짜는 근거와 대조한다", () => {
  it("근거의 날짜가 다르면 버린다 — 메가프로젝트 회귀", () => {
    expect(dateEvidenceSupports("2026-08-13", "지난 10일 메가프로젝트 점검회의를 주재했다")).toBe(false);
  });

  it("근거에 그 날이 있으면 받는다", () => {
    expect(dateEvidenceSupports("2026-08-19", "오는 19일 실적 발표")).toBe(true);
    expect(dateEvidenceSupports("2026-08-20", "8월 20일 개막")).toBe(true);
  });

  it("오늘·내일 같은 상대 표현도 근거로 인정한다", () => {
    expect(dateEvidenceSupports("2026-08-14", "내일 총리·회장과 면담")).toBe(true);
  });

  it("근거가 비면 통과시키지 않는다 — 지어낸 날짜를 막는다", () => {
    expect(dateEvidenceSupports("2026-08-13", "")).toBe(false);
  });
});

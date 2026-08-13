/**
 * region-match.ts — 검색어·일정 제목에서 **지역**을 알아낸다.
 *
 * theme-search에서 떼어냈다. 그쪽은 DB(pool)를 모듈 로드 시점에 붙잡아서
 * 테스트에서 불러올 수 없다 — 이 규칙은 틀리면 엉뚱한 종목이 붙으므로
 * 반드시 테스트가 지켜야 한다(저장소 규칙: 순수 함수는 따로 둔다).
 */

/** 광역 지명 → 그 권역에서 함께 볼 지명들. 사람은 "광주"라 치지만 시설은 인근 시·군에 있다. */
export const REGION_MAP: Record<string, string[]> = {
  광주: ["광주", "전남", "나주", "화순", "장성", "함평"],
  전남: ["전남", "여수", "순천", "광양", "목포", "나주", "영광"],
  전북: ["전북", "전주", "익산", "군산", "완주"],
  호남: ["광주", "전남", "전북", "나주", "여수", "순천", "익산", "군산"],
  대구: ["대구", "경북", "구미", "포항", "경산"],
  부산: ["부산", "경남", "김해", "양산", "창원"],
  울산: ["울산"],
  대전: ["대전", "충남", "세종", "천안", "아산"],
  충북: ["충북", "청주", "음성", "진천"],
  충남: ["충남", "천안", "아산", "당진", "서산"],
  경기: ["경기", "평택", "화성", "이천", "용인", "안성"],
  강원: ["강원", "원주", "강릉", "동해"],
  제주: ["제주"],
};

/** 검색어에서 지역을 알아낸다. 없으면 빈 배열 — 지역 검색이 아니다. */
/**
 * 지역명이 **낱말로** 나왔는가. 그냥 `includes`면 다른 말 안에서 걸린다.
 *
 * 실측: 베트남 지명 "응에안성"이 경기도 "안성"으로 잡혀, 그 일정에 한국석유가
 * "안성 인근 생산시설"로 붙었다. 앞 글자가 한글이면 그 지역명이 아니다
 * (사업보고서 검색 쪽에 이미 같은 관문을 뒀다 — "성장성"의 "장성"이 같은 사고였다).
 *
 * 뒤는 막지 않는다. "광주광역시"·"부산국제"처럼 뒤에 말이 붙는 건 그 지역이 맞다.
 */
export function mentionsRegion(text: string, region: string): boolean {
  let i = text.indexOf(region);
  while (i >= 0) {
    const before = i > 0 ? text[i - 1]! : "";
    if (!/[가-힣]/.test(before)) return true;
    i = text.indexOf(region, i + 1);
  }
  return false;
}

export function detectRegions(text: string): string[] {
  const s = String(text ?? "");
  for (const [key, group] of Object.entries(REGION_MAP)) {
    if (mentionsRegion(s, key)) return group;
  }
  // 광역이 아니라 시·군만 친 경우(예: "여수")도 잡는다
  for (const group of Object.values(REGION_MAP)) {
    const hit = group.find(g => mentionsRegion(s, g));
    if (hit) return [hit];
  }
  return [];
}

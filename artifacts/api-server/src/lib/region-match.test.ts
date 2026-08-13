import { describe, it, expect } from "vitest";
import { detectRegions, mentionsRegion } from "./region-match.js";

/**
 * 지역 판정의 안전망.
 *
 * 이 기능이 틀리면 **엉뚱한 종목이 일정에 붙는다.** 실제로 베트남 "응에안성" 기사에
 * 한국석유가 "안성 인근 생산시설"로 붙어 나갔다. 같은 사고가 사업보고서 검색에서도
 * 있었다("성장성"의 "장성" → 대원강업이 광주 지역주로).
 */
describe("지역명은 낱말로만 잡는다", () => {
  it("앞 글자가 한글이면 지역명이 아니다 — 응에안성 회귀", () => {
    expect(mentionsRegion("응에안성, 3개 주요 프로젝트 건설 시작", "안성")).toBe(false);
    expect(detectRegions("응에안성, 3개 주요 프로젝트 건설 시작")).toEqual([]);
  });

  it("성장성의 '장성'을 지역으로 읽지 않는다", () => {
    expect(mentionsRegion("매출 성장성이 뚜렷하다", "장성")).toBe(false);
  });

  it("뒤에 말이 붙는 건 그 지역이 맞다", () => {
    expect(mentionsRegion("광주광역시 반도체 클러스터", "광주")).toBe(true);
    expect(mentionsRegion("안성시 물류센터 착공", "안성")).toBe(true);
  });

  it("띄어 쓰거나 문장 첫머리에 오면 잡는다", () => {
    expect(mentionsRegion("여수 국가산단 투자 계획", "여수")).toBe(true);
    expect(detectRegions("전남 여수 국가산단 투자 계획").length).toBeGreaterThan(0);
  });
});

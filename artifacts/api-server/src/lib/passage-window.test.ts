import { describe, it, expect } from "vitest";
import { buildReadableDoc, isProseLine, sectionOf } from "./passage-window.js";

// 서전기전(189860) 2026년 반기보고서에서 그대로 가져온 조각.
// 실제로 "뒤 문맥"에 이미지 파일명이 나왔던 대목이다.
const DOC = [
  "### [사업개요]",
  "1. 사업의 개요",
  "전력변환기기 산업은 전기기기 산업에 속하며, 발전소에서 생산된 전력이 송전선 및 변전소를 거쳐 전압이 변환되는 전력계통에서 배전계통에 필요한 전력기자재를 제조·납품 및 판매하는 산업입니다.",
  "emb00001cd420ed.jpg",
  // ⚠️ 한글이 섞인 이미지 줄이 실제로 48개 있다("국내사업본부 조직도_260331.jpg").
  // 길이·한글 규칙만으로는 안 걸러진다 — 확장자 규칙이 있어야 한다.
  "국내사업본부 조직도_260331.jpg",
  "전력의 흐름도 (전력계통)",
  "당사가 영위하고 있는 전력변환기기 산업은 중전기기 산업에서 전원용 전력기기 산업에 해당됩니다.",
  "### [주요제품]",
  "(기준일 : 2026년 06월 30일)",
  "(단위 : 백만원)",
  "5,028",
  "25.8%",
  "당사가 제조 및 납품·판매하고 있는 수배전반 및 전력기기 제품은 전력계통에서 사용되고 있습니다.",
].join("\n");

describe("원문 손질", () => {
  it("이미지 파일명과 표 셀을 걸러낸다", () => {
    const lines = buildReadableDoc(DOC, ["전력변환기기"]);
    const texts = lines.map(l => l.text);
    expect(texts.some(t => t.includes(".jpg")), texts.join(" | ")).toBe(false);
    expect(texts).not.toContain("25.8%");
    expect(texts).not.toContain("5,028");
    expect(texts.some(t => t.startsWith("(기준일"))).toBe(false);
  });

  it("절 제목은 남기고 본문과 구분한다", () => {
    const lines = buildReadableDoc(DOC, []);
    const sections = lines.filter(l => l.kind === "section").map(l => l.text);
    expect(sections).toEqual(["사업개요", "주요제품"]);
  });

  it("검색어가 걸린 줄을 표시한다 — 화면이 여기로 찾아간다", () => {
    const lines = buildReadableDoc(DOC, ["전력변환기기"]);
    const hit = lines.filter(l => l.hits.includes("전력변환기기"));
    expect(hit.length).toBeGreaterThanOrEqual(2);
  });

  it("문맥이 통째로 남는다 — 문장 하나만 잘라내지 않는다", () => {
    // 검색어가 걸린 줄만이 아니라 그 앞뒤 설명도 함께 있어야 한다
    const lines = buildReadableDoc(DOC, ["전력변환기기"]);
    const texts = lines.map(l => l.text);
    expect(texts.some(t => t.includes("수배전반 및 전력기기 제품은"))).toBe(true);
  });

  it("본문 없이 제목만 남는 절은 지운다", () => {
    const lines = buildReadableDoc("### [빈절]\n25.8%\n### [내용절]\n실제 사업 내용을 설명하는 충분히 긴 문장입니다.", []);
    expect(lines.map(l => l.text)).toEqual(["내용절", "실제 사업 내용을 설명하는 충분히 긴 문장입니다."]);
  });
});

describe("줄 판정", () => {
  it("짧은 표 셀은 본문이 아니다", () => {
    expect(isProseLine("25.8%")).toBe(false);
    expect(isProseLine("수배전반")).toBe(false);
  });
  it("숫자·기호가 대부분이면 본문이 아니다", () => {
    expect(isProseLine("2026년 반기 5,028 25.8% 27,549 40.5%")).toBe(false);
  });
  it("절 표시를 읽어낸다", () => {
    expect(sectionOf("### [사업개요]")).toBe("사업개요");
    expect(sectionOf("전력변환기기 산업은")).toBeNull();
  });
});

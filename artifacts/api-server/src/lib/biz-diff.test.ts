import { describe, it, expect } from "vitest";
import {
  extractSegments, segmentsFromContent, diffSegments, renderSegmentDiff,
  type SegmentPeriod,
} from "./biz-diff";

/**
 * DART 매출비중 표를 htmlToText 통과 후 모양으로 재현한다.
 * 실제 종목(메디포스트·삼성·SK하이닉스)의 서로 다른 표 서식을 픽스처로 고정한다 —
 * 이 세 형태가 깨지면 부문 추출 전체가 무너진다.
 */
describe("매출비중 표에서 사업부문을 뽑는다", () => {
  it("바이오(메디포스트) — %가 붙은 비율", () => {
    const t = [
      "사업부문", "매출유형", "품목", "구체적용도", "매출액", "비율",
      "제대혈은행", "제품", "제대혈 보관", "난치성 질환", "41,499", "56.4%",
      "줄기세포치료제", "제품", "동종줄기세포치료제,CDMO", "연골재생", "19,460", "26.4%",
      "합 계", "-", "-", "-", "73,656", "100.0%",
    ].join("\n");
    expect(extractSegments(t)).toEqual(["제대혈은행", "줄기세포치료제"]);
  });

  it("유통(롯데쇼핑) — % 없는 비율 숫자(24.3)", () => {
    const t = [
      "부  문", "주요 제품", "매출액", "비중",
      "백화점", "의류 등 상품", "3,339,352", "24.3",
      "할인점", "식품 등 상품", "5,471,330", "39.8",
      "총 계", "13,700,000", "100.0",
    ].join("\n");
    expect(extractSegments(t)).toEqual(["백화점", "할인점"]);
  });

  it("반도체(SK하이닉스) — 매출액(비율) 병합 셀", () => {
    const t = [
      "사업부문", "매출유형", "품목", "구체적용도", "주요상표등", "매출액(비율)",
      "반도체 부문", "제품 외", "DRAM, NAND Flash 등", "산업용", "SK하이닉스", "97,146,675(100%)",
    ].join("\n");
    expect(extractSegments(t)).toEqual(["반도체 부문"]);
  });

  it("매출유형 값(제품·상품)이나 합계를 부문명으로 오인하지 않는다", () => {
    const segs = extractSegments([
      "사업부문", "매출액", "비율",
      "A부문", "제품", "100", "60.0",
      "합 계", "160", "100.0",
    ].join("\n"));
    expect(segs).toEqual(["A부문"]);
    expect(segs).not.toContain("제품");
    expect(segs).not.toContain("합 계");
  });

  it("content의 주요제품·매출수주 소분류 범위에서만 뽑는다", () => {
    const content =
      "### [사업개요]\n부  문\n엉뚱한부문\n99.9\n" +   // 개요의 표는 무시해야 한다
      "### [주요제품]\n부  문\n주요 제품\n비중\n진짜부문\n상품\n50.0\n";
    expect(segmentsFromContent(content)).toEqual(["진짜부문"]);
  });
});

describe("연간 부문 집합을 대조해 신규·소멸을 가른다", () => {
  const P = (year: number, segs: string[]): SegmentPeriod =>
    ({ bsnsYear: year, quarter: 4, periodLabel: `${year}년 연간`, segments: segs });

  it("사라진 부문·새 부문·유지 부문을 각각 가른다", () => {
    const d = diffSegments([
      P(2022, ["A", "B", "C"]),
      P(2023, ["A", "B"]),
      P(2024, ["A", "D"]),
    ]);
    expect(d.disappeared.map(x => x.name).sort()).toEqual(["B", "C"]);
    expect(d.appeared.map(x => x.name)).toEqual(["D"]);
    expect(d.stable).toEqual(["A"]);
  });

  it("분기·반기는 비교에서 제외한다 — 부문 표 생략을 소멸로 오인하면 안 된다", () => {
    const d = diffSegments([
      P(2022, ["A", "B"]),
      { bsnsYear: 2023, quarter: 2, periodLabel: "2023년 상반기", segments: [] }, // 반기: 무시
      P(2023, ["A", "B"]),
    ]);
    expect(d.disappeared).toEqual([]);
    expect(d.stable.sort()).toEqual(["A", "B"]);
  });

  it("연간이 하나뿐이면 비교 불가 — 빈 결과", () => {
    expect(diffSegments([P(2024, ["A", "B"])])).toEqual({ appeared: [], disappeared: [], stable: [] });
  });

  it("변화가 없으면 렌더는 빈 문자열 — 잡음을 만들지 않는다", () => {
    expect(renderSegmentDiff(diffSegments([P(2022, ["A"]), P(2023, ["A"])]))).toBe("");
  });

  it("소멸이 있으면 렌더에 사라진 기간이 찍힌다", () => {
    const out = renderSegmentDiff(diffSegments([P(2022, ["A", "B"]), P(2023, ["A"])]));
    expect(out).toContain("사라진 부문");
    expect(out).toContain("B(2022년 연간 이후 목록에서 빠짐)");
  });
});

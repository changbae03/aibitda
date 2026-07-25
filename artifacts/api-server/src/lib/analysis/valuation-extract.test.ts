import { describe, it, expect } from "vitest";
import { extractValuation, extractSegmentForecasts } from "./valuation-extract";

// 아래 문자열은 2026-07-25 메디포스트(078160) 실제 분석 본문에서 그대로 가져온 것이다.
// 형식이 바뀌면 이 테스트가 먼저 깨져야 한다 — 조용히 수치가 안 쌓이는 상황을 막는 게 목적.
const REAL = `
| **12개월 적정주가** | **18,000원** | — |

SEGMENT_FORECAST_DATA:{"currency":"KRW","segments":[{"name":"제대혈 및 기타","rev26":420,"rev27":430,"op26":54.6,"op27":51.6},{"name":"카티스템","rev26":323.6,"rev27":425.1,"op26":-677.2,"op27":-507.9}]}
FINAL_VALUATION_DATA:{"current":8080,"bear":12000,"base":18000,"bull":22910,"abs_model":"rNPV+SOTP","abs_bear":16000,"abs_base":22910,"abs_bull":30220,"rel_bear":10225,"rel_base":12000,"rel_bull":12000}
`;

describe("extractValuation — 실제 분석 본문", () => {
  it("11개 필드를 모두 뽑아낸다 (예전엔 base 하나만 썼다)", () => {
    const v = extractValuation(REAL)!;
    expect(v).not.toBeNull();
    expect(v.currentPrice).toBe(8080);
    expect(v.bear).toBe(12000);
    expect(v.base).toBe(18000);
    expect(v.bull).toBe(22910);
    expect(v.absModel).toBe("rNPV+SOTP");
    expect(v.absBear).toBe(16000);
    expect(v.absBase).toBe(22910);
    expect(v.absBull).toBe(30220);
    expect(v.relBear).toBe(10225);
    expect(v.relBase).toBe(12000);
    expect(v.relBull).toBe(12000);
  });

  it("블록이 없으면 null (본문에 없는 걸 지어내지 않는다)", () => {
    expect(extractValuation("밸류에이션 블록이 없는 평범한 본문")).toBeNull();
  });

  it("목표가가 하나도 없으면 저장하지 않는다", () => {
    expect(extractValuation(`FINAL_VALUATION_DATA:{"current":8080}`)).toBeNull();
  });

  it("구형 표기(target)도 base로 받아준다", () => {
    expect(extractValuation(`FINAL_VALUATION_DATA:{"target":15000}`)!.base).toBe(15000);
  });

  it("콤마·단위가 붙은 문자열도 숫자로 바꾼다", () => {
    expect(extractValuation(`FINAL_VALUATION_DATA:{"base":"18,000원"}`)!.base).toBe(18000);
  });
});

describe("extractSegmentForecasts — 부문별 실적 전망", () => {
  it("부문×연도 조합마다 한 행으로 펼친다", () => {
    const rows = extractSegmentForecasts(REAL);
    expect(rows).toHaveLength(4); // 2개 부문 × 2개 연도

    const kati26 = rows.find((r) => r.segmentName === "카티스템" && r.fiscalYear === 2026)!;
    expect(kati26.revenue).toBe(323.6);
    expect(kati26.operatingIncome).toBe(-677.2);
    expect(kati26.currency).toBe("KRW");

    const cord27 = rows.find((r) => r.segmentName === "제대혈 및 기타" && r.fiscalYear === 2027)!;
    expect(cord27.revenue).toBe(430);
    expect(cord27.operatingIncome).toBe(51.6);
  });

  it("두 자리 연도를 2000년대로 해석한다", () => {
    expect([...new Set(extractSegmentForecasts(REAL).map((r) => r.fiscalYear))].sort())
      .toEqual([2026, 2027]);
  });

  it("3년치가 와도 표 변경 없이 그대로 담는다", () => {
    const rows = extractSegmentForecasts(
      `SEGMENT_FORECAST_DATA:{"currency":"KRW","segments":[{"name":"A","rev26":1,"rev27":2,"rev28":3}]}`
    );
    expect(rows.map((r) => r.fiscalYear)).toEqual([2026, 2027, 2028]);
  });

  it("블록이 없으면 빈 배열", () => {
    expect(extractSegmentForecasts("아무것도 없음")).toEqual([]);
  });

  it("이름 없는 부문과 값이 비어 있는 연도는 버린다", () => {
    const rows = extractSegmentForecasts(
      `SEGMENT_FORECAST_DATA:{"segments":[{"name":"","rev26":10},{"name":"B","rev26":null,"op26":null,"rev27":5}]}`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ segmentName: "B", fiscalYear: 2027, revenue: 5 });
  });

  it("통화 표기가 없으면 KRW로 둔다", () => {
    const rows = extractSegmentForecasts(`SEGMENT_FORECAST_DATA:{"segments":[{"name":"A","rev26":1}]}`);
    expect(rows[0].currency).toBe("KRW");
  });
});

import { describe, it, expect } from "vitest";
import {
  aggregateEmployees, renderHeadcount,
  extractCustomerConcentration, renderCustomerConcentration,
  type EmpRow,
} from "./company-facts";

describe("직원현황을 합쳐 총원·근속을 낸다", () => {
  // SK하이닉스 2025: 반도체 부문 남/여
  const rows: EmpRow[] = [
    { fo_bbm: "반도체", sexdstn: "남", rgllbr_co: "22,988", cnttk_co: "49", sm: "23,037", avrg_cnwk_sdytrn: "12.3" },
    { fo_bbm: "반도체", sexdstn: "여", rgllbr_co: "11,478", cnttk_co: "34", sm: "11,512", avrg_cnwk_sdytrn: "15.7" },
  ];

  it("부문·성별 행을 합쳐 총원을 낸다", () => {
    const h = aggregateEmployees(rows, 2025)!;
    expect(h.total).toBe(23037 + 11512);
    expect(h.regular).toBe(22988 + 11478);
    expect(h.contract).toBe(49 + 34);
  });

  it("평균 근속은 인원 가중 평균", () => {
    const h = aggregateEmployees(rows, 2025)!;
    // (12.3*23037 + 15.7*11512) / 34549 = 13.43
    expect(h.avgTenure!.toFixed(1)).toBe("13.4");
  });

  it("빈 입력·총원 0이면 null", () => {
    expect(aggregateEmployees([], 2025)).toBeNull();
    expect(aggregateEmployees([{ sm: "0" }], 2025)).toBeNull();
  });

  it("계산 가능한 해가 없으면 렌더는 빈 문자열", () => {
    expect(renderHeadcount([])).toBe("");
  });
});

describe("재무제표 주석에서 고객 집중도를 뽑는다", () => {
  // SK하이닉스 2025 주석 실제 문장
  const note =
    "당기 중 단일 외부고객으로부터의 매출액이 연결회사 전체 매출액의 10%를 상회하는 고객 (가)로부터 " +
    "발생한 매출액은 23,260,076백만원이며, 전기 중 단일 외부고객으로부터 발생한 매출액은 10,902,817백만원입니다.";

  it("당기·전기 주요고객 매출을 원 단위로 뽑는다", () => {
    const c = extractCustomerConcentration(note)!;
    expect(c.thisAmount).toBe(23_260_076 * 1e6);
    expect(c.priorAmount).toBe(10_902_817 * 1e6);
  });

  it("전체 매출을 주면 비중(%)을 렌더에 넣는다", () => {
    const c = extractCustomerConcentration(note);
    const out = renderCustomerConcentration(c, 97_146_675 * 1e6);
    expect(out).toContain("약 24%");
    expect(out).toContain("증가");
  });

  it("단일 10%+ 고객이 없으면(문구 부재) null → 빈 렌더", () => {
    expect(extractCustomerConcentration("당사는 다수의 고객에게 제품을 공급합니다.")).toBeNull();
    expect(renderCustomerConcentration(null, 1000)).toBe("");
  });
});

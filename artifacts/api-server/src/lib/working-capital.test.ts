import { describe, it, expect } from "vitest";
import {
  computeWorkingCapital, renderWorkingCapital, computeCapex, renderCapex, type DartRow,
} from "./working-capital";

/** SK하이닉스 2025 전체 재무제표에서 운전자본 계정만 옮긴 픽스처(억원 아님, 원 단위) */
const HYNIX: DartRow[] = [
  { sj_div: "BS",  account_id: "ifrs-full_Inventories", account_nm: "재고자산",
    thstrm_amount: "142894", frmtrm_amount: "133139", bfefrmtrm_amount: "134807" },
  { sj_div: "BS",  account_id: "ifrs-full_CurrentTradeReceivables", account_nm: "매출채권",
    thstrm_amount: "181991", frmtrm_amount: "130190", bfefrmtrm_amount: "66003" },
  { sj_div: "BS",  account_id: "ifrs-full_TradeAndOtherCurrentPayablesToTradeSuppliers", account_nm: "매입채무",
    thstrm_amount: "28485", frmtrm_amount: "22773", bfefrmtrm_amount: "18455" },
  { sj_div: "CIS", account_id: "ifrs-full_CostOfSales", account_nm: "매출원가",
    thstrm_amount: "384559", frmtrm_amount: "343648", bfefrmtrm_amount: "332992" },
  { sj_div: "CIS", account_id: "ifrs-full_Revenue", account_nm: "매출액",
    thstrm_amount: "971467", frmtrm_amount: "661930", bfefrmtrm_amount: "327657" },
];

describe("운전자본을 재무제표에서 계산한다", () => {
  const wc = computeWorkingCapital(HYNIX, 2025);

  it("한 보고서에서 3개년을 뽑는다 (당기·전기·전전기)", () => {
    expect(wc.map(y => y.year)).toEqual([2023, 2024, 2025]);
  });

  it("DIO = 재고 ÷ (매출원가/365) 를 정확히 계산한다", () => {
    const y25 = wc.find(y => y.year === 2025)!;
    // 142894 / (384559/365) = 135.6
    expect(Math.round(y25.dio!)).toBe(136);
  });

  it("CCC = DIO + DSO − DPO", () => {
    const y25 = wc.find(y => y.year === 2025)!;
    expect(Math.round(y25.ccc!)).toBe(Math.round(y25.dio! + y25.dso! - y25.dpo!));
    expect(Math.round(y25.ccc!)).toBe(177);
  });

  it("추세가 보인다 — 하이닉스 CCC는 하락(개선)", () => {
    const ccc = wc.map(y => Math.round(y.ccc!));
    expect(ccc).toEqual([201, 189, 177]);
  });

  it("IFRS 코드가 없어도 한글명 정확일치로 잡는다", () => {
    const noId: DartRow[] = HYNIX.map(r => ({ ...r, account_id: undefined }));
    const y = computeWorkingCapital(noId, 2025).find(x => x.year === 2025)!;
    expect(Math.round(y.dio!)).toBe(136);
  });
});

describe("계산 불가·잡음 방지", () => {
  it("매출원가·재고가 없는 금융업은 빈 배열 → 빈 렌더", () => {
    const bank: DartRow[] = [
      { sj_div: "CIS", account_id: "ifrs-full_Revenue", account_nm: "영업수익", thstrm_amount: "500000" },
    ];
    // 재고·매출원가가 없으니 DIO/CCC는 null이고 표는 나오지 않는다
    const wc = computeWorkingCapital(bank, 2025);
    expect(renderWorkingCapital(wc)).toBe("");
  });

  it("매출원가가 0/음수면 나눗셈을 하지 않는다(무한대 방지)", () => {
    const bad: DartRow[] = [
      { sj_div: "BS", account_id: "ifrs-full_Inventories", account_nm: "재고자산", thstrm_amount: "1000" },
      { sj_div: "CIS", account_id: "ifrs-full_CostOfSales", account_nm: "매출원가", thstrm_amount: "0" },
    ];
    expect(computeWorkingCapital(bad, 2025)[0]?.dio ?? null).toBeNull();
  });

  it("변화 없이 계산 가능한 해가 없으면 렌더는 빈 문자열", () => {
    expect(renderWorkingCapital([])).toBe("");
  });
});

describe("CapEx를 현금흐름표에서 계산한다", () => {
  const CF: DartRow[] = [
    { sj_div: "CF", account_id: "ifrs-full_PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities",
      account_nm: "유형자산의 취득", thstrm_amount: "275189", frmtrm_amount: "159455", bfefrmtrm_amount: "83251" },
    { sj_div: "CF", account_id: "ifrs-full_PurchaseOfIntangibleAssetsClassifiedAsInvestingActivities",
      account_nm: "무형자산의 취득", thstrm_amount: "10604", frmtrm_amount: "7171", bfefrmtrm_amount: "4547" },
    { sj_div: "CIS", account_id: "ifrs-full_Revenue", account_nm: "매출액",
      thstrm_amount: "971467", frmtrm_amount: "661930", bfefrmtrm_amount: "327657" },
  ];

  it("유형+무형 취득을 합해 3개년 CapEx를 낸다", () => {
    const cx = computeCapex(CF, 2025);
    expect(cx.map(y => y.year)).toEqual([2023, 2024, 2025]);
    expect(cx.find(y => y.year === 2025)!.capex).toBe(275189 + 10604);
  });

  it("CapEx/매출 비율을 계산한다", () => {
    const y25 = computeCapex(CF, 2025).find(y => y.year === 2025)!;
    // (285793 / 971467) * 100 = 29.4%
    expect(y25.capexToRevenue!.toFixed(1)).toBe("29.4");
  });

  it("CapEx 계정이 없으면 빈 렌더", () => {
    expect(renderCapex(computeCapex([{ sj_div: "CIS", account_nm: "매출액", thstrm_amount: "100" }], 2025))).toBe("");
  });

  it("현금 유출이 음수로 와도 절댓값으로 합산한다", () => {
    const neg: DartRow[] = [{ sj_div: "CF", account_id: "ifrs-full_PurchaseOfPropertyPlantAndEquipment",
      account_nm: "유형자산의 취득", thstrm_amount: "-50000" }];
    expect(computeCapex(neg, 2025)[0]!.capex).toBe(50000);
  });
});

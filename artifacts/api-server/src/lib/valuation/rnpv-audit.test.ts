import { describe, it, expect } from "vitest";
import { auditRnpv, formatRnpvIssues } from "./rnpv-audit";

/** 메디포스트(분석 1132) 본문에서 그대로 가져온 두 줄 */
const MEDIPOST = `
**② TAM 및 Peak Sales 산출**

- 글로벌 대상 환자 수: 2억 5천만명 (WHO 기준) — 일본 중등도~중증 환자 300만명
- 연 치료 비용(가격 가정): 1,500만원/회
- **TAM = 300만명 × 1,500만원 = 45조원**
- **TAM Sanity Check**: 위 벤치마크 테이블 기준 골관절염(OA) 전체 시장 $15~22B 대비 200% 수준 — 일본 시장 특성 및 고가 세포치료제임을 감안 시 합리적
- 당사 최대 시장침투율: 5%

📌 **Peak Sales 유사약물 Sanity Check**:
- 동일 적응증 승인 유사약물: 카티스템(메디포스트, 한국) — 적응증 단독 Peak Sales 실적: 300억원 (2025년 기준)
- 당사 Peak Sales 가정이 유사약물 대비 750% 수준 → 일본 시장 규모 및 약가 프리미엄을 고려 시 합리적
`;

describe("메디포스트 사고를 잡는다", () => {
  const codes = auditRnpv(MEDIPOST).map(i => i.code);

  it("일본 TAM이 글로벌 시장의 2배인데 통과시킨 것을 잡는다", () => {
    expect(codes).toContain("tam-over-global");
  });

  it("Peak Sales가 유사약물의 7.5배인데 통과시킨 것을 잡는다", () => {
    expect(codes).toContain("peak-sales-outlier");
  });

  it("무엇을 다시 하라는지 알려준다", () => {
    const t = formatRnpvIssues(auditRnpv(MEDIPOST))!;
    expect(t).toContain("200%");
    expect(t).toContain("750%");
    expect(t).toContain("다시 계산");
  });
});

describe("이상치라도 판정이 정직하면 통과시킨다", () => {
  /**
   * 이 검산의 목적은 숫자를 억누르는 것이 아니라, **빨간불을 스스로 끄는 것**을 막는 것이다.
   * 과대하다고 정직하게 적었으면 그 뒤 처리는 AI에게 맡긴다.
   */
  it("과대라고 적었으면 넘어간다", () => {
    const t = MEDIPOST.replace(/합리적/g, "과대 — 침투율을 3%로 낮춰 재계산");
    expect(auditRnpv(t)).toEqual([]);
  });

  it("기준 이하면 합리적이라 해도 통과", () => {
    const t = MEDIPOST
      .replace("대비 200% 수준", "대비 85% 수준")
      .replace("대비 750% 수준", "대비 180% 수준");
    expect(auditRnpv(t)).toEqual([]);
  });
});

describe("판정할 근거가 없으면 나서지 않는다", () => {
  it("Sanity Check가 아예 없으면 통과 — rNPV가 아닌 보고서를 막지 않는다", () => {
    expect(auditRnpv("## DCF 밸류에이션\n매출 1,000억원, WACC 10%")).toEqual([]);
  });

  it("배율이 안 적혀 있으면 판정하지 않는다", () => {
    expect(auditRnpv("- **TAM Sanity Check**: 글로벌 대비 적정 수준으로 판단 — 합리적")).toEqual([]);
  });

  it("천단위 쉼표가 있어도 읽는다", () => {
    const t = "- **TAM Sanity Check**: 글로벌 TAM 대비 1,200% 수준 — 합리적";
    expect(auditRnpv(t).map(i => i.code)).toContain("tam-over-global");
  });
});

describe("QC 피드백 문자열", () => {
  it("문제가 없으면 null", () => {
    expect(formatRnpvIssues([])).toBeNull();
  });

  it("번호를 매겨 알린다", () => {
    const t = formatRnpvIssues(auditRnpv(MEDIPOST))!;
    expect(t).toContain("rNPV 자기검증 실패");
    expect(t).toContain("1.");
    expect(t).toContain("2.");
  });
});

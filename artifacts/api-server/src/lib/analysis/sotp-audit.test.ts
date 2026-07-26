import { describe, it, expect } from "vitest";
import { auditSotp, formatSotpIssues } from "./sotp-audit";

// 아래 표는 한화시스템 분석(#1127)에서 AI가 실제로 만든 것이다.
// EV/Sales 두 행이 정확히 1/10로 계산돼 목표주가가 6배 왜곡됐다.
const 한화시스템_실제표 = `
### 사업부·자회사별 독립 가치산정
| 사업부/자회사 | 핵심 사업 | 매출(억원) | 영업이익(억원) | 적용 모델 | 배수 | EV(억원) | 지분율 | 귀속가치(억원) | 주당가치(원) |
|------------|--------|----------|------------|--------|------|---------|------|------------|-----------|
| 방산전자 | 군용 레이더, 전투체계 | 29,000 | 1,305 | EV/EBITDA | 15.0x | 19,575 | 100% | 19,575 | 10,362 |
| ICT 서비스 | 국방 AI, 클라우드 | 12,100 | 363 | EV/Sales | 3.0x | 3,630 | 100% | 3,630 | 1,921 |
| 우주항공/뉴스페이스 | SAR 위성, 위성통신 | 5,000 | 150 | EV/Sales | 8.0x | 4,000 | 100% | 4,000 | 2,117 |
| 순현금 / 순부채 | — | — | — | — | — | — | — | -14,500 | -7,675 |
| **SOTP 주주가치 합계** | — | — | — | — | — | — | — | **12,705** | **6,725** |
`;

describe("회귀 — 한화시스템 10배 오류", () => {
  it("EV/Sales 두 행의 자릿수 오류를 잡는다", () => {
    const a = auditSotp(한화시스템_실제표);
    expect(a.notFound).toBe(false);
    expect(a.rows).toHaveLength(3);
    expect(a.mismatches).toHaveLength(2);

    const names = a.mismatches.map((m) => m.name);
    expect(names).toContain("ICT 서비스");
    expect(names).toContain("우주항공/뉴스페이스");
  });

  it("올바른 EV를 알려준다", () => {
    const a = auditSotp(한화시스템_실제표);
    const ict = a.mismatches.find((m) => m.name === "ICT 서비스")!;
    expect(ict.expectedEv).toBe(36300);   // 12,100 × 3.0
    expect(ict.statedEv).toBe(3630);
    expect(ict.ratio).toBeCloseTo(0.1, 3);
  });

  it("EV/EBITDA 행은 정상이므로 통과시킨다", () => {
    const a = auditSotp(한화시스템_실제표);
    const ok = a.rows.find((r) => r.name === "방산전자")!;
    expect(ok.ok).toBe(true);
    expect(ok.expectedEv).toBe(19575);    // 1,305 × 15.0 (영업이익 기준)
  });

  it("지적 문구에 정정할 값이 담긴다", () => {
    const msg = formatSotpIssues(auditSotp(한화시스템_실제표))!;
    expect(msg).toContain("36,300");
    expect(msg).toContain("40,000");
    expect(msg).toContain("10배 축소");
  });
});

describe("모델별 기준값 선택", () => {
  it("EV/Sales는 매출, EV/EBITDA는 영업이익을 기준으로 삼는다", () => {
    const t = `
| 부문 | 설명 | 매출(억원) | 영업이익(억원) | 적용 모델 | 배수 | EV(억원) | 지분율 | 귀속가치 | 주당 |
|---|---|---|---|---|---|---|---|---|---|
| A | x | 1,000 | 100 | EV/Sales | 2.0x | 2,000 | 100% | 2,000 | 1 |
| B | x | 1,000 | 100 | EV/EBITDA | 10.0x | 1,000 | 100% | 1,000 | 1 |
`;
    const a = auditSotp(t);
    expect(a.mismatches).toHaveLength(0); // 둘 다 올바른 기준값으로 계산됨
  });
});

describe("오차 허용", () => {
  it("반올림 수준 차이는 통과시킨다", () => {
    const t = `
| 부문 | 설명 | 매출 | 영업이익 | 적용 모델 | 배수 | EV | 지분율 | 귀속가치 | 주당 |
|---|---|---|---|---|---|---|---|---|---|
| A | x | 1,000 | 100 | EV/Sales | 3.0x | 3,010 | 100% | 3,010 | 1 |
`;
    expect(auditSotp(t).mismatches).toHaveLength(0); // 0.3% 차이
  });

  it("2배 오류는 잡는다", () => {
    const t = `
| 부문 | 설명 | 매출 | 영업이익 | 적용 모델 | 배수 | EV | 지분율 | 귀속가치 | 주당 |
|---|---|---|---|---|---|---|---|---|---|
| A | x | 1,000 | 100 | EV/Sales | 3.0x | 6,000 | 100% | 6,000 | 1 |
`;
    expect(auditSotp(t).mismatches).toHaveLength(1);
  });
});

describe("표가 없거나 형식이 다를 때", () => {
  it("SOTP 표가 없으면 notFound", () => {
    const a = auditSotp("본문만 있고 표는 없습니다.");
    expect(a.notFound).toBe(true);
    expect(a.mismatches).toHaveLength(0);
    expect(formatSotpIssues(a)).toBeNull();
  });

  it("합계 행은 검산 대상이 아니다", () => {
    const a = auditSotp(한화시스템_실제표);
    expect(a.rows.map((r) => r.name)).not.toContain("**SOTP 주주가치 합계**");
    expect(a.rows.map((r) => r.name)).not.toContain("순현금 / 순부채");
  });
});

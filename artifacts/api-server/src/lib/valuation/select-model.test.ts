import { describe, it, expect } from "vitest";
import { selectValuationModel, ALL_MODELS, type SectorFlags } from "./select-model";
import { renderModelBlock, renderReconciliation } from "./model-registry";

describe("업종당 모델 하나만 고른다", () => {
  it("아무 조건에도 안 걸리면 DCF", () => {
    expect(selectValuationModel({}).key).toBe("dcf");
  });

  it("각 업종이 제 모델로 간다", () => {
    const cases: Array<[SectorFlags, string]> = [
      [{ reit: true }, "reit_kr"],
      [{ usReit: true }, "reit_us"],
      [{ financial: true }, "pb_roe"],
      [{ usBank: true }, "tbv_rotce"],
      [{ korBiotech: true }, "rnpv_kr"],
      [{ usBiotech: true }, "rnpv_us"],
      [{ resources: true }, "resource_nav"],
      [{ construction: true }, "rnav_pbv"],
      [{ utility: true }, "rab"],
      [{ telecom: true }, "ev_opfcf"],
      [{ mlp: true }, "mlp"],
      [{ bdc: true }, "bdc"],
      [{ royalty: true }, "royalty"],
      [{ bigTech: true }, "sotp_bigtech"],
      [{ usDefense: true }, "defense_us"],
      [{ sotp: true }, "sotp"],
    ];
    for (const [flags, expected] of cases) {
      expect(selectValuationModel(flags).key, JSON.stringify(flags)).toBe(expected);
    }
  });
});

describe("여러 조건에 걸릴 때 우선순위", () => {
  // 한화시스템은 이름에 "한화"가 있어 SOTP 조건에 걸리지만 실제로는 방산 사업회사다.
  // 구조가 명확한 업종 규칙이 포괄적인 SOTP보다 먼저 적용돼야 한다.
  it("리츠는 SOTP보다 우선한다", () => {
    expect(selectValuationModel({ sotp: true, reit: true }).key).toBe("reit_kr");
  });

  it("금융은 SOTP보다 우선한다 — 금융지주가 SOTP로 새지 않도록", () => {
    expect(selectValuationModel({ sotp: true, financial: true }).key).toBe("pb_roe");
  });

  it("MLP·BDC는 어떤 조건보다 우선한다 — EPS 개념 자체가 없는 구조", () => {
    expect(selectValuationModel({ sotp: true, financial: true, mlp: true }).key).toBe("mlp");
    expect(selectValuationModel({ sotp: true, financial: true, bdc: true }).key).toBe("bdc");
  });

  it("미국 리츠가 한국 리츠보다 우선한다", () => {
    expect(selectValuationModel({ reit: true, usReit: true }).key).toBe("reit_us");
  });

  it("미국 은행이 한국 금융보다 우선한다", () => {
    expect(selectValuationModel({ financial: true, usBank: true }).key).toBe("tbv_rotce");
  });
});

describe("공통 조율 규칙", () => {
  it("가중치가 절대·상대 합쳐 100%가 된다", () => {
    for (const m of Object.values(ALL_MODELS)) {
      expect(m.absWeight, m.key).toBeGreaterThan(0);
      expect(m.absWeight, m.key).toBeLessThan(1);
      const text = renderReconciliation(m);
      const nums = text.match(/(\d+)% \+ .*? (\d+)%/);
      expect(nums, m.key).not.toBeNull();
      expect(Number(nums![1]) + Number(nums![2]), m.key).toBe(100);
    }
  });

  it("모든 모델이 같은 괴리 처리 규칙을 갖는다", () => {
    for (const m of Object.values(ALL_MODELS)) {
      const t = renderReconciliation(m);
      expect(t, m.key).toContain("괴리율 20% 이내");
      expect(t, m.key).toContain("괴리율 20% 초과");
      expect(t, m.key).toContain("괴리율 30% 초과");
      // 예전에는 유틸리티·통신만 3-way였고 SOTP는 3-way를 금지해 서로 어긋났다
      expect(t, m.key).toContain("3개 이상 방법론의 단순 평균 금지");
    }
  });
});

describe("모델 블록 렌더링", () => {
  it("절대·상대·조율·밴드·JSON 매핑을 모두 담는다", () => {
    const b = renderModelBlock(ALL_MODELS.sotp);
    expect(b).toContain("[① 절대가치");
    expect(b).toContain("[② 상대가치");
    expect(b).toContain("[③ 조율");
    expect(b).toContain("[④ 시나리오 밴드");
    expect(b).toContain("FINAL_VALUATION_DATA");
  });

  it("abs와 rel을 같은 값으로 복사하는 것을 금지한다", () => {
    for (const m of Object.values(ALL_MODELS)) {
      expect(renderModelBlock(m), m.key).toContain("같은 값을 복사해 넣는 것을 금지");
    }
  });

  it("abs_model 이름이 자동으로 채워진다", () => {
    expect(renderModelBlock(ALL_MODELS.reit_kr)).toContain('abs_model = "NAV+P/FFO"');
  });

  it("보조 검증이 있는 모델만 그 섹션을 갖는다", () => {
    expect(renderModelBlock(ALL_MODELS.rab)).toContain("보조 검증");   // RAB 규제자산
    expect(renderModelBlock(ALL_MODELS.dcf)).not.toContain("보조 검증"); // DCF는 없음
  });
});

describe("도메인 지식이 유실되지 않았다", () => {
  // 기존 프롬프트에 있던 핵심 수치·금지사항이 그대로 옮겨졌는지 확인한다.
  it("업종별 금지 사항이 남아 있다", () => {
    expect(renderModelBlock(ALL_MODELS.pb_roe)).toContain("EV/EBITDA 사용 금지");
    expect(renderModelBlock(ALL_MODELS.reit_us)).toContain("FFO 단독 사용 금지");
    expect(renderModelBlock(ALL_MODELS.mlp)).toContain("EPS·PER 기반 분석 완전 금지");
    expect(renderModelBlock(ALL_MODELS.tbv_rotce)).toContain("P/B(총장부가) 단독 사용 금지");
  });

  it("업종별 배수 범위가 남아 있다", () => {
    expect(renderModelBlock(ALL_MODELS.reit_kr)).toContain("8~12x");        // 한국 리츠 P/FFO
    expect(renderModelBlock(ALL_MODELS.reit_us)).toContain("25~40x");       // 미국 데이터센터 P/AFFO
    expect(renderModelBlock(ALL_MODELS.defense_us)).toContain("13~18x");    // 미국 방산 EV/EBITDA
    expect(renderModelBlock(ALL_MODELS.royalty)).toContain("20~35x");       // 로열티 EV/EBITDA
    expect(renderModelBlock(ALL_MODELS.rab)).toContain("6~10x");            // 한국 유틸리티
  });

  it("바이오 rNPV의 고정 WACC와 5배 상한이 남아 있다", () => {
    const b = renderModelBlock(ALL_MODELS.rnpv_kr);
    expect(b).toContain("Phase 1 18%");
    expect(b).toContain("Bull은 Bear의 5배를 초과할 수 없습니다");
    expect(b).toContain("앵커의 10배 이상");
  });

  it("SOTP에 산수 검산 경고가 들어 있다", () => {
    expect(renderModelBlock(ALL_MODELS.sotp)).toContain("서버가 이 산수를 검산");
  });
});

import { describe, it, expect } from "vitest";
import { classifySector, isComparableSector } from "./sector-taxonomy";

// 아래 industry 값은 모두 운영 DB(krx_stocks)에 실제로 들어 있는 문자열이다.
// 야후 파이낸스가 주는 영문 고정 명칭이라 임의로 바꾸면 안 된다.

describe("회귀 — 예전 분류표가 놓쳤던 것들", () => {
  // 예전 코드는 "auto part"·"automotive"·"car"만 봤다. "Auto Manufacturers"는
  // 그 어디에도 안 걸려 현대차·기아가 통째로 미분류였다.
  it("Auto Manufacturers를 자동차로 분류한다 (현대차·기아)", () => {
    expect(classifySector("Auto Manufacturers", "KR")).toBe("KR_AUTO");
  });

  it("가장 많이 미분류되던 industry들이 이제 분류된다", () => {
    const cases: Array<[string, string]> = [
      ["Electronic Components", "KR_ELECTRONICS"],           // 112개
      ["Specialty Industrial Machinery", "KR_MACHINERY"],    // 87개
      ["Packaged Foods", "KR_FOOD"],                         // 61개
      ["Electrical Equipment & Parts", "KR_ELECTRONICS"],    // 60개
      ["Steel", "KR_MATERIALS"],                             // 53개
      ["Medical Devices", "KR_MEDICAL"],                     // 52개
      ["Communication Equipment", "KR_ELECTRONICS"],         // 44개
      ["Entertainment", "KR_MEDIA"],                         // 40개
      ["Information Technology Services", "KR_IT"],          // 39개
      ["Conglomerates", "KR_HOLDING"],                       // 30개
    ];
    for (const [industry, expected] of cases) {
      expect(classifySector(industry, "KR"), industry).toBe(expected);
    }
  });
});

describe("순서 — 좁은 항목이 넓은 항목보다 먼저 걸려야 한다", () => {
  it("반도체 장비는 반도체보다 먼저 잡힌다", () => {
    expect(classifySector("Semiconductor Equipment & Materials", "KR")).toBe("KR_SEMICONDUCTOR_EQ");
    expect(classifySector("Semiconductors", "KR")).toBe("KR_SEMICONDUCTOR");
  });

  it("의료기기는 넓은 소비재로 새지 않는다", () => {
    expect(classifySector("Medical Instruments & Supplies", "KR")).toBe("KR_MEDICAL");
  });

  it("건축자재는 소재가 아니라 건설로 간다", () => {
    // "Building Materials"가 "materials" 규칙보다 먼저 와야 의미가 맞다
    expect(classifySector("Building Materials", "KR")).toBe("KR_MATERIALS");
    expect(classifySector("Building Products & Equipment", "KR")).toBe("KR_CONSTRUCTION");
  });
});

describe("한국 표준산업분류(KIS) 보정", () => {
  // 야후는 조선 3사를 모두 "Aerospace & Defense"로 준다. 방산과 조선은 사업도
  // 밸류에이션도 달라 같은 피어로 묶으면 안 된다. KIS가 정확히 구분해준다.
  it("조선사를 방산에서 분리한다", () => {
    expect(classifySector("Aerospace & Defense", "KR")).toBe("KR_DEFENSE");
    expect(classifySector("Aerospace & Defense", "KR", "선박 및 보트 건조업")).toBe("KR_SHIPBUILDING");
  });

  it("진짜 방산은 방산으로 남는다", () => {
    expect(classifySector("Aerospace & Defense", "KR", "무기 및 총포탄 제조업")).toBe("KR_DEFENSE");
    expect(classifySector("Aerospace & Defense", "KR", "항공기,우주선 및 부품 제조업")).toBe("KR_DEFENSE");
  });

  // KIS 표준산업분류는 "법인 등록 업종"이라 실제 사업과 어긋날 때가 많다.
  // 넓게 덮어쓰게 했더니 두산(지주회사)과 한화시스템(방산전자)이 전자부품으로
  // 잘못 옮겨졌다. 그래서 덮어쓰기는 검증된 것(조선)만 하고, 나머지는
  // 야후가 못 잡았을 때만 메운다.
  it("야후가 분류한 것을 KIS가 함부로 덮어쓰지 않는다", () => {
    // 두산 — 야후 Conglomerates(지주), KIS는 전자부품 제조업
    expect(classifySector("Conglomerates", "KR", "전자부품 제조업")).toBe("KR_HOLDING");
    // 한화시스템 — 야후 Aerospace & Defense(방산), KIS는 전자부품 제조업
    expect(classifySector("Aerospace & Defense", "KR", "전자부품 제조업")).toBe("KR_DEFENSE");
  });

  it("야후가 못 잡은 경우에만 KIS로 메운다", () => {
    // 야후에 industry가 없거나 모르는 값일 때
    expect(classifySector(null, "KR", "1차 비철금속 제조업")).toBe("KR_MATERIALS");
    expect(classifySector("Unknown Thing", "KR", "담배 제조업")).toBe("KR_FOOD");
    expect(classifySector("", "KR", "은행 및 저축기관")).toBe("KR_FINANCIAL");
  });

  // KIS는 지주회사를 전부 "기타 금융업"으로 보낸다. SK스퀘어는 반도체 지주회사이지
  // 금융회사가 아니다. 이런 모호한 값은 무시하고 야후 판단을 써야 한다.
  it("KIS의 모호한 분류는 무시하고 야후로 넘어간다", () => {
    expect(classifySector("Semiconductors", "KR", "기타 금융업")).toBe("KR_SEMICONDUCTOR");
    expect(classifySector("Conglomerates", "KR", "기타 금융업")).toBe("KR_HOLDING");
    expect(classifySector("Engineering & Construction", "KR", "기타 전문 도매업")).toBe("KR_CONSTRUCTION");
    // 한미반도체 — KIS는 "특수 목적용 기계"로 뭉뚱그리지만 반도체 장비가 맞다
    expect(classifySector("Semiconductor Equipment & Materials", "KR", "특수 목적용 기계 제조업"))
      .toBe("KR_SEMICONDUCTOR_EQ");
  });

  it("진짜 금융사는 KIS로도 금융이다", () => {
    expect(classifySector("Banks - Regional", "KR", "은행 및 저축기관")).toBe("KR_FINANCIAL");
    expect(classifySector("Insurance - Life", "KR", "보험업")).toBe("KR_FINANCIAL");
  });

  it("KIS 값이 없으면 야후만 쓴다", () => {
    expect(classifySector("Auto Manufacturers", "KR", null)).toBe("KR_AUTO");
    expect(classifySector("Auto Manufacturers", "KR", "")).toBe("KR_AUTO");
  });
});

describe("시장 접두사", () => {
  it("같은 industry라도 시장에 따라 접두사가 다르다", () => {
    expect(classifySector("Semiconductors", "KR")).toBe("KR_SEMICONDUCTOR");
    expect(classifySector("Semiconductors", "US")).toBe("US_SEMICONDUCTOR");
  });
});

describe("빈 값 처리", () => {
  it("industry가 없으면 OTHER", () => {
    expect(classifySector(null, "KR")).toBe("KR_OTHER");
    expect(classifySector(undefined, "KR")).toBe("KR_OTHER");
    expect(classifySector("", "KR")).toBe("KR_OTHER");
    expect(classifySector("   ", "KR")).toBe("KR_OTHER");
  });

  it("모르는 industry는 OTHER로 남는다", () => {
    expect(classifySector("Completely Unknown Industry XYZ", "KR")).toBe("KR_OTHER");
  });
});

describe("피어 비교 가능 여부", () => {
  // SPAC·페이퍼컴퍼니(81개)는 사업 실체가 없어 멀티플 비교가 무의미하다.
  it("SPAC은 비교 대상에서 제외한다", () => {
    expect(classifySector("Shell Companies", "KR")).toBe("KR_SHELL");
    expect(isComparableSector("KR_SHELL")).toBe(false);
  });

  it("미분류도 비교 대상이 아니다", () => {
    expect(isComparableSector("KR_OTHER")).toBe(false);
    expect(isComparableSector(null)).toBe(false);
  });

  it("정상 업종은 비교 가능", () => {
    expect(isComparableSector("KR_SEMICONDUCTOR")).toBe(true);
    expect(isComparableSector("US_TECH")).toBe(true);
  });
});

describe("대소문자·공백에 흔들리지 않는다", () => {
  it("야후가 표기를 바꿔도 견딘다", () => {
    expect(classifySector("  AUTO MANUFACTURERS  ", "KR")).toBe("KR_AUTO");
    expect(classifySector("electronic components", "KR")).toBe("KR_ELECTRONICS");
  });
});

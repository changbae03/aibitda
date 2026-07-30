import { describe, it, expect } from "vitest";
import { extractMetrics, renderMetricTable } from "./biz-metrics";

/** SK하이닉스 2025년 사업보고서 원문을 그대로 옮긴 것 (htmlToText 통과 후 모양) */
const HYNIX = `
### [연구개발]
연구개발비용 합계
6,732,527
4,954,447
4,188,404
회계처리
연구개발비(비용)
6,465,637
4,536,723
3,837,907
개발비(무형자산)
266,890
417,724
350,497
연구개발비 / 매출액 비율[연구개발비용계÷당기매출액×100]
6.9%
7.5%
12.8%
97,146,675
※ 한국채택국제회계기준에 따라 연결 기준으로 작성되었습니다.
`;

describe("평탄화된 DART 표에서 값을 읽는다", () => {
  /**
   * DART 표는 htmlToText를 거치면 셀마다 줄바꿈된다.
   * 라벨 한 줄 뒤에 기수만큼 값이 이어지는 규칙 하나로 대부분 읽힌다.
   */
  const hits = extractMetrics(HYNIX);

  it("연구개발비를 당기·전기·전전기 순으로 읽는다", () => {
    const rnd = hits.find(h => h.key === "rndTotal")!;
    expect(rnd.values.slice(0, 3)).toEqual([6_732_527, 4_954_447, 4_188_404]);
  });

  it("비율도 읽는다", () => {
    const ratio = hits.find(h => h.key === "rndRatio")!;
    expect(ratio.values.slice(0, 3)).toEqual([6.9, 7.5, 12.8]);
  });

  it("같은 지표를 두 번 잡지 않는다 — 뒤따르는 세부 항목은 건너뛴다", () => {
    expect(hits.filter(h => h.key === "rndTotal")).toHaveLength(1);
  });

  it("문장이 나오면 값 읽기를 멈춘다", () => {
    // "※ 한국채택국제회계기준에…" 줄이 값으로 섞이면 안 된다
    for (const h of hits) {
      for (const v of h.values) expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe("값이 아닌 줄을 값으로 착각하지 않는다", () => {
  it("설명 문장은 값이 아니다", () => {
    const t = `연구개발비용 합계\n당사는 연구개발에 힘쓰고 있습니다\n1,000`;
    expect(extractMetrics(t).find(h => h.key === "rndTotal")).toBeUndefined();
  });

  it("라벨만 있고 값이 없으면 담지 않는다", () => {
    expect(extractMetrics("가동률\n(해당사항 없음)")).toEqual([]);
  });

  it("회계 음수 표기를 읽는다", () => {
    const t = `수주잔고\n△1,234\n5,678`;
    expect(extractMetrics(t).find(h => h.key === "backlog")!.values).toEqual([-1234, 5678]);
  });
});

describe("표로 만든다", () => {
  const periods = [
    { periodLabel: "2024년 연간", bsnsYear: 2024, quarter: 4, hits: extractMetrics(HYNIX) },
    { periodLabel: "2025년 연간", bsnsYear: 2025, quarter: 4, hits: [] },
  ];

  it("각 기간의 당기 값만 쓴다 — 전기·전전기는 이전 보고서와 중복이다", () => {
    const t = renderMetricTable(periods);
    expect(t).toContain("6,732,527");
    expect(t).not.toContain("4,954,447"); // 전기 값은 표에 안 들어간다
  });

  it("없는 기간은 —로 둔다", () => {
    expect(renderMetricTable(periods)).toMatch(/2025년 연간 \| — \| —/);
  });

  it("아무 지표도 없으면 빈 문자열 — 잡음을 만들지 않는다", () => {
    expect(renderMetricTable([{ periodLabel: "2025년 연간", bsnsYear: 2025, quarter: 4, hits: [] }]))
      .toBe("");
  });

  /**
   * 이 표를 만드는 이유 자체가 "LLM이 원문에서 숫자를 찾다가 다른 해 값을 끌어오는 것"을
   * 막기 위해서다. 그 지시가 표에 붙어 있어야 한다.
   */
  it("원문을 다시 뒤지지 말라고 못박는다", () => {
    const t = renderMetricTable(periods);
    expect(t).toContain("원문을 다시 뒤져 숫자를 찾지 마세요");
    expect(t).toContain("공시 미확인");
  });
});

/**
 * input-format.ts — 밸류에이션 입력의 "무엇이 있고 무엇이 없는가" 판정과 표기.
 *
 * 왜 이걸 따로 두는가.
 *
 * 이 저장소에서 밸류에이션이 크게 틀어진 사고는 전부 **입력이 없는데 아무도 몰랐던 것**이
 * 원인이었다. 순부채가 안 들어오면 AI가 추정했고(한화시스템 목표가 6배 오차), DART 재무가
 * 비면 AI가 지어냈다. 그런데 파이프라인은 데이터 수집을 전부 `.catch(() => null)`로 감싸서
 * 무엇이 빠졌는지 알 수 없었다. 결국 그 빈칸을 출력단 클램프(목표가 하한 0.45배)로
 * 때우고 있었다 — 증상 처방이다.
 *
 * 여기서는 빠진 입력을 **이름과 영향으로** 적어 남긴다. 그러면
 *   ① 로그에서 "이 분석은 순부채 없이 돌았다"가 보이고
 *   ② 프롬프트가 AI에게 "없으니 추정하지 말라"고 명시할 수 있고
 *   ③ 입력이 갖춰진 분석과 아닌 분석을 나눠 클램프의 필요성을 판단할 수 있다.
 *
 * DB를 모르는 순수 함수만 둔다 — DATABASE_URL 없이 테스트하기 위해서다.
 */

/** 빠진 입력 하나 */
export interface MissingInput {
  key: string;
  /** 사람이 읽는 이름 */
  label: string;
  /** 없으면 밸류에이션에 무슨 일이 생기는가 */
  impact: string;
  severity: Severity;
}

export type Severity = "critical" | "major" | "minor";

/** 있는지 없는지만 보는, 판정에 필요한 최소 형태 */
export interface InputPresence {
  market: "KR" | "US";
  currentPrice: number | null;
  sharesOut: number | null;
  netDebt: unknown | null;
  financialYears: number;
  peerCount: number;
  bandUsable: boolean;
  segmentText: string | null;
  backlogText: string | null;
  beta: number | null;
  /** SOTP 계열 모델인가 — 부문 자료가 필수인지 갈린다 */
  needsSegments: boolean;
}

/**
 * 심각도별 가중치. 갖춰짐 비율을 낼 때 쓴다.
 *
 * critical은 없으면 목표주가 자체가 성립하지 않는 것들이다. major는 한쪽 평가를
 * 통째로 못 하게 만드는 것, minor는 정확도가 떨어지지만 대안이 있는 것.
 */
const WEIGHT: Record<Severity, number> = { critical: 3, major: 2, minor: 1 };

/**
 * 무엇이 빠졌는지 판정한다.
 *
 * impact 문구는 프롬프트에 그대로 들어간다 — AI가 "없으니 추정하자"로 흐르지 않도록
 * 무엇을 하지 말아야 하는지까지 적는다.
 */
export function findMissingInputs(p: InputPresence): MissingInput[] {
  const missing: MissingInput[] = [];
  const add = (key: string, label: string, impact: string, severity: Severity) =>
    missing.push({ key, label, impact, severity });

  if (p.currentPrice == null || p.currentPrice <= 0) {
    add("currentPrice", "현재가",
      "괴리율·시나리오 밴드의 기준점이 없습니다. 목표주가의 타당성을 스스로 검증할 수 없습니다.",
      "critical");
  }

  if (p.sharesOut == null || p.sharesOut <= 0) {
    add("sharesOut", "발행주식수",
      "기업가치를 주당가치로 나눌 수 없습니다. 주식수를 추정하지 말고, 주당 환산 없이 기업가치까지만 제시하세요.",
      "critical");
  }

  if (!p.netDebt) {
    add("netDebt", "순차입금",
      "기업가치에서 주주가치로 넘어갈 수 없습니다. **순부채를 추정하지 마세요** — " +
      "예전에 AI가 추정했다가 목표주가가 실제의 6배로 산출된 적이 있습니다. " +
      "순부채 미확인을 명시하고, 순부채 0 가정 시의 값임을 밝히세요.",
      "critical");
  }

  if (p.financialYears < 2) {
    add("financials", "과거 재무 시계열",
      `확보된 연도가 ${p.financialYears}년뿐입니다. 성장률·마진 추세를 과거에서 끌어낼 수 없으니 ` +
      "DCF 가정을 컨센서스나 피어에 근거해 세우고, 그 출처를 밝히세요.",
      p.financialYears === 0 ? "critical" : "major");
  }

  if (p.peerCount === 0) {
    add("peers", "피어 그룹",
      "상대가치 평가가 불가능합니다. 절대가치 단독으로 결론내되 그 한계를 명시하세요.",
      "major");
  } else if (p.peerCount < 3) {
    add("peersThin", "피어 수",
      `${p.peerCount}개뿐이라 배수 중앙값이 흔들립니다. 업종 실측 밴드를 함께 보세요.`,
      "minor");
  }

  if (!p.bandUsable) {
    add("sectorBand", "업종 실측 배수",
      "이 업종의 시장 배수 표본이 부족합니다. 피어 개별 배수를 직접 확인해 쓰고, " +
      "기억에 있는 업종 평균을 적어넣지 마세요 — 그 값은 낡았을 가능성이 큽니다.",
      "major");
  }

  if (p.needsSegments && !p.segmentText) {
    add("segments", "부문별 매출 자료",
      "SOTP는 사업부별 실적이 있어야 성립합니다. 사업부 비중을 임의로 나누지 말고, " +
      "부문 자료 부재를 밝힌 뒤 단일 사업으로 평가하세요.",
      "critical");
  }

  if (p.beta == null) {
    add("beta", "베타",
      "CAPM으로 자기자본비용을 구할 수 없습니다. 업종 표준 WACC 범위를 쓰고 그 근거를 밝히세요.",
      "minor");
  }

  return missing;
}

/**
 * 입력이 얼마나 갖춰졌는지 0~1로. 심각도 가중 평균이다.
 * 판단 없는 단순 개수는 의미가 없다 — 순부채 하나가 피어 수보다 훨씬 무겁다.
 */
export function completeness(missing: MissingInput[]): number {
  const TOTAL = 18; // critical 4개(12) + major 2개(4) + minor 2개(2)의 상한
  const lost = missing.reduce((s, m) => s + WEIGHT[m.severity], 0);
  return Math.max(0, Math.min(1, 1 - lost / TOTAL));
}

const MARK: Record<Severity, string> = { critical: "⛔", major: "⚠️", minor: "·" };

/**
 * 프롬프트에 넣을 블록. 빠진 게 없으면 빈 문자열을 돌려준다(잡음을 만들지 않는다).
 *
 * 이 블록의 목적은 하나다 — **AI가 없는 데이터를 지어내지 않게 하는 것.**
 * 예전에는 데이터가 비어도 프롬프트가 아무 말을 하지 않아, AI가 조용히 추정으로 메웠고
 * 그 추정이 목표주가를 통째로 흔들었다.
 */
export function renderMissingBlock(missing: MissingInput[]): string {
  if (missing.length === 0) return "";

  const order: Severity[] = ["critical", "major", "minor"];
  const sorted = [...missing].sort(
    (a, b) => order.indexOf(a.severity) - order.indexOf(b.severity),
  );

  const lines = [
    "",
    "[📋 확보하지 못한 입력 — 지어내지 마세요]",
    "아래 항목은 서버가 수집에 실패했거나 존재하지 않는 데이터입니다.",
    "**없는 값을 추정해 채우지 말고**, 각 항목에 적힌 대응을 따르세요.",
    "추정으로 메운 수치는 보고서 전체의 신뢰도를 떨어뜨립니다.",
  ];

  for (const m of sorted) {
    lines.push(`${MARK[m.severity]} ${m.label}: ${m.impact}`);
  }

  if (sorted.some((m) => m.severity === "critical")) {
    lines.push(
      "⛔ 표시 항목이 있으면 목표주가의 불확실성을 결론에 반드시 적으세요 " +
      "(예: \"순차입금 미확인으로 주주가치 환산에 오차가 있을 수 있음\").",
    );
  }

  return lines.join("\n");
}

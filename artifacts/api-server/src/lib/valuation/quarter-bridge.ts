/**
 * quarter-bridge.ts — 확정된 분기 실적이 연간 전망을 구속하게 만든다.
 *
 * 분기가 하나씩 확정될수록 연간 전망은 정확해져야 한다. Q1이 나오면 남은 3분기만
 * 추정하면 되고, Q2까지 나오면 절반이 사실로 굳는다. 그런데 그 산수가 프롬프트에
 * 명시되지 않아 AI가 연간 숫자를 사실상 처음부터 다시 지어냈다.
 *
 * 메디포스트(분석 1132)에는 이런 문장이 있었다.
 *   "Q1 확정 실적이 초기 기대치 대비 +1.2% → 구조적 개선으로 판단,
 *    연간E를 기존 743.7억원 → 743.7억원으로 상향 조정"
 * 같은 숫자를 놓고 "상향 조정"이라고 쓴 것이다. 조정이 일어난 적이 없다.
 *
 * 여기서 하는 일은 단순하다. **남은 분기가 얼마여야 하는지 역산해서 알려준다.**
 *   남은 분기 합계 = 연간E − 확정 분기 합계
 *   분기당 평균    = 남은 합계 ÷ 남은 분기 수
 * 이 값을 작년 같은 기간과 나란히 두면, 연간 전망이 말이 되는지 바로 보인다.
 *
 * DB를 모르는 순수 함수만 둔다.
 */

/** DART 보고서 코드 → 분기. 코드 번호는 시간 순이 아니다 */
const QUARTER_BY_CODE: Record<string, number> = {
  "11013": 1, // 1분기보고서
  "11012": 2, // 반기보고서
  "11014": 3, // 3분기보고서
  "11011": 4, // 사업보고서(연간)
};

export interface QuarterRow {
  bsnsYear: number;
  reprtCode: string;
  periodLabel: string;
  revenue: number | null;
  operatingIncome: number | null;
}

/**
 * 시간 순으로 정렬한다(과거 → 최신).
 *
 * ⚠️ `ORDER BY reprt_code`로 정렬하면 안 된다. 코드는 11011(연간) · 11012(반기) ·
 * 11013(1분기) · 11014(3분기)라 **번호 순서와 시간 순서가 다르다.**
 * 실제로 Q1·Q2가 확정된 종목에서 "최신 확정 분기"로 Q1이 집혔고,
 * OPM 추세 판단과 권고 범위가 전부 한 분기 뒤진 값으로 계산됐다.
 */
export function sortChronologically<T extends { bsnsYear: number; reprtCode: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) =>
    a.bsnsYear - b.bsnsYear ||
    (QUARTER_BY_CODE[a.reprtCode] ?? 0) - (QUARTER_BY_CODE[b.reprtCode] ?? 0));
}

export function quarterOf(reprtCode: string): number | null {
  return QUARTER_BY_CODE[reprtCode] ?? null;
}

/** 연간 보고서인가 */
export function isAnnual(reprtCode: string): boolean {
  return reprtCode === "11011";
}

export interface QuarterBridge {
  /** 확정된 분기들 (시간 순) */
  confirmed: QuarterRow[];
  /** 남은 분기 수 */
  remaining: number;
  confirmedRevenue: number | null;
  confirmedOp: number | null;
  /** 작년 같은 기간(확정 분기와 같은 분기들)의 합계 — 비교 기준 */
  priorYearSameRevenue: number | null;
  priorYearSameOp: number | null;
  /** 작년 남은 분기들의 합계 — 올해 남은 분기의 참고값 */
  priorYearRestRevenue: number | null;
  priorYearRestOp: number | null;
}

/**
 * 올해 확정 분기와, 비교할 작년 같은 기간을 묶는다.
 *
 * 개별 분기 값이다(누적 아님). DART `thstrm_amount`는 3개월치를 주므로
 * Q1+Q2+Q3+Q4 = 연간이 성립한다 — 메디포스트 2025년으로 확인했다
 * (192.2 + 178.4 + 186.9 + 179.1 = 736.6 = FY).
 */
export function buildQuarterBridge(rows: QuarterRow[], currentYear: number): QuarterBridge | null {
  const quarters = rows.filter(r => !isAnnual(r.reprtCode) && quarterOf(r.reprtCode) !== null);
  const thisYear = sortChronologically(quarters.filter(r => r.bsnsYear === currentYear));
  if (thisYear.length === 0) return null;

  const confirmedQs = new Set(thisYear.map(r => quarterOf(r.reprtCode)!));
  const lastYear = quarters.filter(r => r.bsnsYear === currentYear - 1);

  const sum = (list: QuarterRow[], key: "revenue" | "operatingIncome"): number | null => {
    const vals = list.map(r => r[key]).filter((v): v is number => v !== null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };

  const sameQ = lastYear.filter(r => confirmedQs.has(quarterOf(r.reprtCode)!));
  const restQ = lastYear.filter(r => !confirmedQs.has(quarterOf(r.reprtCode)!));

  return {
    confirmed: thisYear,
    remaining: Math.max(0, 4 - thisYear.length),
    confirmedRevenue: sum(thisYear, "revenue"),
    confirmedOp: sum(thisYear, "operatingIncome"),
    priorYearSameRevenue: sum(sameQ, "revenue"),
    priorYearSameOp: sum(sameQ, "operatingIncome"),
    priorYearRestRevenue: sum(restQ, "revenue"),
    priorYearRestOp: sum(restQ, "operatingIncome"),
  };
}

const 억 = (v: number | null): string =>
  v === null ? "—" : `${(v / 1e8).toFixed(1)}억원`;

const pct = (now: number | null, before: number | null): string => {
  if (now === null || before === null || before === 0) return "";
  const d = (now - before) / Math.abs(before) * 100;
  return ` (전년 동기 대비 ${d >= 0 ? "+" : ""}${d.toFixed(1)}%)`;
};

/**
 * 프롬프트 블록. 남은 분기가 얼마여야 하는지 **역산 식을 직접 준다.**
 *
 * "계절성을 고려해 추정하라" 같은 말로는 부족하다 — 연간E를 먼저 정해놓고 분기를
 * 끼워 맞추는 순서가 되기 때문이다. 확정값을 빼고 남은 몫을 먼저 보게 한다.
 */
export function renderQuarterBridge(b: QuarterBridge, currentYear: number): string {
  const qs = b.confirmed.map(r => `Q${quarterOf(r.reprtCode)}`).join("·");
  const lines = [
    "",
    `[📐 ${currentYear}년 연간 전망 — 확정 분기에서 역산할 것]`,
    `확정: ${qs} (${b.confirmed.length}개) · 남은 분기: ${b.remaining}개`,
    `· 확정 매출 합계 ${억(b.confirmedRevenue)}${pct(b.confirmedRevenue, b.priorYearSameRevenue)}`,
    `· 확정 영업이익 합계 ${억(b.confirmedOp)}${pct(b.confirmedOp, b.priorYearSameOp)}`,
  ];

  if (b.priorYearRestRevenue !== null || b.priorYearRestOp !== null) {
    lines.push(
      `· 작년 같은 남은 분기: 매출 ${억(b.priorYearRestRevenue)} · 영업이익 ${억(b.priorYearRestOp)}` +
      ` ← 올해 남은 ${b.remaining}개 분기의 출발점`,
    );
  }

  lines.push(
    ``,
    `⛔ 순서를 지키세요. 연간E를 먼저 정하고 분기를 끼워 맞추지 마세요.`,
    `  ① 남은 ${b.remaining}개 분기를 각각 추정한다 (작년 같은 분기 × 성장률).`,
    `  ② 연간E = 확정 합계 + 남은 분기 합계.  ← 확정값은 **고정**이다. 바꾸지 마세요.`,
    `  ③ 분기 테이블의 확정 분기 칸에는 위 확정값을 그대로 적는다.`,
    `⛔ 분기 4개의 합이 연간E와 다르면 QC 불승인입니다(서버가 검산합니다).`,
    `⛔ "상향/하향 조정"이라고 쓰려면 **바뀐 값**을 함께 적으세요.` +
    ` 같은 숫자를 놓고 조정했다고 쓰면 불승인입니다.`,
    ``,
  );

  return lines.join("\n");
}

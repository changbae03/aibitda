/**
 * quarter-audit.ts — 분기 전망표가 연간 전망과 맞는지, 확정 분기를 지켰는지 검산한다.
 *
 * 분기가 확정될수록 연간은 정확해져야 한다. 그런데 프롬프트로 "확정값을 쓰라"고 해도
 * LLM은 연간 숫자를 먼저 정해놓고 분기를 끼워 맞추거나, 확정된 분기 값을 슬쩍 바꾼다.
 * SOTP 산수와 조율을 서버가 검산하기로 한 것과 같은 이유다.
 *
 * 메디포스트(분석 1132) 본문에는 이런 문장이 있었다.
 *   "Q1 확정 실적이 초기 기대치 대비 +1.2% → 구조적 개선으로 판단,
 *    연간E를 기존 743.7억원 → 743.7억원으로 상향 조정"
 * 같은 숫자를 놓고 "상향 조정"이라고 쓴 것이다 — 조정이 일어난 적이 없다.
 *
 * DB를 모르는 순수 함수만 둔다.
 */

export interface QuarterAuditInput {
  /** 보고서 본문 */
  content: string;
  /** 서버가 아는 확정 분기 — 라벨(Q1/Q2/Q3)과 값(억원) */
  confirmed: Array<{ quarter: number; revenue: number | null; operatingIncome: number | null }>;
}

export interface QuarterIssue {
  code: "sum-mismatch" | "confirmed-changed" | "empty-adjustment";
  message: string;
}

/** 분기 합과 연간의 허용 오차. 반올림 표기를 감안해 1%로 둔다 */
const SUM_TOLERANCE = 0.01;
/** 확정 분기 값은 사실이므로 거의 그대로여야 한다. 단위 반올림만 허용 */
const CONFIRMED_TOLERANCE = 0.02;

/** "743.7" 같은 수를 억원 숫자로 */
function toNum(raw: string): number | null {
  const n = Number(raw.replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * 분기 전망표에서 Q1~Q4와 연간계를 읽는다.
 *
 * 표 형식은 프롬프트가 정한다 — 행 머리말이 "매출", 열이 Q1/Q2E/Q3E/Q4E/연간계.
 * 열 순서에 의존하지 않도록 **머리글 행에서 각 열의 위치를 먼저 찾는다.**
 */
function readQuarterTable(content: string, rowLabel: RegExp):
  { quarters: (number | null)[]; annual: number | null } | null {
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const head = lines[i];
    if (!/\|/.test(head)) continue;
    const cols = head.split("|").map(c => c.trim());
    // Q1~Q4 열과 연간 열의 위치를 찾는다 (Q1, Q1E, Q1(★확정) 등 모두 허용)
    const qIdx: number[] = [];
    for (let q = 1; q <= 4; q++) {
      qIdx.push(cols.findIndex(c => new RegExp(`^Q${q}\\b|^Q${q}E\\b|Q${q}\\s*\\(`, "i").test(c)));
    }
    const aIdx = cols.findIndex(c => /연간|합계|FY|Full\s*Year/i.test(c));
    if (qIdx.some(v => v < 0) || aIdx < 0) continue;

    // 머리글을 찾았으면 아래에서 해당 지표 행을 찾는다
    for (let j = i + 1; j < Math.min(i + 12, lines.length); j++) {
      const row = lines[j];
      if (!/\|/.test(row)) continue;
      const rc = row.split("|").map(c => c.trim());
      if (!rowLabel.test(rc[1] ?? "")) continue;
      const pick = (k: number) => {
        const cell = (rc[k] ?? "").replace(/[^\d.,\-]/g, "");
        return cell ? toNum(cell) : null;
      };
      return { quarters: qIdx.map(pick), annual: pick(aIdx) };
    }
  }
  return null;
}

export function auditQuarters(input: QuarterAuditInput): QuarterIssue[] {
  const issues: QuarterIssue[] = [];
  const { content, confirmed } = input;

  for (const [label, re] of [["매출", /매출/], ["영업이익", /영업이익/]] as const) {
    const t = readQuarterTable(content, re as RegExp);
    if (!t || t.annual === null) continue;

    const qs = t.quarters.filter((v): v is number => v !== null);
    if (qs.length !== 4) continue; // 4개가 다 있어야 합을 따질 수 있다

    const sum = qs.reduce((a, b) => a + b, 0);
    const drift = Math.abs(sum - t.annual) / Math.max(1, Math.abs(t.annual));
    if (drift > SUM_TOLERANCE) {
      issues.push({
        code: "sum-mismatch",
        message:
          `${label} 분기 합계가 연간계와 다릅니다.\n` +
          `  Q1~Q4 합계 ${sum.toFixed(1)} vs 연간계 ${t.annual.toFixed(1)} (${(drift * 100).toFixed(1)}% 차이)\n` +
          `연간E는 분기의 합이어야 합니다. 분기를 고치거나 연간계를 다시 계산하세요.`,
      });
    }
  }

  // 확정 분기 값을 바꾸지 않았는지
  const revT = readQuarterTable(content, /매출/);
  const opT  = readQuarterTable(content, /영업이익/);
  for (const c of confirmed) {
    const check = (label: string, actual: number | null, written: number | null | undefined) => {
      if (actual === null || written == null) return;
      const d = Math.abs(written - actual) / Math.max(1, Math.abs(actual));
      if (d > CONFIRMED_TOLERANCE) {
        issues.push({
          code: "confirmed-changed",
          message:
            `Q${c.quarter} ${label}은 이미 공시된 확정값인데 다른 숫자가 적혔습니다.\n` +
            `  확정 ${actual.toFixed(1)} vs 보고서 ${written.toFixed(1)}\n` +
            `확정 분기는 추정 대상이 아닙니다. 공시값을 그대로 쓰세요.`,
        });
      }
    };
    check("매출", c.revenue, revT?.quarters[c.quarter - 1]);
    check("영업이익", c.operatingIncome, opT?.quarters[c.quarter - 1]);
  }

  // "상향/하향 조정"이라 쓰고 숫자가 그대로인 경우
  for (const line of content.split("\n")) {
    if (!/(상향|하향)\s*조정/.test(line)) continue;
    const nums = [...line.matchAll(/([\d,]+(?:\.\d+)?)\s*억원/g)].map(m => toNum(m[1]));
    const valid = nums.filter((v): v is number => v !== null);
    if (valid.length >= 2 && valid[0] === valid[1]) {
      issues.push({
        code: "empty-adjustment",
        message:
          `"조정"이라고 썼는데 앞뒤 숫자가 같습니다.\n  ${line.trim()}\n` +
          `실제로 값을 바꿨으면 바뀐 숫자를 쓰고, 바꾸지 않았으면 "유지"라고 쓰세요.`,
      });
    }
  }

  return issues;
}

/** QC 피드백으로 넘길 문자열. 문제가 없으면 null */
export function formatQuarterIssues(issues: QuarterIssue[]): string | null {
  if (issues.length === 0) return null;
  return [
    "⛔ 분기·연간 정합성 검산 실패 — 아래를 고쳐 다시 작성하세요.",
    ...issues.map((i, n) => `${n + 1}. ${i.message}`),
  ].join("\n");
}

/**
 * reconcile-audit.ts — 절대가치와 상대가치를 **실제로 조율했는지** 서버가 검산한다.
 *
 * 메디포스트(분석 1132)에서 이런 일이 있었다.
 *
 *   rNPV 주당가치      41,325원
 *   피어 멀티플 목표가   9,000원
 *   괴리율            359.2%
 *   → "rNPV 모델에 더 큰 신뢰를 두어 최종 목표주가를 조율합니다"
 *   → FINAL_VALUATION_DATA.base = 41,325   ← 조율한 적이 없다. 절대값 그대로다.
 *
 * 프롬프트는 "가중평균하라"고 말하지만 LLM은 문장으로 조율을 **서술만** 하고 숫자는
 * 한쪽을 그대로 쓴다. SOTP 표에서 `배수 × 기준값 = EV` 산수를 서버가 검산하기로 한 것과
 * 같은 이유다 — 프롬프트로 "정확히 계산하라"고 해도 계산은 틀린다.
 *
 * 같은 분석에서 상대가치 3시나리오가 bear=base=bull=9,000으로 전부 같았다.
 * 시나리오를 만들지 않고 한 값을 복사한 것이다. 이것도 여기서 잡는다.
 *
 * DB를 모르는 순수 함수만 둔다.
 */

/** FINAL_VALUATION_DATA에서 뽑아낸, 검산에 필요한 값들 */
export interface ReconcileInput {
  base: number | null;
  absBase: number | null;
  relBase: number | null;
  relBear: number | null;
  relBull: number | null;
  absBear: number | null;
  absBull: number | null;
  /** 이 모델이 쓰기로 한 절대가치 가중치(0~1) */
  absWeight: number;
}

export interface ReconcileIssue {
  code: "not-reconciled" | "flat-relative" | "flat-absolute" | "abs-equals-rel";
  message: string;
}

/**
 * 조율 허용 오차. 15%로 둔 이유:
 * 가중평균을 정직하게 하고 반올림·시나리오 조정을 얹으면 10% 안쪽에서 움직인다.
 * 그보다 크게 벗어났다면 가중치를 쓰지 않고 한쪽을 그대로 가져온 것이다.
 */
const TOLERANCE = 0.15;

export function auditReconciliation(v: ReconcileInput): ReconcileIssue[] {
  const issues: ReconcileIssue[] = [];
  const ok = (n: number | null): n is number => n !== null && Number.isFinite(n) && n > 0;

  // ── 상대가치 3시나리오가 같은 값인가 ────────────────────────────────────
  // 시나리오를 세우지 않고 한 값을 복사하면 밴드가 의미를 잃는다.
  if (ok(v.relBear) && ok(v.relBase) && ok(v.relBull) &&
      v.relBear === v.relBase && v.relBase === v.relBull) {
    issues.push({
      code: "flat-relative",
      message:
        `상대가치 3시나리오가 모두 ${v.relBase.toLocaleString()}원으로 동일합니다. ` +
        `Bear·Base·Bull은 적용 배수나 기준 실적을 달리해 각각 계산해야 합니다 — ` +
        `한 값을 복사해 넣지 마세요.`,
    });
  }

  if (ok(v.absBear) && ok(v.absBase) && ok(v.absBull) &&
      v.absBear === v.absBase && v.absBase === v.absBull) {
    issues.push({
      code: "flat-absolute",
      message:
        `절대가치 3시나리오가 모두 ${v.absBase.toLocaleString()}원으로 동일합니다. ` +
        `가정(성장률·PoS·배수)을 달리해 시나리오별로 다시 계산하세요.`,
    });
  }

  // ── 절대·상대가 같은 값인가 ────────────────────────────────────────────
  // 서로 다른 방법으로 구한 값이 정확히 일치할 수는 없다. 한쪽을 베낀 것이다.
  if (ok(v.absBase) && ok(v.relBase) && v.absBase === v.relBase) {
    issues.push({
      code: "abs-equals-rel",
      message:
        `절대가치와 상대가치가 ${v.absBase.toLocaleString()}원으로 정확히 같습니다. ` +
        `두 방법은 서로 다른 근거를 쓰므로 값이 일치할 수 없습니다 — 한쪽을 복사하지 마세요.`,
    });
  }

  // ── 최종값이 정말 가중평균인가 ─────────────────────────────────────────
  if (ok(v.base) && ok(v.absBase) && ok(v.relBase)) {
    const expected = v.absBase * v.absWeight + v.relBase * (1 - v.absWeight);
    const drift = Math.abs(v.base - expected) / expected;

    if (drift > TOLERANCE) {
      const gap = Math.abs(v.absBase - v.relBase) / Math.min(v.absBase, v.relBase) * 100;
      const a = Math.round(v.absWeight * 100);
      issues.push({
        code: "not-reconciled",
        message:
          `조율이 실제로 반영되지 않았습니다.\n` +
          `  절대가치 ${v.absBase.toLocaleString()}원 · 상대가치 ${v.relBase.toLocaleString()}원 (괴리 ${gap.toFixed(0)}%)\n` +
          `  가중평균 ${a}:${100 - a} → ${Math.round(expected).toLocaleString()}원\n` +
          `  그런데 base = ${v.base.toLocaleString()}원 (${(drift * 100).toFixed(0)}% 벗어남)\n` +
          `조율을 문장으로 서술만 하고 한쪽 값을 그대로 쓴 것으로 보입니다. ` +
          `가중치를 다르게 적용하려면 그 사유를 밝히고, base를 실제 계산 결과로 다시 쓰세요.`,
      });
    }
  }

  return issues;
}

/** QC 피드백으로 넘길 문자열. 문제가 없으면 null */
export function formatReconcileIssues(issues: ReconcileIssue[]): string | null {
  if (issues.length === 0) return null;
  return [
    "⛔ 밸류에이션 조율 검산 실패 — 아래를 고쳐 다시 작성하세요.",
    ...issues.map((i, n) => `${n + 1}. ${i.message}`),
  ].join("\n");
}

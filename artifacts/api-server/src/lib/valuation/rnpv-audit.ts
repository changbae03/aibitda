/**
 * rnpv-audit.ts — rNPV의 자기검증(Sanity Check)이 **구속력을 갖게** 한다.
 *
 * 프롬프트는 이미 검증을 지시한다.
 *   `TAM Sanity Check: 글로벌 TAM $___ 대비 [__% 수준 — 합리적/과대/과소]`
 *   `Peak Sales 유사약물 Sanity Check (반드시 수행)`
 *
 * 문제는 AI가 그 검증을 **수행하고, 빨간불을 계산하고, 스스로 끈다**는 것이다.
 * 메디포스트(분석 1132)에서 이런 일이 있었다.
 *
 *   TAM = 45조원(≈$32B)
 *   "골관절염 전체 시장 $15~22B 대비 200% 수준 — 일본 시장 특성을 감안 시 합리적"
 *   → 일본 한 나라의 시장이 전 세계 시장의 2배라는 뜻인데 그대로 통과했다.
 *
 *   "Peak Sales 가정이 유사약물(카티스템 한국 300억) 대비 750% 수준 → 합리적"
 *
 * 이 rNPV가 목표주가 41,325원(현재가의 5.1배)의 근거였다.
 *
 * ⚠️ 여기서 잡는 것은 **산수 오류가 아니다.** 메디포스트의 계산은 전부 맞았다
 * (TAM = 300만명 × 1,500만원 = 45조원). 잡는 것은 "이상치를 근거 없이 합리적이라고
 * 결론낸 것"이다. 그래서 판정을 뒤집으라고 하지 않고, **근거를 대거나 가정을 낮추라**고 한다.
 *
 * DB를 모르는 순수 함수만 둔다.
 */

export interface RnpvIssue {
  code: "tam-over-global" | "peak-sales-outlier";
  message: string;
}

/**
 * 지역 TAM이 글로벌 TAM의 이 배율을 넘으면 근거가 필요하다.
 * 120%로 둔 이유: 글로벌 적응증 전체를 노리는 약물이면 100% 언저리가 정상이다.
 * 그보다 확실히 크면 벤치마크를 잘못 골랐거나 환자수·단가가 과대하다.
 */
const TAM_LIMIT_PCT = 120;

/**
 * 유사약물 실적 대비 이 배율을 넘으면 근거가 필요하다.
 * 300%로 둔 이유: 시장 규모·약가 차이로 2~3배는 설명이 되지만, 그 이상은
 * "왜 이 약만 유독 잘 팔리는가"를 따로 대야 한다.
 */
const PEAK_LIMIT_PCT = 300;

/** 이상치를 이 단어들로 넘기면 근거로 치지 않는다 */
const DISMISSAL = /합리적|타당|적정|무리\s*없|문제\s*없/;

/** "… 대비 750% 수준 …" 같은 줄에서 배율과 결론을 뽑는다 */
function readRatioLines(content: string, marker: RegExp): Array<{ pct: number; line: string }> {
  const out: Array<{ pct: number; line: string }> = [];
  for (const raw of content.split("\n")) {
    if (!marker.test(raw)) continue;
    // 대비 200% / 대비 750 % / 대비 1,200% 를 모두 받는다
    const m = raw.match(/대비\s*([\d,]+(?:\.\d+)?)\s*%/);
    if (!m) continue;
    const pct = Number(m[1].replace(/,/g, ""));
    if (Number.isFinite(pct)) out.push({ pct, line: raw.trim() });
  }
  return out;
}

export function auditRnpv(content: string): RnpvIssue[] {
  const issues: RnpvIssue[] = [];

  for (const { pct, line } of readRatioLines(content, /TAM\s*Sanity\s*Check/i)) {
    if (pct > TAM_LIMIT_PCT && DISMISSAL.test(line)) {
      issues.push({
        code: "tam-over-global",
        message:
          `TAM이 글로벌 벤치마크의 ${pct}% 인데 "합리적"으로 결론냈습니다.\n` +
          `  ${line}\n` +
          `특정 지역·적응증의 TAM이 글로벌 시장 전체를 넘어설 수는 없습니다. ` +
          `벤치마크를 잘못 골랐는지, 대상 환자 수나 치료 단가가 과대한지 다시 보고, ` +
          `둘 다 맞다면 왜 이 지역이 글로벌 합계보다 큰지 근거를 대세요. ` +
          `근거가 없으면 환자 수 또는 단가를 낮춰 다시 계산하세요.`,
      });
    }
  }

  for (const { pct, line } of readRatioLines(content, /Peak\s*Sales.*Sanity|유사약물/i)) {
    if (pct > PEAK_LIMIT_PCT && DISMISSAL.test(line)) {
      issues.push({
        code: "peak-sales-outlier",
        message:
          `Peak Sales 가정이 유사약물 실적의 ${pct}% 인데 "합리적"으로 결론냈습니다.\n` +
          `  ${line}\n` +
          `시장 규모·약가 차이로 2~3배까지는 설명이 되지만 그 이상은 따로 근거가 필요합니다. ` +
          `이 약이 유사약물보다 유독 잘 팔릴 이유(효능 우위·경쟁 부재·적응증 확대)를 ` +
          `수치로 제시하거나, 침투율이나 단가 가정을 낮춰 다시 계산하세요.`,
      });
    }
  }

  return issues;
}

/** QC 피드백으로 넘길 문자열. 문제가 없으면 null */
export function formatRnpvIssues(issues: RnpvIssue[]): string | null {
  if (issues.length === 0) return null;
  return [
    "⛔ rNPV 자기검증 실패 — 이상치를 근거 없이 통과시켰습니다.",
    ...issues.map((i, n) => `${n + 1}. ${i.message}`),
  ].join("\n");
}

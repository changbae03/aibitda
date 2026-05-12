/**
 * 리포트 자동 QA 채점기
 * 완성된 분석 리포트를 항목별로 채점해 0-100점 + 실패 플래그를 반환
 */

export interface QACheck {
  key: string;
  label: string;
  maxPoints: number;
  points: number;
  passed: boolean;
  detail?: string;
}

export interface QAResult {
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  checks: QACheck[];
  flags: string[];
}

const REQUIRED_STEPS = [
  "company_intro",
  "industry_analysis",
  "catalyst_analysis",
  "company_analysis",
  "relative_valuation",
  "market_analysis",
  "investment_strategy",
];

export function runQACheck(analysis: {
  investmentVerdict?: string | null;
  targetPrice?: number | null;
  entryPrice?: number | null;
  stopLoss?: number | null;
  riskRewardRatio?: number | null;
  startPrice?: number | null;
  ticker?: string | null;
  steps: Array<{ stepKey: string; content: string }>;
}): QAResult {
  const { investmentVerdict, targetPrice, entryPrice, stopLoss, riskRewardRatio, startPrice, ticker, steps } = analysis;
  const stepMap = new Map(steps.map(s => [s.stepKey, s.content ?? ""]));
  const checks: QACheck[] = [];

  const add = (key: string, label: string, max: number, passed: boolean, detail?: string) =>
    checks.push({ key, label, maxPoints: max, points: passed ? max : 0, passed, detail });

  // ── 필수 수치 항목 (35pts) ────────────────────────────────────────────────
  add("has_target_price",  "목표가 설정",       10, !!(targetPrice && targetPrice > 0));
  add("has_verdict",       "투자 의견 설정",    10, !!(investmentVerdict?.trim()));
  add("has_stop_loss",     "손절가 설정",        6, !!(stopLoss && stopLoss > 0));
  add("has_entry_price",   "진입가 설정",        6, !!(entryPrice && entryPrice > 0));
  add("has_risk_reward",   "위험/보상 비율",     3, !!(riskRewardRatio && riskRewardRatio > 0));

  // ── 섹션 완성도 (24pts) ───────────────────────────────────────────────────
  const presentSteps = REQUIRED_STEPS.filter(k => (stepMap.get(k)?.length ?? 0) > 100);
  const missingSteps = REQUIRED_STEPS.filter(k => !presentSteps.includes(k));
  add("all_steps", "7개 분석 섹션 완성", 14, missingSteps.length === 0,
    missingSteps.length > 0 ? `누락: ${missingSteps.join(", ")}` : undefined);

  const MIN_LEN = 500;
  const shortSteps = REQUIRED_STEPS.filter(k => (stepMap.get(k)?.length ?? 0) < MIN_LEN);
  add("content_length", "섹션 내용 충분도 (각 500자↑)", 10, shortSteps.length === 0,
    shortSteps.length > 0 ? `짧은 섹션: ${shortSteps.join(", ")}` : undefined);

  // ── 밸류에이션 품질 (25pts) ───────────────────────────────────────────────
  const valContent = stepMap.get("relative_valuation") ?? "";

  const hasDCF = /DCF|할인현금|잉여현금|FCFF|FCFE|rNPV/i.test(valContent)
    && /\|.+\|.+\|/.test(valContent);
  add("has_dcf_table", "DCF/rNPV 밸류에이션 테이블", 15, hasDCF,
    !hasDCF ? "DCF 또는 rNPV 테이블 없음" : undefined);

  const tableDataRows = (valContent.match(/^\|[^-|][^|]*\|/gm) ?? []).length;
  const hasPeer = /피어|동종|Peer|비교|comparable/i.test(valContent) && tableDataRows >= 5;
  add("has_peer_table", "피어 비교 테이블 (3개↑)", 10, hasPeer,
    !hasPeer ? "피어 비교 테이블 없음 또는 행 부족" : undefined);

  // ── 오류/플레이스홀더 없음 (8pts) ────────────────────────────────────────
  const allContent = steps.map(s => s.content).join("\n");
  const placeholderRe = /\[데이터 없음\]|\[미산출\]|\[N\/A\]|ERROR:|할당량.*초과|quota.*exceeded|PLACEHOLDER/i;
  add("no_placeholder", "오류·플레이스홀더 없음", 5, !placeholderRe.test(allContent),
    placeholderRe.test(allContent) ? "오류 문자열 또는 플레이스홀더 감지됨" : undefined);

  const stratContent = stepMap.get("investment_strategy") ?? "";
  const hasBullBear = /Bull|Bear|시나리오|Scenario/i.test(stratContent);
  add("has_scenarios", "Bull/Bear 시나리오 포함", 3, hasBullBear,
    !hasBullBear ? "투자 전략에 시나리오 분석 없음" : undefined);

  // ── 밸류에이션 합리성 검사 (추가) ────────────────────────────────────────
  if (targetPrice && targetPrice > 0 && startPrice && startPrice > 0) {
    const upside = (targetPrice - startPrice) / startPrice * 100;
    const isKR = ticker ? /^\d{6}$/.test(ticker) : false;

    // 과도한 업사이드 체크: KR ≥100%, US ≥150%
    const excessiveThreshold = isKR ? 100 : 150;
    const isExcessiveUpside = upside > excessiveThreshold;
    add(
      "reasonable_upside",
      `목표가 합리성 (업사이드 ${excessiveThreshold}% 이내)`,
      0,
      !isExcessiveUpside,
      isExcessiveUpside
        ? `업사이드 ${upside.toFixed(1)}% — 목표가가 현재가의 ${(targetPrice/startPrice).toFixed(2)}×. DCF 가정 재검토 필요.`
        : undefined
    );

    // 극단적 다운사이드 체크: -70% 미만
    const isExtremeDownside = upside < -70;
    add(
      "reasonable_downside",
      "목표가 합리성 (다운사이드 -70% 이내)",
      0,
      !isExtremeDownside,
      isExtremeDownside
        ? `다운사이드 ${upside.toFixed(1)}% — 목표가가 현재가의 ${(targetPrice/startPrice).toFixed(2)}×. 계산 오류 의심.`
        : undefined
    );
  }

  // ── 점수 계산 ─────────────────────────────────────────────────────────────
  const scoringChecks = checks.filter(c => c.maxPoints > 0);
  const earned = scoringChecks.reduce((s, c) => s + c.points, 0);
  const total  = scoringChecks.reduce((s, c) => s + c.maxPoints, 0);
  const score  = Math.round((earned / total) * 100);
  const grade: QAResult["grade"] =
    score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";

  // 점수 미반영 체크도 플래그에는 포함
  const flags = checks.filter(c => !c.passed).map(c => c.key);

  return { score, grade, checks, flags };
}

/**
 * 리포트 자동 QA 채점기
 * 완성된 분석 리포트를 항목별로 채점해 0-100점 + 실패 플래그를 반환
 *
 * 채점 항목:
 *  [필수 수치] 목표가, 투자의견, 손절가, 진입가, 위험보상비율
 *  [섹션 완성도] 7개 섹션 존재 여부 + 최소 500자
 *  [밸류에이션 품질] DCF/rNPV 또는 P/B-ROE 테이블, 피어 비교 테이블
 *  [수치 일관성] 가격 순서, 판정-업사이드 일치, WACC 범위, CAGR 범위, Bull>Base>Bear
 *  [오류·플레이스홀더] 에러 문자열 없음, Bull/Bear 시나리오 존재
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
  steps: Array<{ stepKey: string; content: string }>;
}): QAResult {
  const { investmentVerdict, targetPrice, entryPrice, stopLoss, riskRewardRatio, steps } = analysis;
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

  const isFinancialReport = /P\/B.ROE|P\/B-ROE|BVPS|자기자본이익률.*CoE|Justified.P\/B|NIM|NPL비율|예금.*대출|금융지주|은행.*보험|증권.*BPS/i.test(valContent);
  const hasDCF = /DCF|할인현금|잉여현금|FCFF|FCFE|rNPV/i.test(valContent)
    && /\|.+\|.+\|/.test(valContent);
  const hasPBROE = isFinancialReport
    && /BPS|BVPS|P\/B/i.test(valContent)
    && /\|.+\|.+\|/.test(valContent);
  add("has_dcf_table", "DCF/rNPV 또는 P/B-ROE 밸류에이션 테이블", 15, hasDCF || hasPBROE,
    !(hasDCF || hasPBROE) ? "DCF/rNPV 또는 P/B-ROE(금융주) 테이블 없음" : undefined);

  const tableDataRows = (valContent.match(/^\|[^-|][^|]*\|/gm) ?? []).length;
  const hasPeer = /피어|동종|Peer|비교|comparable/i.test(valContent) && tableDataRows >= 5;
  add("has_peer_table", "피어 비교 테이블 (3개↑)", 10, hasPeer,
    !hasPeer ? "피어 비교 테이블 없음 또는 행 부족" : undefined);

  // ── 수치 일관성 검증 (28pts) ──────────────────────────────────────────────

  // 1. 가격 순서: 손절가 < 진입가 ≤ 목표가
  const priceOrderOk =
    !!(targetPrice && entryPrice && stopLoss &&
       stopLoss < entryPrice && entryPrice <= targetPrice);
  const priceOrderUnavailable = !(targetPrice && entryPrice && stopLoss);
  add(
    "price_order",
    "가격 순서 일관성 (손절<진입≤목표)",
    8,
    priceOrderOk || priceOrderUnavailable,
    !priceOrderOk && !priceOrderUnavailable
      ? `손절(${stopLoss}) / 진입(${entryPrice}) / 목표(${targetPrice}) — 순서 비정상`
      : undefined,
  );

  // 2. 판정-업사이드 일관성: Strong Buy/Buy는 업사이드 10%↑, Sell/Strong Sell은 업사이드 -5%↓
  let verdictUpsideOk = true;
  let verdictUpsideDetail: string | undefined;
  if (investmentVerdict && entryPrice && targetPrice && entryPrice > 0) {
    const upside = (targetPrice - entryPrice) / entryPrice * 100;
    const v = investmentVerdict.trim().toLowerCase();
    if ((v === "strong buy" || v === "buy") && upside < 10) {
      verdictUpsideOk = false;
      verdictUpsideDetail = `${investmentVerdict}인데 업사이드 ${upside.toFixed(1)}% — 목표가 신뢰성 검토 필요`;
    } else if ((v === "sell" || v === "strong sell") && upside > -5) {
      verdictUpsideOk = false;
      verdictUpsideDetail = `${investmentVerdict}인데 업사이드 ${upside.toFixed(1)}% — 판정-목표가 논리 불일치`;
    }
  }
  add("verdict_upside", "판정-업사이드 일관성", 6, verdictUpsideOk, verdictUpsideDetail);

  // 3. WACC 합리성: 5~20% 범위 (한국 주식 기준)
  const waccMatch = valContent.match(/WACC[^\d%\n]{0,15}(\d+(?:\.\d+)?)\s*%/i);
  let waccOk = true;
  let waccDetail: string | undefined;
  if (waccMatch) {
    const wacc = parseFloat(waccMatch[1]);
    if (wacc < 5 || wacc > 20) {
      waccOk = false;
      waccDetail = `WACC ${wacc}% — 비정상 범위 (정상: 5~20%)`;
    }
  }
  add("wacc_range", "WACC 합리성 (5~20%)", 5, waccOk, waccDetail);

  // 4. CAGR 합리성: 단일 연도 성장률 60% 초과 시 과도한 가정 경고
  const cagrMatches = Array.from(
    valContent.matchAll(/(?:CAGR|매출성장률|Revenue\s*Growth|성장률)[^\d\n]{0,20}(\d+(?:\.\d+)?)\s*%/gi)
  );
  let cagrOk = true;
  let cagrDetail: string | undefined;
  for (const m of cagrMatches) {
    const num = parseFloat(m[1]);
    if (num > 60) {
      cagrOk = false;
      cagrDetail = `성장률 가정 ${num}% — 과도한 수준 (60% 초과, 섹터 적합성 검토 필요)`;
      break;
    }
  }
  add("cagr_range", "성장률 가정 합리성 (≤60%)", 5, cagrOk, cagrDetail);

  // 5. Bull > Base > Bear 시나리오 가격 순서 검증
  const stratContent = stepMap.get("investment_strategy") ?? "";
  const hasBullBear = /Bull|Bear|시나리오|Scenario/i.test(stratContent);
  add("has_scenarios", "Bull/Bear 시나리오 포함", 3, hasBullBear,
    !hasBullBear ? "투자 전략에 시나리오 분석 없음" : undefined);

  // 시나리오 수치 순서 검증 (Bull > Base > Bear)
  const bullMatch = stratContent.match(/Bull[^:\n]{0,20}[:\s]+([\d,]+)/i);
  const baseMatch = stratContent.match(/Base[^:\n]{0,20}[:\s]+([\d,]+)/i);
  const bearMatch = stratContent.match(/Bear[^:\n]{0,20}[:\s]+([\d,]+)/i);
  let scenarioOrderOk = true;
  let scenarioOrderDetail: string | undefined;
  if (bullMatch && baseMatch && bearMatch) {
    const bull = parseFloat(bullMatch[1].replace(/,/g, ""));
    const base = parseFloat(baseMatch[1].replace(/,/g, ""));
    const bear = parseFloat(bearMatch[1].replace(/,/g, ""));
    if (bull <= base || base <= bear) {
      scenarioOrderOk = false;
      scenarioOrderDetail = `시나리오 순서 비정상: Bull(${bull.toLocaleString()}) > Base(${base.toLocaleString()}) > Bear(${bear.toLocaleString()}) 위반`;
    }
  }
  add("scenario_order", "Bull>Base>Bear 가격 순서", 4, scenarioOrderOk, scenarioOrderDetail);

  // ── 오류·플레이스홀더 없음 (5pts) ────────────────────────────────────────
  const allContent = steps.map(s => s.content).join("\n");
  const placeholderRe = /\[데이터 없음\]|\[미산출\]|\[N\/A\]|ERROR:|할당량.*초과|quota.*exceeded|PLACEHOLDER/i;
  add("no_placeholder", "오류·플레이스홀더 없음", 5, !placeholderRe.test(allContent),
    placeholderRe.test(allContent) ? "오류 문자열 또는 플레이스홀더 감지됨" : undefined);

  // ── 점수 계산 ─────────────────────────────────────────────────────────────
  const earned = checks.reduce((s, c) => s + c.points, 0);
  const total  = checks.reduce((s, c) => s + c.maxPoints, 0);
  const score  = Math.round((earned / total) * 100);
  const grade: QAResult["grade"] =
    score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";
  const flags = checks.filter(c => !c.passed).map(c => c.key);

  return { score, grade, checks, flags };
}

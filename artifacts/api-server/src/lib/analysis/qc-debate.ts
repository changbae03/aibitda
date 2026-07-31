// 팀장(Lead Strategist) 품질 검증(QC) + Devil's Advocate 토론 로직
import { db, pool } from "@workspace/db";
import { analysesTable, analysisStepsTable, modelInsightsTable } from "@workspace/db";
import { eq, desc, not, sql, and, isNotNull } from "drizzle-orm";
import { refreshBriefForTicker } from "../../routes/portfolio.js";
import { scheduleAnalysisSelfReview } from "../self-review.js";
import { validateTicker } from "../sanitize.js";
import { getUserId, checkAndDeductCredit } from "../credits.js";
import { loadKRXList, lookupKoreanName, correctKoreanTicker } from "../krx-cache";
import { cache, TTL } from "../mem-cache.js";
import { fetchDartSubjectBalance, fetchNaverPBR, writeMetricCache } from "../peer-collector.js";
import { validatePeers } from "../peer-validator.js";
import { fetchKISStockQuotes, buildKISStockContext } from "../kis-client.js";
import { fetchECOSMacro, buildECOSContext } from "../ecos-client.js";
import { fetchFREDMacro, buildFREDContext } from "../fred-client.js";
import { auditSotp, formatSotpIssues } from "./sotp-audit.js";
import { auditReconciliation, formatReconcileIssues } from "../valuation/reconcile-audit.js";
import { auditRnpv, formatRnpvIssues } from "../valuation/rnpv-audit.js";
import { auditQuarters, formatQuarterIssues } from "../valuation/quarter-audit.js";
import { findUngrounded, groundingScore, formatUngrounded } from "../biz-timeline-ground.js";
import { getBizTimeline } from "../biz-timeline.js";
import { getConfirmedQuarters } from "../dart-store.js";
import { extractValuation } from "./valuation-extract.js";
import { pickModel } from "../valuation/pick-model.js";
import { AGENTS, STEP_ORDER, buildPrompt, needsFinancialSector, type AgentKey } from "../ai-agents.js";
import { getCalibrationContext, classifySector } from "../../routes/performance.js";
import { triggerModelReview } from "../../routes/model-insights.js";
import { runQACheck } from "../qa-checker.js";
import { getDartHistoricalContext, fetchAndStoreDartQuarterly, getDartAnchorNumerics, type DartAnchorNumerics } from "../dart-store.js";
import { fetchDartBusinessContent, fetchDartCompetitorSection, fetchDartOrderBacklog } from "../dart-business-content.js";
import { fetchSECEdgarContent } from "../sec-edgar-content.js";
import { fetchKOSISData, buildKOSISContext } from "../kosis-client.js";
import { buildSOTPSubsidiaryContext, hasSOTPSubsidiaryData } from "../sotp-subsidiary-context.js";
import { getLatestMarketRegime } from "../market-regime-updater.js";
import { getSectorLearningNote } from "../sector-learning.js";
import { ai, geminiSemaphore } from "./gemini.js";
import { extractJsonSafe, extractFvdJson } from "./json-repair.js";
import { rawQuery } from "./store.js";

// ─── Lead Portfolio Strategist QC Check ──────────────────────────────────────

// 팀장 QC 검증 대상.
// dart_report_analysis를 넣은 이유: 이 단계는 출력의 숫자가 **원문에 있는지 기계로
// 대조된다.** 기간이 늘수록 LLM이 다른 해 값을 끌어오므로(실측 4→16개 기간에서
// 근거 확인 100%→41%) 검산 없이는 이 방향의 전제가 무너진다.
const QC_STEPS = new Set<AgentKey>(["company_analysis", "dart_report_analysis"]);

async function runQCCheck(
  stepKey: AgentKey,
  content: string,
  companyName: string,
  ticker: string,
  dartFloorAuk?: number | null,
  /** 조율 검산에서 모델 가중치를 고르는 데 쓴다 — 모델 선택과 같은 판정을 써야 한다 */
  industry?: string | null,
): Promise<{ approved: boolean; score: number; feedback: string }> {
  // 밸류에이션 단계(relative_valuation)의 검산 3종(SOTP·조율·rNPV)은 그 단계가
  // 파이프라인에서 빠지면서 호출부만 뺐다. 코드는 lib/valuation/에 그대로 있다 —
  // 목표주가를 다시 낼 일이 생기면 STEP_ORDER에 단계를 넣고 여기서 부르면 된다.

  // 사업보고서 시계열 분석은 **원문 대조가 가능하다** — 이 방향의 핵심 자산이다.
  // 목표주가가 맞는지는 1년을 기다려야 알지만, "2025년 원문에 136,795가 있나"는
  // 지금 확인된다. 실제로 기간이 4개에서 16개로 늘자 LLM이 다른 해 숫자를 끌어왔고
  // 근거 확인 비율이 100% → 41%로 떨어졌다. 프롬프트로는 못 막는다.
  if (stepKey === "dart_report_analysis") {
    const sources = (await getBizTimeline(ticker).catch(() => []))
      .map(t => ({ bsnsYear: t.bsnsYear, content: t.content }));
    if (sources.length >= 2) {
      const claims = findUngrounded(content, sources);
      const score = groundingScore(content, sources);
      console.log(`[qc] ${ticker} 사업보고서 근거 확인 ${(score * 100).toFixed(0)}% (${claims.length}건 미확인)`);
      const text = formatUngrounded(claims);
      if (text) {
        return { approved: false, score: 3, feedback: text };
      }
    }
  }

  // 확정 분기가 연간 전망을 구속해야 한다. 분기가 하나씩 확정될수록 연간은
  // 정확해져야 하는데, LLM은 연간을 먼저 정해놓고 분기를 끼워 맞추거나 확정된
  // 분기 값을 슬쩍 바꾼다. 메디포스트는 "743.7억원 → 743.7억원으로 상향 조정"이라고
  // 썼다 — 같은 숫자를 놓고 조정했다고 한 것이다.
  if (stepKey === "company_analysis") {
    const confirmed = await getConfirmedQuarters(ticker).catch(() => []);
    const qIssues = auditQuarters({ content, confirmed });
    const qText = formatQuarterIssues(qIssues);
    if (qText) {
      console.warn(`[qc] ${ticker} 분기·연간 검산 실패 — ${qIssues.map(i => i.code).join(", ")}`);
      return { approved: false, score: 3, feedback: qText };
    }
  }

  const agentName = AGENTS[stepKey].name;
  const isFundamental = stepKey === "company_analysis";
  // Use longer excerpts so full financial tables and key-metrics blocks are captured
  const excerptLength = isFundamental ? 5000 : 2500;
  // For fundamental analysis also include the tail (핵심 지표 도출 블록은 맨 끝에 위치)
  const tailLength = isFundamental ? 2000 : 0;
  const excerpt = tailLength > 0
    ? content.slice(0, excerptLength) + (content.length > excerptLength ? "\n...[중략]...\n" + content.slice(-tailLength) : "")
    : content.slice(0, excerptLength);
  const fundamentalExtra = isFundamental ? `

5. 실적 분석 정합성 (실적 분석 단계 전용 필수 검증):
   - 과거 3년 손익 계정 표가 없으면: 불승인
   - 수익성 표(영업이익률 포함)가 없으면: 불승인
   - 재무 건전성(부채비율 또는 순현금) 섹션이 없으면: 불승인
   - 컨센서스 전망치 섹션이 없으면: 불승인 (단, 커버리지 없음으로 명시한 경우는 통과)
   - 컨텍스트에 컨센서스 데이터가 있음에도 전망 섹션에서 전혀 언급하지 않으면: 불승인
   - 독자적 전망치("당사 전망", "AI 추정")를 만들었으면: 불승인 — 컨센서스만 소개 허용

6. 수치 정합성 검증 (실적 분석 단계 전용):
   - 매출성장률 YoY(%)가 테이블에 명시되어 있는데 실제 매출 수치로 역산한 성장률과 방향이 다르면: 불승인
   - 컨텍스트에 데이터가 없는 수치를 임의로 채웠으면: 불승인 (없으면 "—" 표기가 올바름)
   - 컨텍스트에 GPM(매출총이익률) 추세가 있음에도 GPM 추세에 역행하는 OPM 추정을 근거 없이 제시하면: 불승인
   - 컨텍스트에 서프라이즈 보정 지침(Beat/Miss 패턴)이 있음에도 추정치에 해당 보정을 전혀 반영하지 않으면: 감점(−2점)${(dartFloorAuk && dartFloorAuk > 0) ? `
   - [⛔ DART 확정 분기 하한선 체크] DART에서 확정된 올해 분기 영업이익 합계 = ${dartFloorAuk.toFixed(1)}억원. 이 값은 수학적 최솟값입니다(확정 분기 이후 분기들은 최소 0이므로). 보고서 실적 추정 테이블에서 올해E 영업이익을 찾아 단위를 변환(백만원→억 ÷10, 원→억 ÷1억)하여 비교하세요. 올해E 영업이익이 ${dartFloorAuk.toFixed(1)}억원 미만으로 추정되어 있으면: 즉시 불승인 (피드백에 "올해E 영업이익 수학적 하한선 위반: 확정 ${dartFloorAuk.toFixed(1)}억 > 추정 X억" 명시).` : ""}` : "";

  const prompt = `당신은 AI 헤지펀드 리서치 팀의 Lead Portfolio Strategist(팀장)입니다.
아래는 ${agentName}가 ${companyName}(${ticker})에 대해 작성한 분석 보고서입니다.

[보고서]
${excerpt}

다음 기준으로 품질을 평가하세요:
1. 구체적 수치 인용 (시장 규모, 성장률, 점유율, 재무 수치 등)
2. 핵심 이슈와의 명확한 연결
3. 투자 판단에 도움되는 실행 가능한 인사이트
4. 분석 깊이 (표면적 나열 vs 인과관계 해석)
5. 할루시네이션 방지 검증 (모든 단계 필수):
   - 다음 유형의 내용이 구체적 출처·근거 없이 기재되면 감점(-2점) 또는 불승인:
     · 실제 확인되지 않은 M&A·계약·파트너십 사실 주장
     · 경영진 발언·IR 내용을 인용 없이 단정 기술
     · 존재하지 않거나 검증 안 된 피어 기업명·수치 사용
     · 컨텍스트에 없는 수치를 있는 것처럼 제시
     · 특정 증권사·애널리스트명을 거론하며 목표가·의견 인용 (예: "OO증권은 목표가 X원을 제시") → 즉시 불승인
     · 임상시험 성공·실패, 규제 허가 결과를 컨텍스트 없이 단정 기술
   - "업계 평균으로 추정", "일반적으로 알려진 바에 의하면" 등으로 수치를 근거 없이 단정하면: 감점(-1점)
   - 산업 분석(industry_analysis) 단계에서 시장 규모·점유율 수치를 출처 없이 단정하면: 감점(-1점)${fundamentalExtra}

반드시 아래 JSON 형식으로만 응답하세요 (코드블록·설명 없이):
{"score": [1~10 정수], "approved": [7점 이상이면 true, 미만이면 false], "feedback": "미흡한 점 한 줄 요약 (approved이면 빈 문자열)"}`;

  try {
    await geminiSemaphore.acquire();
    let raw = "";
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          maxOutputTokens: 256,
          temperature: 0.1,
          topP: 0.8,
          thinkingConfig: { thinkingBudget: 0 },
        },
      });
      raw = response.text ?? "";
    } finally {
      geminiSemaphore.release();
    }
    const parsed = extractJsonSafe(raw);
    if (parsed && typeof parsed.score === "number") {
      return {
        score: Math.min(10, Math.max(1, Number(parsed.score))),
        approved: parsed.approved ?? Number(parsed.score) >= 7,
        feedback: String(parsed.feedback ?? ""),
      };
    }
  } catch (err) {
    console.error("[QC] check error:", err);
  }
  return { approved: true, score: 8, feedback: "" };
}

// ─── Devil's Advocate Debate ───────────────────────────────────────────────────

// Debate는 제거됨 — company_analysis는 QC 검증으로 대체
const DEBATE_STEPS = new Set<AgentKey>([]);



async function runDebateChallenge(
  stepKey: "company_analysis",
  draft: string,
  companyName: string,
  ticker: string
): Promise<string> {
  const isFundamental = stepKey === "company_analysis";
  const excerpt = draft.slice(0, 6000);

  const challengerPrompt = isFundamental
    ? `당신은 AI 헤지펀드 리서치 팀의 Devil's Advocate(반론 전문가)입니다.
아래는 ${companyName}(${ticker})의 실적 전망 초안입니다. 이 보고서의 핵심 가정에 대해 정확히 3가지 각도로 치열하게 반론하세요.

[반론 원칙]
- "틀렸다"가 아니라 "이 가정이 성립하려면 X 조건이 필요한데 그 증거가 부족하다"는 형식으로 작성
- 각 반론은 반드시 구체적 수치나 로직 근거 포함
- 낙관적 편향과 비관적 편향 모두 지적 가능

[반론 3가지]
1. 매출·성장률 가정 반론: 가장 낙관적으로 보이는 성장 가정의 약점 지적 (2-3문장)
2. 이익률·비용 가정 반론: 마진 추정의 취약한 논리 지적 (2-3문장)
3. 핵심 리스크 누락 반론: 실적 추정을 뒤엎을 수 있는 가장 중요한 하방 리스크 1개 제시 (2-3문장)

[초안]
${excerpt}

JSON·마크다운 테이블 없이 번호 형식으로 간결하게 작성 (총 400-700자).`
    : `당신은 AI 헤지펀드 리서치 팀의 Valuation Skeptic(밸류에이션 검증 전문가)입니다.
아래는 ${companyName}(${ticker})의 적정주가 산출 초안입니다. 밸류에이션의 핵심 가정을 정확히 3가지 각도로 검증하세요.

[반론 원칙]
- "틀렸다"가 아니라 "이 가정이 성립하려면 X 조건이 필요한데 그 근거가 불충분하다"는 형식
- 각 반론은 반드시 구체적 수치·비교 근거 포함
- ⚠️ 핵심 제약: 이 반론의 목적은 가정의 정밀도를 높이는 것입니다. 초안의 적정주가 방향성(저평가·고평가)을 뒤집거나 목표가를 초안 대비 ±25% 초과 이동시키는 주장은 하지 마세요.

[검증 3가지]
1. 할인율·WACC 가정 검증: WACC 또는 할인율 설정의 취약점 (2-3문장)
2. 성장률·멀티플 가정 검증: 터미널 성장률 또는 피어 배수 적용의 취약한 논리 (2-3문장)
3. 목표가 도출 검증: 최종 적정주가·밴드 산출 과정에서 가장 약한 논리적 연결고리 (2-3문장)

[초안]
${excerpt}

JSON·마크다운 테이블 없이 번호 형식으로 간결하게 작성 (총 400-700자).`;

  try {
    await geminiSemaphore.acquire();
    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("challenger timeout")), 25_000)
      );
      const response = await Promise.race([
        ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [{ role: "user", parts: [{ text: challengerPrompt }] }],
          config: {
            maxOutputTokens: 1024,
            temperature: 0.1,
            topP: 0.85,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
        timeoutPromise,
      ]);
      return response.text ?? "";
    } finally {
      geminiSemaphore.release();
    }
  } catch (err) {
    console.error(`[debate] challenger error (${stepKey}):`, err);
    return "";
  }
}

export { QC_STEPS, runQCCheck, DEBATE_STEPS, runDebateChallenge };

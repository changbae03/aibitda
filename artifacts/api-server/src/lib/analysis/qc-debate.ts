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

const QC_STEPS = new Set<AgentKey>(["relative_valuation", "company_analysis"]); // DA debate 이후 팀장 QC 추가 검증

async function runQCCheck(
  stepKey: AgentKey,
  content: string,
  companyName: string,
  ticker: string,
  dartFloorAuk?: number | null,
  /** 조율 검산에서 모델 가중치를 고르는 데 쓴다 — 모델 선택과 같은 판정을 써야 한다 */
  industry?: string | null,
): Promise<{ approved: boolean; score: number; feedback: string }> {
  // SOTP 표의 산수는 서버가 직접 검산한다. LLM에게 물으면 자기가 쓴 숫자를
  // 그대로 옳다고 하는 경우가 있어, 어긋나면 판정을 기다리지 않고 즉시 불승인한다.
  // 실제 사고: EV/Sales 두 행이 1/10로 계산돼 목표주가가 6배 왜곡됐다(한화시스템).
  if (stepKey === "relative_valuation") {
    const audit = auditSotp(content);
    const issues = formatSotpIssues(audit);
    if (issues) {
      console.warn(`[qc] ${ticker} SOTP 검산 실패 — ${audit.mismatches.length}행 불일치`);
      return { approved: false, score: 3, feedback: issues };
    }

    // 조율도 같은 이유로 서버가 검산한다.
    // 메디포스트에서 rNPV 41,325원과 피어 9,000원이 359% 벌어졌는데,
    // "rNPV에 더 큰 신뢰를 두어 조율합니다"라고 써놓고 base에 41,325를 그대로 넣었다.
    // LLM은 조율을 **문장으로 서술**하고 숫자는 한쪽을 복사하는 경향이 있다.
    const snapshot = extractValuation(content);
    if (snapshot) {
      const model = pickModel(industry ?? "", companyName, ticker);
      const rIssues = auditReconciliation({
        base: snapshot.base, absBase: snapshot.absBase,
        absBear: snapshot.absBear, absBull: snapshot.absBull,
        relBase: snapshot.relBase, relBear: snapshot.relBear, relBull: snapshot.relBull,
        absWeight: model.absWeight,
      });
      const rText = formatReconcileIssues(rIssues);
      if (rText) {
        console.warn(`[qc] ${ticker} 조율 검산 실패 — ${rIssues.map(i => i.code).join(", ")}`);
        return { approved: false, score: 3, feedback: rText };
      }
    }
  }

  const agentName = AGENTS[stepKey].name;
  const isFundamental = stepKey === "company_analysis";
  const isRelativeValuation = stepKey === "relative_valuation";
  // Use longer excerpts so full financial tables and key-metrics blocks are captured
  const excerptLength = isRelativeValuation ? 5000 : isFundamental ? 5000 : 2500;
  // For fundamental analysis also include the tail (핵심 지표 도출 블록은 맨 끝에 위치)
  const tailLength = isFundamental ? 2000 : 0;
  const excerpt = tailLength > 0
    ? content.slice(0, excerptLength) + (content.length > excerptLength ? "\n...[중략]...\n" + content.slice(-tailLength) : "")
    : content.slice(0, excerptLength);
  const fundamentalExtra = isFundamental ? `

5. 실적 전망 정합성 (실적 전망 단계 전용 필수 검증):
   - 재무 분석 섹션이 없으면: 불승인
   - 수익성 표(영업이익률 포함)가 없으면: 불승인 (단, 계산 불가 셀을 "—"으로 채운 경우는 통과)
   - 현금흐름 섹션이 아예 없으면: 불승인. 단, 현금흐름표 데이터가 없어 "N/A (컨텍스트에 현금흐름표 미제공)"으로 표기한 경우는 통과 허용
   - 재무건전성(부채비율 또는 순현금, 발행주식수)이 없으면: 불승인
   - Base 실적 추정 테이블(매출·영업이익·EBITDA·EPS 행)이 없으면: 불승인
   - EPS 수치가 아예 없으면: 불승인 (적자 기업의 음수 EPS는 유효, 추정값 명시 필요)
   - 밸류에이션을 위한 핵심 지표 도출 블록이 없으면: 불승인
   - 성장 동력 또는 리스크 요인 서술이 없으면: 불승인

6. 수치 정합성 검증 (실적 전망 단계 전용 — 수치 오류는 밸류에이션 전체를 망침):
   - 실적 추정 테이블의 EPS와 "순이익 ÷ 발행주식수" 결과가 ±20% 이상 차이 나면: 불승인
   - 매출성장률 YoY(%)가 테이블에 명시되어 있는데 실제 매출 수치로 역산한 성장률과 방향이 다르면(예: 매출은 감소인데 성장률은 +면): 불승인
   - EBITDA = 영업이익 + D&A 원칙이 지켜지지 않아 EBITDA < 영업이익인 비바이오 흑자 기업이면: 불승인 (단, D&A 데이터 없는 경우 통과)
   - 발행주식수 출처가 명시되지 않으면(KRX/Naver/Yahoo/서버계산 중 어느 것인지 불분명): 감점(−2점)
   - 컨텍스트에 애널리스트 컨센서스(EPS 또는 매출 전망)가 있음에도 전망 섹션에서 컨센서스를 전혀 언급하지 않으면: 불승인
   - 올해E 또는 내년E 영업이익률이 전년 실적 대비 +15%p 이상 점프했는데 전망 근거에 구체적 드라이버(원가 구조 변화·매출 레버리지·사업 믹스 개선 등) 없으면: 불승인
   - 컨텍스트에 이익 품질(현금전환율 OCF/순이익) 경고가 있음에도 순이익·EPS 추정에 이를 반영하지 않으면: 불승인
   - 컨텍스트에 GPM(매출총이익률) 추세가 있음에도 GPM 추세에 역행하는 OPM 추정을 근거 없이 제시하면: 불승인
   - 컨텍스트에 서프라이즈 보정 지침(Beat/Miss 패턴)이 있음에도 추정치에 해당 보정을 전혀 반영하지 않으면: 감점(−2점)${(dartFloorAuk && dartFloorAuk > 0) ? `
   - [⛔ DART 확정 분기 하한선 체크] DART에서 확정된 올해 분기 영업이익 합계 = ${dartFloorAuk.toFixed(1)}억원. 이 값은 수학적 최솟값입니다(확정 분기 이후 분기들은 최소 0이므로). 보고서 실적 추정 테이블에서 올해E 영업이익을 찾아 단위를 변환(백만원→억 ÷10, 원→억 ÷1억)하여 비교하세요. 올해E 영업이익이 ${dartFloorAuk.toFixed(1)}억원 미만으로 추정되어 있으면: 즉시 불승인 (피드백에 "올해E 영업이익 수학적 하한선 위반: 확정 ${dartFloorAuk.toFixed(1)}억 > 추정 X억" 명시).` : ""}` : isRelativeValuation ? `

5. 목표가 산출 정합성 — 팀장 직접 조율 검수 (전용 필수 검증):

  [구조 검증 — 하나라도 없으면 즉시 불승인]
   - 절대가치 산출 표가 없으면: 불승인 (DCF FCFF 테이블 또는 Pipeline rNPV 테이블 또는 EV/Sales 테이블 또는 DDM 계산 중 하나)
   - 피어 그룹 멀티플 비교 테이블이 없으면: 불승인
   - FINAL_VALUATION_DATA JSON이 없거나 파싱 불가이면: 즉시 불승인
   - 최종 적정주가·상단 밴드·하단 밴드 3개 수치가 모두 명시되지 않으면: 불승인
   - 최종 밸류에이션 핵심 지표 요약 블록이 없으면: 불승인

  [모델 선택 및 가정 검증]
   - 모델 가정 수립 섹션이 없으면: 불승인
   - WACC 산출 근거(Rf, β, ERP, CoE 수치)가 없으면: 불승인
   - 바이오/제약 기업이 임상단계(미허가 파이프라인 중심, 매출 극소)임에도 DCF를 선택했고, 선택 이유가 없거나 빈약하면: 불승인

  [절대가치 모델 품질 검증 — 선택된 모델에 따라 아래 중 하나 적용]
   A) DCF 모델: FCFF 10년 테이블이 있어야 하고, 주당 내재가치 수치가 있어야 함. Reverse DCF 분석이 없으면: 불승인
   B) Pipeline rNPV 모델: 파이프라인별 PoS·rNPV 표가 있어야 하고, 주당 내재가치 수치가 있어야 함. 현재 주가 역산 분석이 없으면: 불승인
   C) EV/Sales 모델: EV/Sales 배수·산출 EV·주당 내재가치 수치가 있어야 함
   D) DDM 모델: D₁·CoE·g·DDM 내재가치 수치가 있어야 함
   - 어떤 모델이든 최종 주당 내재가치(원) 수치가 없으면: 불승인
   - 내재가치가 현재 주가 대비 터무니없이 높거나(소형 성장주·바이오 3.5배↑, 일반 성숙 대형주 시총 5조↑ 2.0배↑) 낮으면(0.2배↓): 가정 재검토 여부 확인, 없으면 불승인
   - ⚠️ 성숙 대형주(시총 5조원↑, 예: 삼성전자·SK하이닉스·현대차·NAVER·카카오 등) 목표주가가 현재가 대비 +100% 초과인 경우: DCF 성장률 가정이 컨센서스를 크게 상회하거나 피어 배수 적용이 과도한 것으로 판단. Reverse DCF 역산 CAGR 명시 없으면 즉시 불승인

  [피어 조율 품질 검증]
   - 피어 기업이 3개 미만으로 선정되면: 불승인
   - 피어 기업명이 "Peer A", "Peer B", "Peer C", "Peer D" 등 플레이스홀더이면: 불승인 (실제 회사명 필수)
   - 피어 선정 논리(왜 이 피어들이 유의미한지)가 없으면: 불승인
   - 적용 멀티플(PER 또는 EV/EBITDA) 선택 이유가 없으면: 불승인
   - 프리미엄/디스카운트 적용 근거가 없으면: 불승인

  [조율 품질 검증 — 핵심]
   - DCF 내재가치와 피어 목표가 두 숫자가 모두 명시되지 않으면: 불승인
   - 괴리율이 명시되지 않으면: 불승인
   - 조율 방법(가중평균 수식 또는 Lead 조율 근거)이 없으면: 불승인
   - 상단/하단 밴드 산출 근거가 없으면: 불승인
   - 상단 밴드 = 하단 밴드이면(밴드 차이 없음): 불승인
   - 최종 적정주가가 상단 밴드보다 높거나 하단 밴드보다 낮으면: 불승인

  [극단값 방어]
   - 하단 밴드가 현재 주가의 20% 미만이면: 불승인
   - 목표주가(Base)가 현재 주가의 30% 미만이면: 불승인 (단, 보고서 내 부도·상장폐지 위험이 명시된 경우 예외)
   - EV/Sales 모델 적용 배수가 피어 평균 EV/Sales의 25% 미만이면(극단적 디스카운트): 불승인 — 반드시 배수 재검토
   - 바이오/제약 기업(업종 키워드: 바이오, 제약, 헬스케어, 세포치료, 줄기세포, Biotech, Pharma)에 PBR을 30% 이상 가중했으면: 불승인 (PBR은 자산 기반 성숙 기업 전용, 바이오텍 부적합)
   - FCF 음수이면서 매출성장률 30%+ 또는 EV/매출 10x+ 고성장 기업에 PBR을 30% 이상 가중했으면: 불승인
   - 바이오/제약 파이프라인 rNPV 할인율이 15%를 초과하면: 불승인 (PoS가 이미 임상 위험 반영 — 이중 할인 금지)
   - DCF 테이블에서 3개 이상 연도의 재투자(Reinvestment/CAPEX) 값이 동일한 숫자로 기재되어 있으면: 불승인 (과거 CAPEX 고정 오류 — S-to-C 기반 연도별 공식 계산 필수)
   - FCF 음수 고성장 기업(Year 1~3 FCFF 전부 음수 AND 매출성장률 1개 연도 이상 15%↑)임에도 DCF를 단독 모델(가중 60%↑)로 사용하고 EV/Sales 피어 비교가 없으면: 불승인` : "";

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

// ─── Devil's Advocate Debate (company_analysis & relative_valuation) ─────────

// Debate는 목표주가 산출(relative_valuation)에만 유지 — company_analysis는 QC 검증으로 대체
const DEBATE_STEPS = new Set<AgentKey>(["relative_valuation"]);



async function runDebateChallenge(
  stepKey: "company_analysis" | "relative_valuation",
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

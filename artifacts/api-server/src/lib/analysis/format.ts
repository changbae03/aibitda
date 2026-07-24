// API 응답 포맷터 — 표시용 content 정제, 분석/스텝 직렬화, 피드백 정제
import { STEP_ORDER, type AgentKey } from "../ai-agents.js";

// ─── 피드백 텍스트 보안 정제 ──────────────────────────────────────────────────
// 프롬프트 인젝션 방지: 명령형 패턴·제어문자·특수 구문을 제거
function sanitizeFeedback(raw: string): string {
  let s = raw
    .replace(/[\x00-\x1f\x7f]/g, " ")           // 제어 문자 제거
    .replace(/[<>\[\]{}]/g, "")                   // 브라켓류 제거
    .replace(/^[\s#*\-=_]+/gm, "")               // 줄 시작 마크다운 제거
    .trim()
    .slice(0, 300);                               // 저장 한도보다 짧게 자름

  // 프롬프트 인젝션 키워드 치환 (한/영)
  const injectionPatterns: [RegExp, string][] = [
    [/무시\s*하고/gi,          "***"],
    [/지금부터\s*[^은는이가]/gi, "***"],
    [/항상\s*(매수|매도|추천)/gi, "***"],
    [/반드시\s*(매수|매도|추천)/gi, "***"],
    [/system\s*:/gi,           "***"],
    [/assistant\s*:/gi,        "***"],
    [/user\s*:/gi,             "***"],
    [/ignore\s+(all\s+)?previous/gi, "***"],
    [/forget\s+previous/gi,    "***"],
    [/\bINST\b|\bSYS\b|\bHUMAN\b/g, "***"],
    [/분석\s*(결과|무효|조작)/gi, "***"],
  ];
  for (const [pat, rep] of injectionPatterns) {
    s = s.replace(pat, rep);
  }
  return s;
}

/**
 * 프론트엔드 표시용 content 정제.
 * DB에는 원본(체인 연결용) 보존, API 응답에서만 내부 섹션 제거.
 */
function stripDisplayContent(raw: string): string {
  if (!raw) return raw;
  return raw
    // ── CHAIN-HANDOFF 전체 섹션 제거 (--- 구분선 포함) ─────────────────
    .replace(/\n?---\n+##\s*📊\s*\[CHAIN-HANDOFF\][^\n]*\n[\s\S]*$/m, "")
    .replace(/\n?##\s*📊\s*\[CHAIN-HANDOFF\][^\n]*\n[\s\S]*$/m, "")
    // ── [CHAIN-HANDOFF] 레이블이 인라인으로 남은 경우 ────────────────────
    .replace(/\[CHAIN-HANDOFF\][^\n]*/g, "")
    // ── 체인 인계 규칙 선언 줄 ────────────────────────────────────────────
    .replace(/^📌\s*\*{0,2}\[체인 인계 규칙[^\]]*\][^\n]*/gm, "")
    .replace(/^→\s*이 문장으로 리포트가 시작[^\n]*/gm, "")
    // ── 내부 STEP 레이블 ──────────────────────────────────────────────────
    .replace(/^\[STEP\s*\d+\][^\n]*/gm, "")
    .replace(/^\[STEP\s*[A-Z]\][^\n]*/gm, "")
    .replace(/^\[내부\s*계산[^\]]*\][^\n]*/gm, "")
    // ── 지시 잔재 ─────────────────────────────────────────────────────────
    .replace(/^⛔\s*이 섹션은 다음 단계[^\n]*/gm, "")
    // ── 밸류에이션 핵심 지표 도출 섹션 제거 (실적 전망 단계 내부 계산용) ──
    // heading(##), bold(**), blockquote(>), 구분선(---) 포함 모든 형태 제거
    .replace(/\n?(?:---\n+)?(?:#{1,3}\s*|>\s*\*{1,2}|>\s*)밸류에이션을 위한 핵심 지표[\s\S]*?(?=\n#{1,3}\s|\n---\n#{1,3}|$)/g, "")
    // ── 연속 공백 정리 ────────────────────────────────────────────────────
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatStep(step: any) {
  return {
    id: step.id,
    analysisId: step.analysisId,
    stepKey: step.stepKey,
    agentName: step.agentName,
    agentRole: step.agentRole,
    content: stripDisplayContent(step.content),
    validationNotes: step.validationNotes,
    informationType: step.informationType,
    createdAt: step.createdAt?.toISOString?.() ?? step.createdAt,
  };
}

function formatAnalysis(analysis: any, steps: any[]) {
  const sortedSteps = [...steps].sort(
    (a, b) => STEP_ORDER.indexOf(a.stepKey as AgentKey) - STEP_ORDER.indexOf(b.stepKey as AgentKey)
  );
  return {
    id: analysis.id,
    ticker: analysis.ticker,
    companyName: analysis.companyName,
    englishName: analysis.englishName ?? null,
    industry: analysis.industry,
    additionalContext: analysis.additionalContext,
    status: analysis.status,
    currentStep: analysis.currentStep,
    investmentVerdict: analysis.investmentVerdict,
    targetPrice: analysis.targetPrice,
    startPrice: analysis.startPrice ?? null,
    entryPrice: analysis.entryPrice,
    stopLoss: analysis.stopLoss,
    riskRewardRatio: analysis.riskRewardRatio,
    memo: analysis.memo ?? null,
    userRating: analysis.userRating ?? null,
    userFeedback: analysis.userFeedback ?? null,
    steps: sortedSteps.map(formatStep),
    createdAt: analysis.createdAt?.toISOString?.() ?? analysis.createdAt,
    updatedAt: analysis.updatedAt?.toISOString?.() ?? analysis.updatedAt,
  };
}

export { sanitizeFeedback, stripDisplayContent, formatStep, formatAnalysis };

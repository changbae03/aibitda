/**
 * self-review.ts
 * 자동 배치 분석 완료 후 Gemini로 자체 검수(QA)를 수행하고
 * ticker_notes.memo에 검수 결과를 날짜 태그와 함께 앞에 추가한다.
 *
 * - 기존 관리자 메모를 덮어쓰지 않고 앞에 prepend
 * - 자동배치(user_id IS NULL) 분석에만 실행
 * - 비동기 fire-and-forget (분석 파이프라인 차단하지 않음)
 */

import { pool } from "@workspace/db";
import { GoogleGenAI } from "@google/genai";

const geminiApiKey = process.env.GEMINI_API_KEY ?? process.env.AI_INTEGRATIONS_GEMINI_API_KEY!;
const ai = new GoogleGenAI({
  apiKey: geminiApiKey,
  ...(process.env.GEMINI_API_KEY ? {} : {
    httpOptions: { baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL! },
  }),
});

const REVIEW_TAG = "[AI검수]";

// ─── 분석 ID → 완료된 분석 데이터 fetch ──────────────────────────────────────
async function fetchAnalysisForReview(analysisId: number) {
  const rows = await pool.query(
    `SELECT
       a.id, a.ticker, a.company_name, a.user_id, a.status,
       a.investment_verdict, a.target_price, a.entry_price, a.stop_loss,
       a.qa_score, a.start_price, a.risk_reward_ratio, a.industry,
       (SELECT content FROM analysis_steps WHERE analysis_id = a.id AND step_key = 'key_catalysts' LIMIT 1) AS catalysts,
       (SELECT content FROM analysis_steps WHERE analysis_id = a.id AND step_key = 'risk_factors'  LIMIT 1) AS risks,
       (SELECT content FROM analysis_steps WHERE analysis_id = a.id AND step_key = 'investment_strategy' LIMIT 1) AS strategy,
       (SELECT content FROM analysis_steps WHERE analysis_id = a.id AND step_key = 'company_overview' LIMIT 1) AS overview,
       (SELECT content FROM analysis_steps WHERE analysis_id = a.id AND step_key = 'qa_review' LIMIT 1) AS qa_text
     FROM analyses a
     WHERE a.id = $1`,
    [analysisId]
  );
  return rows.rows[0] ?? null;
}

async function fetchExistingMemo(ticker: string): Promise<string> {
  const { rows } = await pool.query(
    `SELECT memo FROM ticker_notes WHERE ticker = $1`,
    [ticker]
  );
  return rows[0]?.memo ?? "";
}

async function saveMemo(ticker: string, memo: string): Promise<void> {
  await pool.query(
    `INSERT INTO ticker_notes (ticker, memo, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (ticker) DO UPDATE SET memo = $2, updated_at = NOW()`,
    [ticker, memo]
  );
}

// ─── Gemini QA 검수 ───────────────────────────────────────────────────────────
async function runGeminiReview(analysis: any): Promise<string | null> {
  const today = new Date().toLocaleDateString("ko-KR", {
    year: "numeric", month: "long", day: "numeric",
  });

  const upsidePct = analysis.target_price && analysis.start_price
    ? ((analysis.target_price - analysis.start_price) / analysis.start_price * 100).toFixed(1)
    : null;

  const prompt = `당신은 주식 AI 분석 품질 검수 전문가입니다. 오늘은 ${today}입니다.
아래는 AI가 자동으로 생성한 ${analysis.company_name}(${analysis.ticker}) 분석 결과입니다.
이 분석에 대해 자체 검수를 수행하고, 다음 분석 시 반드시 고려해야 할 보정 사항을 작성하세요.

[분석 기본 정보]
- 판정: ${analysis.investment_verdict ?? "없음"}
- 목표주가: ${analysis.target_price ?? "없음"}
- 분석 시점 주가: ${analysis.start_price ?? "없음"}
- 업사이드: ${upsidePct != null ? upsidePct + "%" : "계산불가"}
- 진입가: ${analysis.entry_price ?? "없음"}
- 손절가: ${analysis.stop_loss ?? "없음"}
- 위험보상비율: ${analysis.risk_reward_ratio ?? "없음"}
- QA점수: ${analysis.qa_score ?? "없음"}
- 섹터: ${analysis.industry ?? "없음"}

[핵심 촉매]
${String(analysis.catalysts ?? "").slice(0, 500)}

[주요 리스크]
${String(analysis.risks ?? "").slice(0, 500)}

[투자 전략]
${String(analysis.strategy ?? "").slice(0, 400)}

[QA 검토 내용]
${String(analysis.qa_text ?? "").slice(0, 400)}

위 분석을 검수하여 다음 형식으로 응답하세요.
JSON만 출력하고 다른 텍스트는 절대 포함하지 마세요:

{
  "issues": ["논리적 불일치나 데이터 이상 (각 1문장씩, 없으면 빈 배열)"],
  "watchpoints": "다음 분석 시 반드시 확인해야 할 핵심 포인트 1-2문장",
  "calibration": "이 종목 특성상 AI 분석에서 자주 놓치는 점 또는 보정 필요 사항 1문장 (없으면 빈 문자열)"
}

검수 기준:
- Strong Buy/Buy인데 업사이드가 15% 미만이면 목표가 신뢰성 검토 필요
- Sell/Strong Sell인데 업사이드가 30% 이상이면 논리 불일치
- 목표주가가 현재가의 3배 이상이면 데이터 오류 가능성
- QA점수와 판정이 크게 불일치하면 지적
- 촉매와 리스크가 지나치게 일반적이면 지적
- 리스크가 전혀 없거나 매우 적으면 지적`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        maxOutputTokens: 800,
        temperature: 0.3,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    const raw = response.text ?? "";
    const cleaned = raw.replace(/```(?:json)?/g, "").replace(/```/g, "").trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;

    const parsed = JSON.parse(match[0]);
    const issues: string[] = Array.isArray(parsed.issues) ? parsed.issues : [];
    const watchpoints: string = parsed.watchpoints ?? "";
    const calibration: string = parsed.calibration ?? "";

    const parts: string[] = [];
    if (issues.length > 0) parts.push(`⚠️ ${issues.join(" / ")}`);
    if (watchpoints) parts.push(`👁 ${watchpoints}`);
    if (calibration) parts.push(`🔧 ${calibration}`);

    return parts.length > 0 ? parts.join("\n") : null;
  } catch (e) {
    console.error("[self-review] Gemini 호출 오류:", e);
    return null;
  }
}

// ─── 메인 진입점 (fire-and-forget으로 호출) ──────────────────────────────────
export async function runSelfReview(analysisId: number): Promise<void> {
  try {
    const analysis = await fetchAnalysisForReview(analysisId);
    if (!analysis) {
      console.log(`[self-review] analysis#${analysisId} not found — skip`);
      return;
    }

    // 자동배치 분석만 검수 (user_id IS NULL)
    if (analysis.user_id !== null) {
      return;
    }

    if (analysis.status !== "completed") {
      console.log(`[self-review] analysis#${analysisId} not completed (${analysis.status}) — skip`);
      return;
    }

    console.log(`[self-review] ${analysis.company_name}(${analysis.ticker}) 검수 시작…`);

    const reviewText = await runGeminiReview(analysis);
    if (!reviewText) {
      console.log(`[self-review] ${analysis.ticker} — 검수 결과 없음 (이상 없음)`);
      return;
    }

    // 기존 메모 앞에 추가 (관리자 메모 보존)
    const dateStr = new Date().toLocaleDateString("ko-KR", {
      year: "numeric", month: "2-digit", day: "2-digit",
    }).replace(/\. /g, ".").replace(/\.$/, "");

    const newBlock = `${REVIEW_TAG} ${dateStr}\n${reviewText}`;

    const existing = await fetchExistingMemo(analysis.ticker);

    // 오늘 날짜로 이미 검수된 경우 중복 추가 방지
    if (existing.includes(`${REVIEW_TAG} ${dateStr}`)) {
      console.log(`[self-review] ${analysis.ticker} — 오늘 이미 검수됨, 스킵`);
      return;
    }

    // 오래된 AI검수 블록 제거 후 새 블록 앞에 추가 (최대 3개 유지)
    const existingBlocks = existing.split(new RegExp(`(?=${REVIEW_TAG.replaceAll("[", "\\[")})`));
    const adminMemos = existingBlocks.filter(b => !b.startsWith(REVIEW_TAG));
    const aiReviews = existingBlocks.filter(b => b.startsWith(REVIEW_TAG)).slice(0, 2); // 최신 2개만 유지

    const combined = [newBlock, ...aiReviews, ...adminMemos]
      .map(s => s.trim())
      .filter(Boolean)
      .join("\n\n---\n\n");

    await saveMemo(analysis.ticker, combined);
    console.log(`[self-review] ${analysis.company_name}(${analysis.ticker}) 보정 메모 업데이트 완료`);
  } catch (e) {
    console.error(`[self-review] analysis#${analysisId} 오류:`, e);
  }
}

/**
 * 비동기 fire-and-forget 래퍼.
 * pipeline 완료 직후 30초 딜레이 후 실행 (DB 최종 커밋 대기).
 */
export function scheduleAnalysisSelfReview(analysisId: number): void {
  setTimeout(() => {
    runSelfReview(analysisId).catch(e => {
      console.error(`[self-review] 스케줄 실행 오류 (analysis#${analysisId}):`, e);
    });
  }, 30_000); // 30초 후 실행
}

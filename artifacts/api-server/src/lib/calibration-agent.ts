/**
 * calibration-agent.ts
 *
 * 분석 완료 후 AI가 리포트를 스스로 검토하여 "보정 메모"를 생성.
 * 생성된 메모는 ticker_notes.calibration_note에 저장되고
 * 다음 분석 시 동일 종목 프롬프트에 자동 주입된다.
 *
 * 실행 흐름:
 *   분석 완료 → QA 채점 → runCalibrationAgent() → ticker_notes 업데이트
 *
 * 주입 흐름:
 *   executeStep() 내부 → ticker_notes.calibration_note 읽기 → enrichedContext 주입
 */

import { GoogleGenAI } from "@google/genai";
import { pool } from "@workspace/db";

const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? "" });

export interface CalibrationInput {
  analysisId:  number;
  ticker:      string;
  companyName: string;
  qaScore:     number;
  qaGrade:     string;
  qaFlags:     string[];         // e.g. ["has_dcf_table", "has_peer_table"]
  peerFlags:   object | null;    // peer_flags JSON
  steps: Array<{
    stepKey: string;
    content: string;
  }>;
}

const FLAG_LABEL: Record<string, string> = {
  has_target_price:  "목표가 미설정",
  has_verdict:       "투자의견 미설정",
  has_stop_loss:     "손절가 미설정",
  has_entry_price:   "진입가 미설정",
  has_risk_reward:   "위험보상비율 미산출",
  all_steps:         "필수 분석 섹션 누락",
  content_length:    "일부 섹션 내용 부족 (500자 미만)",
  has_dcf_table:     "DCF/rNPV 밸류에이션 테이블 없거나 불완전",
  has_peer_table:    "피어 비교 테이블 없거나 행 부족",
  no_placeholder:    "플레이스홀더/오류 문자열 포함",
  has_scenarios:     "Bull/Bear 시나리오 분석 없음",
};

function buildPrompt(input: CalibrationInput): string {
  const flagList = input.qaFlags.length > 0
    ? input.qaFlags.map(f => `  - ${FLAG_LABEL[f] ?? f}`).join("\n")
    : "  (없음 — 모든 항목 통과)";

  const valContent  = input.steps.find(s => s.stepKey === "relative_valuation")?.content?.slice(0, 1200) ?? "(없음)";
  const stratContent = input.steps.find(s => s.stepKey === "investment_strategy")?.content?.slice(0, 800) ?? "(없음)";
  const compContent  = input.steps.find(s => s.stepKey === "company_analysis")?.content?.slice(0, 600) ?? "(없음)";

  const peerSummary = input.peerFlags
    ? JSON.stringify(input.peerFlags).slice(0, 400)
    : "(피어 검증 없음)";

  return `당신은 주식 리서치 리포트 품질 개선 전문가입니다.

아래는 ${input.companyName}(${input.ticker}) 분석 리포트의 자동 QA 결과와 핵심 섹션 일부입니다.
이 정보를 바탕으로 **다음 번 분석 시 반드시 개선해야 할 사항**을 3~6개 항목으로 정리하세요.

## QA 결과
- 종합 점수: ${input.qaScore}점 (${input.qaGrade}등급)
- 실패 항목:
${flagList}

## 피어 검증 요약
${peerSummary}

## 상대가치 분석 섹션 (일부)
${valContent}

## 투자 전략 섹션 (일부)
${stratContent}

## 기업 분석 섹션 (일부)
${compContent}

---

**출력 형식** (한국어, 각 항목은 "• "으로 시작, 1~2문장):
• [구체적 보정 사항]
• [구체적 보정 사항]
...

규칙:
- 각 항목은 **다음 분석에서 AI가 따라야 할 구체적 지시** 형태로 작성하세요.
- "잘 되어있습니다" 같은 칭찬은 쓰지 마세요. 개선 사항만 나열하세요.
- QA 통과 항목이라도 섹션 내용을 보고 추가 개선이 필요하면 포함하세요.
- 총 6개를 넘기지 마세요.
- 마크다운 제목(#)이나 코드블록 없이 순수 bullet 텍스트만 출력하세요.`;
}

export async function runCalibrationAgent(input: CalibrationInput): Promise<string | null> {
  const prompt = buildPrompt(input);

  try {
    const response = await genai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        temperature: 0.3,
        maxOutputTokens: 600,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    const text = response.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
    if (!text || text.length < 20) return null;

    // 불필요한 마크다운 제목 줄 제거
    const cleaned = text
      .split("\n")
      .filter(l => !l.startsWith("#") && !l.startsWith("```"))
      .join("\n")
      .trim();

    return cleaned || null;
  } catch (e: any) {
    console.error(`[calibration-agent] Gemini 호출 실패 (${input.ticker}):`, e?.message);
    return null;
  }
}

/**
 * 보정 메모를 ticker_notes.calibration_note에 저장.
 * 컬럼이 없으면 자동 생성.
 */
export async function saveCalibrationNote(ticker: string, note: string): Promise<void> {
  await pool.query(`
    ALTER TABLE ticker_notes
      ADD COLUMN IF NOT EXISTS calibration_note TEXT
  `);
  await pool.query(
    `INSERT INTO ticker_notes (ticker, memo, calibration_note, updated_at)
     VALUES ($1, '', $2, NOW())
     ON CONFLICT (ticker) DO UPDATE
       SET calibration_note = $2, updated_at = NOW()`,
    [ticker, note]
  );
}

/**
 * ticker_notes.calibration_note 조회 (없으면 null).
 */
export async function getCalibrationNote(ticker: string): Promise<string | null> {
  try {
    await pool.query(`
      ALTER TABLE ticker_notes
        ADD COLUMN IF NOT EXISTS calibration_note TEXT
    `);
    const r = await pool.query(
      `SELECT calibration_note FROM ticker_notes WHERE ticker = $1`,
      [ticker]
    );
    return r.rows[0]?.calibration_note ?? null;
  } catch {
    return null;
  }
}

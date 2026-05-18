/**
 * sector-learning.ts
 *
 * model_calibration 테이블의 섹터별 예측 정확도 데이터를 AI 가이던스 노트로 변환한다.
 * 생성된 노트는 sector_learning 테이블에 저장되고, KRW 종목 분석 시 enrichedContext에 주입된다.
 *
 * 실행 흐름:
 *   index.ts 스케줄러 (주 1회) → updateAllSectorLearning()
 *   executeStep() → getSectorLearningNote() → enrichedContext 주입
 */

import { GoogleGenAI } from "@google/genai";
import { pool } from "@workspace/db";
import { classifySector } from "../routes/performance.js";

const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? "" });

export const SECTOR_LABEL: Record<string, string> = {
  KR_SEMICONDUCTOR:    "한국 반도체·메모리",
  KR_SEMICONDUCTOR_EQ: "한국 반도체 장비·소재",
  KR_BIOTECH:          "한국 바이오·제약",
  KR_FINANCIAL:        "한국 금융·은행·보험",
  KR_CONSTRUCTION:     "한국 건설·건자재",
  KR_TELECOM:          "한국 통신",
  KR_AUTO:             "한국 자동차·부품",
  KR_IT:               "한국 IT·플랫폼·게임",
  KR_CONSUMER:         "한국 소비재·전자",
  KR_ENERGY:           "한국 에너지·화학",
  KR_DEFENSE:          "한국 방산·조선·기계",
  KR_REIT:             "한국 리츠·부동산",
  KR_OTHER:            "한국 기타",
};

async function ensureTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sector_learning (
      sector               VARCHAR(50) PRIMARY KEY,
      direction_accuracy   NUMERIC,
      avg_price_deviation  NUMERIC,
      sample_count         INT,
      guidance_note        TEXT,
      updated_at           TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

export async function updateSectorLearning(sector: string): Promise<void> {
  await ensureTable();

  const r = await pool.query(
    `SELECT direction_accuracy, avg_price_deviation, sample_count
     FROM model_calibration WHERE sector = $1`,
    [sector]
  );
  const row = r.rows[0];
  if (!row || (row.sample_count ?? 0) < 3) {
    console.log(`[sector-learning] ${sector}: 샘플 부족 (${row?.sample_count ?? 0}건), 스킵`);
    return;
  }

  const { direction_accuracy, avg_price_deviation, sample_count } = row;
  const label   = SECTOR_LABEL[sector] ?? sector;
  const dirPct  = direction_accuracy  != null ? (parseFloat(direction_accuracy)  * 100).toFixed(1) : "N/A";
  const devPct  = avg_price_deviation != null ? parseFloat(avg_price_deviation).toFixed(1)          : "N/A";

  const prompt = `당신은 AI 주식 분석 시스템의 자기보정 모듈입니다.
아래는 "${label}" 섹터에서 AI가 낸 과거 분석 결과의 예측 정확도 통계입니다.
이 데이터를 바탕으로 다음 분석 시 반드시 반영해야 할 보정 지침을 3~5줄로 작성하세요.

## 예측 정확도 통계 (샘플 ${sample_count}건)
- 투자 방향 예측 정확도: ${dirPct}%
  (기준: >60% 신뢰 가능 / 40~60% 주의 / <40% 신뢰도 매우 낮음)
- 목표주가 평균 편차: ${devPct}%
  (양수 = 실제보다 높게 설정하는 경향 / 음수 = 낮게 설정하는 경향)
  (기준: |편차| > 15%이면 유의미한 체계적 오류)

## 해석 기준 및 작성 규칙
- 방향 정확도 < 40%이면: "이 섹터 방향 판단 신뢰도 매우 낮음 — 컨센서스와 역방향 포지션 가능성도 검토하세요" 포함
- 방향 정확도 40~60%이면: "방향 판단에 추가 근거 필요" 포함
- 목표가 편차 > +15%이면: "목표주가를 과도하게 높게 설정하는 경향 → WACC 상향 또는 터미널 성장률 하향 조정 필요"
- 목표가 편차 < -15%이면: "목표주가를 과소평가하는 경향 → Bull 시나리오 상단 밴드 확대 검토"
- 각 항목은 구체적 수치 또는 행동 지시 포함
- 한국어, bullet(•)으로만 출력, 마크다운 없이`;

  try {
    const resp = await genai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { temperature: 0.3, maxOutputTokens: 400, thinkingConfig: { thinkingBudget: 0 } },
    });
    const note = resp.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
    if (!note || note.length < 20) return;

    await pool.query(`
      INSERT INTO sector_learning
        (sector, direction_accuracy, avg_price_deviation, sample_count, guidance_note, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (sector) DO UPDATE SET
        direction_accuracy  = $2,
        avg_price_deviation = $3,
        sample_count        = $4,
        guidance_note       = $5,
        updated_at          = NOW()
    `, [sector, direction_accuracy, avg_price_deviation, sample_count, note]);

    console.log(`[sector-learning] ${sector} (${label}) 업데이트 완료 — 방향 ${dirPct}%, 편차 ${devPct}%`);
  } catch (e: any) {
    console.error(`[sector-learning] ${sector} Gemini 오류:`, e?.message);
  }
}

export async function updateAllSectorLearning(): Promise<void> {
  await ensureTable();
  const r = await pool.query(
    `SELECT DISTINCT sector FROM model_calibration WHERE sample_count >= 3`
  );
  if (r.rows.length === 0) {
    console.log("[sector-learning] 학습 데이터 없음 (sample_count >= 3인 섹터 없음)");
    return;
  }
  for (const row of r.rows) {
    await updateSectorLearning(row.sector);
  }
  console.log(`[sector-learning] 전체 ${r.rows.length}개 섹터 업데이트 완료`);
}

export async function getSectorLearningNote(
  ticker: string,
  industry: string | null | undefined,
  _currency?: string
): Promise<string | null> {
  const isKrw = /^\d{6}$/.test(ticker);
  if (!isKrw || !industry) return null;

  try {
    await ensureTable();
    const sector = classifySector(industry, "KR");
    const r = await pool.query(
      `SELECT guidance_note, direction_accuracy, avg_price_deviation, sample_count
       FROM sector_learning WHERE sector = $1`,
      [sector]
    );
    const row = r.rows[0];
    if (!row?.guidance_note) return null;

    const label  = SECTOR_LABEL[sector] ?? sector;
    const dirAcc = row.direction_accuracy  != null
      ? (parseFloat(row.direction_accuracy) * 100).toFixed(1) + "%" : "N/A";
    const devPct = row.avg_price_deviation != null
      ? parseFloat(row.avg_price_deviation).toFixed(1) + "%" : "N/A";

    return (
      `[📊 AI 섹터 학습 보정 — ${label} (샘플 ${row.sample_count}건 | 방향 정확도 ${dirAcc} | 목표가 편차 ${devPct}) — 이번 분석에서 반드시 반영하세요]\n` +
      row.guidance_note
    );
  } catch {
    return null;
  }
}

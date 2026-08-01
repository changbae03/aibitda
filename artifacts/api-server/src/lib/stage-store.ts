/**
 * stage-store.ts — 사업 국면 판정을 남긴다.
 *
 * 두 가지 이유로 저장한다.
 *  1. UI가 국면 지도(궤적)를 그리려면 과거 판정이 필요하다.
 *  2. 턴어라운드는 "직전이 바닥이었는데 이번에 올라왔나"로만 감지된다 —
 *     다음 분석이 priorSubstanceScore로 되읽는다.
 *
 * jsonb 컬럼(reasons)은 readJsonb를 거친다(pg가 이미 객체로 돌려줌).
 */

import { pool, readJsonb } from "@workspace/db";
import type { StageVerdict } from "./stage-classifier.js";

export async function saveStageVerdict(
  ticker: string,
  verdict: StageVerdict,
  analysisId: number | null,
): Promise<void> {
  await pool.query(
    `INSERT INTO stock_stage_verdict
       (ticker, analysis_id, phase, stage_number, substance_score, substance_state,
        expectation, confidence, reasons)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      ticker, analysisId, verdict.phase, verdict.meta.stageNumber,
      verdict.substance.score, verdict.substance.state,
      verdict.expectation, verdict.confidence,
      JSON.stringify(verdict.substance.reasons),
    ],
  ).catch((e) => console.warn(`[stage-store] 저장 실패 ${ticker}:`, (e as Error)?.message?.slice(0, 80)));
}

/** 직전(가장 최근) 실체 점수 — 턴어라운드 감지용. 없으면 null. */
export async function getPriorStageScore(ticker: string): Promise<number | null> {
  try {
    const { rows } = await pool.query<{ substance_score: number }>(
      `SELECT substance_score FROM stock_stage_verdict
        WHERE ticker = $1 ORDER BY computed_at DESC LIMIT 1`,
      [ticker],
    );
    return rows[0] ? Number(rows[0].substance_score) : null;
  } catch {
    return null;
  }
}

export interface StageHistoryRow {
  phase: string;
  stageNumber: number | null;
  substanceScore: number;
  substanceState: string;
  expectation: string;
  confidence: string;
  reasons: string[];
  computedAt: string;
}

/** UI용 — 한 종목의 국면 판정 이력(오래된 순). */
export async function getStageHistory(ticker: string, limit = 12): Promise<StageHistoryRow[]> {
  const { rows } = await pool.query(
    `SELECT phase, stage_number, substance_score, substance_state,
            expectation, confidence, reasons, computed_at
       FROM stock_stage_verdict
      WHERE ticker = $1 ORDER BY computed_at DESC LIMIT $2`,
    [ticker, limit],
  );
  return rows
    .map((r: any) => ({
      phase: r.phase,
      stageNumber: r.stage_number == null ? null : Number(r.stage_number),
      substanceScore: Number(r.substance_score),
      substanceState: r.substance_state,
      expectation: r.expectation,
      confidence: r.confidence,
      reasons: readJsonb<string[]>(r.reasons) ?? [],
      computedAt: r.computed_at instanceof Date ? r.computed_at.toISOString() : String(r.computed_at),
    }))
    .reverse();
}

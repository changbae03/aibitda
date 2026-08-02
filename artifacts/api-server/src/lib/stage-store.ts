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
import { isKoreanTicker } from "@workspace/shared";
import type { StageVerdict } from "./stage-classifier.js";
import { buildTrajectory, type FinYear, type Trajectory } from "./stage-trajectory.js";

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

// ─── 국면 흐름(연도별 궤적) ───────────────────────────────────────────────────

const num = (v: any): number | null => (v == null ? null : Number(v));

/** us_financials 행에서 CCC(현금전환주기)를 파생 */
function usCcc(r: any): number | null {
  const days = (s: number | null, f: number | null) => (s != null && f != null && f > 0 ? s / (f / 365) : null);
  const dio = days(num(r.inventory), num(r.cogs));
  const dso = days(num(r.receivables), num(r.revenue));
  const dpo = days(num(r.payables), num(r.cogs));
  return dio != null && dso != null && dpo != null ? dio + dso - dpo : null;
}

/** 종목의 연도별 재무를 회계연도 오름차순으로 읽는다(시장별 출처). */
async function loadFinYears(ticker: string): Promise<FinYear[]> {
  if (isKoreanTicker(ticker)) {
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (bsns_year) bsns_year, revenue, operating_income
         FROM ticker_financials
        WHERE ticker = $1 AND reprt_code = '11011' AND revenue IS NOT NULL
        ORDER BY bsns_year DESC, revenue DESC`,
      [ticker],
    );
    return rows
      .map((r: any) => ({ fy: Number(r.bsns_year), revenue: num(r.revenue), operatingIncome: num(r.operating_income) }))
      .sort((a, b) => a.fy - b.fy);
  }
  const { rows } = await pool.query(
    `SELECT fy, revenue, operating_income, capex, inventory, receivables, payables, cogs
       FROM us_financials WHERE ticker = $1 ORDER BY fy ASC`,
    [ticker],
  );
  return rows.map((r: any) => ({
    fy: Number(r.fy), revenue: num(r.revenue), operatingIncome: num(r.operating_income),
    capex: num(r.capex), ccc: usCcc(r),
  }));
}

/** 저장된 다년치 재무로 국면 궤적 + 주요 전환점을 계산한다. */
export async function computeStageTrajectory(ticker: string): Promise<Trajectory> {
  const fin = await loadFinYears(ticker).catch(() => [] as FinYear[]);
  return buildTrajectory(fin);
}

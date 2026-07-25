/**
 * valuation-store.ts — 추출한 밸류에이션·실적전망을 DB에 남긴다.
 *
 * 분석 본문(텍스트)에만 있던 근거 수치를 표로 옮기는 역할.
 * 재분석 시 같은 analysis_id로 다시 들어올 수 있으므로 전부 덮어쓰기(upsert)한다.
 */

import { pool } from "@workspace/db";
import { normalizeTicker } from "@workspace/shared";
import { extractValuation, extractSegmentForecasts } from "./valuation-extract.js";

export async function storeValuationArtifacts(analysisId: number, content: string): Promise<void> {
  const tickerRow = await pool.query<{ ticker: string }>(
    `SELECT ticker FROM analyses WHERE id = $1`, [analysisId]
  );
  const ticker = normalizeTicker(tickerRow.rows[0]?.ticker);
  if (!ticker) return;

  const val = extractValuation(content);
  if (val) {
    await pool.query(
      `INSERT INTO analysis_valuations
         (analysis_id, ticker, current_price, bear, base, bull,
          abs_model, abs_bear, abs_base, abs_bull, rel_bear, rel_base, rel_bull)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (analysis_id) DO UPDATE SET
         ticker=EXCLUDED.ticker, current_price=EXCLUDED.current_price,
         bear=EXCLUDED.bear, base=EXCLUDED.base, bull=EXCLUDED.bull,
         abs_model=EXCLUDED.abs_model, abs_bear=EXCLUDED.abs_bear,
         abs_base=EXCLUDED.abs_base, abs_bull=EXCLUDED.abs_bull,
         rel_bear=EXCLUDED.rel_bear, rel_base=EXCLUDED.rel_base, rel_bull=EXCLUDED.rel_bull`,
      [analysisId, ticker, val.currentPrice, val.bear, val.base, val.bull,
       val.absModel, val.absBear, val.absBase, val.absBull,
       val.relBear, val.relBase, val.relBull]
    );
  }

  const rows = extractSegmentForecasts(content);
  for (const r of rows) {
    await pool.query(
      `INSERT INTO analysis_segment_forecasts
         (analysis_id, ticker, segment_name, currency, fiscal_year, revenue, operating_income)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (analysis_id, segment_name, fiscal_year) DO UPDATE SET
         revenue=EXCLUDED.revenue, operating_income=EXCLUDED.operating_income,
         currency=EXCLUDED.currency`,
      [analysisId, ticker, r.segmentName, r.currency, r.fiscalYear, r.revenue, r.operatingIncome]
    );
  }

  if (val || rows.length) {
    console.log(`[valuation-store] #${analysisId} ${ticker} — 밸류에이션 ${val ? "저장" : "없음"}, 전망 ${rows.length}행`);
  }
}

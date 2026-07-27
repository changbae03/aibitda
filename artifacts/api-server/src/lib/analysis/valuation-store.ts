/**
 * valuation-store.ts — 추출한 밸류에이션·실적전망을 DB에 남긴다.
 *
 * 분석 본문(텍스트)에만 있던 근거 수치를 표로 옮기는 역할.
 * 재분석 시 같은 analysis_id로 다시 들어올 수 있으므로 전부 덮어쓰기(upsert)한다.
 */

import { pool } from "@workspace/db";
import { normalizeTicker } from "@workspace/shared";
import { extractValuation, extractSegmentForecasts } from "./valuation-extract.js";
import { auditRnpv } from "../valuation/rnpv-audit.js";
import { auditReconciliation } from "../valuation/reconcile-audit.js";
import { pickModel } from "../valuation/pick-model.js";

export async function storeValuationArtifacts(analysisId: number, content: string): Promise<void> {
  const tickerRow = await pool.query<{ ticker: string; company_name: string; industry: string | null }>(
    `SELECT ticker, company_name, industry FROM analyses WHERE id = $1`, [analysisId]
  );
  const row = tickerRow.rows[0];
  const ticker = normalizeTicker(row?.ticker);
  if (!ticker) return;

  const val = extractValuation(content);
  if (val) {
    // 저장 시점에 검산해 함께 남긴다.
    //
    // QC가 앞단에서 막아주지만 재시도 상한에 걸리면 통과하기도 하고, 검산 도입 전
    // 행도 섞여 있다. 이 값을 나중에 **다른 분석이 갖다 쓰려면** 믿어도 되는지가
    // 표에 적혀 있어야 한다. 한화시스템은 같은 날 저장된 5건의 목표가가
    // 1,590원 ~ 57,900원으로 36배 벌어져 있었다(현재가 68,200원).
    const model = pickModel(row.industry ?? "", row.company_name ?? "", ticker);
    const issues = [
      ...auditRnpv(content).map(i => i.message),
      ...auditReconciliation({
        base: val.base, absBase: val.absBase, absBear: val.absBear, absBull: val.absBull,
        relBase: val.relBase, relBear: val.relBear, relBull: val.relBull,
        absWeight: model.absWeight,
      }).map(i => i.message),
    ];
    const auditOk = issues.length === 0;

    await pool.query(
      `INSERT INTO analysis_valuations
         (analysis_id, ticker, current_price, bear, base, bull,
          abs_model, abs_bear, abs_base, abs_bull, rel_bear, rel_base, rel_bull,
          audit_ok, audit_issues)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (analysis_id) DO UPDATE SET
         ticker=EXCLUDED.ticker, current_price=EXCLUDED.current_price,
         bear=EXCLUDED.bear, base=EXCLUDED.base, bull=EXCLUDED.bull,
         abs_model=EXCLUDED.abs_model, abs_bear=EXCLUDED.abs_bear,
         abs_base=EXCLUDED.abs_base, abs_bull=EXCLUDED.abs_bull,
         rel_bear=EXCLUDED.rel_bear, rel_base=EXCLUDED.rel_base, rel_bull=EXCLUDED.rel_bull,
         audit_ok=EXCLUDED.audit_ok, audit_issues=EXCLUDED.audit_issues`,
      [analysisId, ticker, val.currentPrice, val.bear, val.base, val.bull,
       val.absModel, val.absBear, val.absBase, val.absBull,
       val.relBear, val.relBase, val.relBull,
       auditOk, issues.length ? issues.join("\n---\n") : null]
    );

    if (!auditOk) {
      console.warn(`[valuation-store] #${analysisId} ${ticker} 검산 실패 ${issues.length}건 — 정본에서 제외됨`);
    }
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

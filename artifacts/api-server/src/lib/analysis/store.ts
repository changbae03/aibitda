// 분석 도메인의 DB 접근 헬퍼 — raw SQL 실행, DB 영속 캐시, row 매핑
import { pool } from "@workspace/db";
import { analysesTable, analysisStepsTable } from "@workspace/db";

// ─── Raw SQL helpers (production-safe: bypasses drizzle CJS bundle issues) ───
async function rawQuery<T = any>(sqlText: string, params: any[] = []): Promise<T[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(sqlText, params);
    return result.rows as T[];
  } finally {
    client.release();
  }
}

// ── DB 영속 캐시 헬퍼 (system_cache 테이블, 서버 재시작 후에도 유지) ─────────────
async function dbCacheGet<T>(key: string): Promise<T | null> {
  try {
    const rows = await rawQuery<{ data: T }>(
      `SELECT data FROM system_cache WHERE key = $1 AND expires_at > NOW() LIMIT 1`,
      [key]
    );
    if (rows[0]?.data != null) return rows[0].data as T;
  } catch { /* ignore */ }
  return null;
}

async function dbCacheSet(key: string, data: any, ttlSec: number): Promise<void> {
  try {
    await rawQuery(
      `INSERT INTO system_cache (key, data, expires_at)
       VALUES ($1, $2::jsonb, NOW() + ($3 || ' seconds')::interval)
       ON CONFLICT (key) DO UPDATE
         SET data = EXCLUDED.data, expires_at = EXCLUDED.expires_at`,
      [key, JSON.stringify(data), String(ttlSec)]
    );
  } catch { /* ignore */ }
}

function mapAnalysisRow(row: any): typeof analysesTable.$inferSelect {
  return {
    id: row.id,
    userId: row.user_id ?? null,
    ticker: row.ticker,
    companyName: row.company_name,
    englishName: row.english_name ?? null,
    industry: row.industry,
    additionalContext: row.additional_context ?? null,
    status: row.status,
    currentStep: row.current_step ?? null,
    investmentVerdict: row.investment_verdict ?? null,
    targetPrice: row.target_price ?? null,
    startPrice: row.start_price ?? null,
    entryPrice: row.entry_price ?? null,
    stopLoss: row.stop_loss ?? null,
    riskRewardRatio: row.risk_reward_ratio ?? null,
    memo: row.memo ?? null,
    isPublic: row.is_public ?? "true",
    userRating: row.user_rating ?? null,
    userFeedback: row.user_feedback ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    language: row.language ?? "ko",
  } as any;
}

function mapStepRow(row: any): typeof analysisStepsTable.$inferSelect {
  return {
    id: row.id,
    analysisId: row.analysis_id,
    stepKey: row.step_key,
    agentName: row.agent_name,
    agentRole: row.agent_role,
    content: row.content,
    validationNotes: row.validation_notes ?? null,
    informationType: row.information_type ?? "data_based_estimate",
    createdAt: row.created_at,
  } as typeof analysisStepsTable.$inferSelect;
}

// QA/피어 컬럼 초기화 — 서버 기동 후 최초 1회만 실행 (pool 낭비 방지)
let _qaPeerColumnsReady = false;
async function ensureQaPeerColumns(): Promise<void> {
  if (_qaPeerColumnsReady) return;
  await Promise.all([
    pool.query(`ALTER TABLE analyses ADD COLUMN IF NOT EXISTS qa_score INTEGER, ADD COLUMN IF NOT EXISTS qa_flags TEXT`),
    pool.query(`ALTER TABLE analyses ADD COLUMN IF NOT EXISTS peer_flags TEXT`),
  ]);
  _qaPeerColumnsReady = true;
}

export { rawQuery, dbCacheGet, dbCacheSet, mapAnalysisRow, mapStepRow, ensureQaPeerColumns };

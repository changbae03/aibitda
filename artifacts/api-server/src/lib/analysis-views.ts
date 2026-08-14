/**
 * analysis-views.ts — 누가 어떤 보고서를 읽었는지 남긴다.
 *
 * 운영 화면에는 "총 분석 수"만 있었다. 그건 **만든 횟수**지 읽은 횟수가 아니다.
 * 한 번 만든 보고서를 열 번 다시 읽어도 숫자는 그대로였고, 남의 공개 보고서를
 * 읽은 것은 어디에도 남지 않았다. 그래서 "누가 무엇을 보는가"를 알 수 없었다.
 *
 * 같은 사람이 같은 보고서를 이어서 새로고침하는 것까지 다 세면 숫자가 부푼다 —
 * 30분 안의 재열람은 한 번으로 본다.
 */

import { pool } from "@workspace/db";

const DEDUPE_MINUTES = 30;

/** 열람 1건 기록. 실패는 열람을 막지 않는다(호출부에서 catch). */
export async function recordAnalysisView(
  analysisId: number, userId: string, ticker: string | null,
): Promise<void> {
  await pool.query(
    `INSERT INTO analysis_views (analysis_id, user_id, ticker, viewed_at)
     SELECT $1, $2, $3, NOW()
      WHERE NOT EXISTS (
        SELECT 1 FROM analysis_views
         WHERE analysis_id = $1 AND user_id = $2
           AND viewed_at > NOW() - INTERVAL '${DEDUPE_MINUTES} minutes')`,
    [analysisId, userId, ticker],
  );
}

export interface UserActivityRow {
  ticker: string;
  companyName: string | null;
  analysisId: number | null;
  createdAt: Date | null;
  lastViewedAt: Date | null;
  viewCount: number;
  /** 본인이 돌린 분석인가(아니면 남의 보고서를 읽은 것) */
  isOwn: boolean;
}

/**
 * 한 사람이 **어떤 종목을 다뤘는지** — 직접 돌린 분석과 읽기만 한 보고서를 함께.
 * 운영자가 보고 싶은 건 "이 사람이 무엇에 관심 있나"이지 둘 중 하나가 아니다.
 */
export async function getUserActivity(userId: string, limit = 100): Promise<UserActivityRow[]> {
  const { rows } = await pool.query(
    `WITH mine AS (
       SELECT a.id, a.ticker, a.company_name, a.created_at
         FROM analyses a WHERE a.user_id = $1
     ), seen AS (
       SELECT v.analysis_id, v.ticker, max(v.viewed_at) AS last_viewed, count(*)::int AS views
         FROM analysis_views v WHERE v.user_id = $1
        GROUP BY 1, 2
     )
     SELECT COALESCE(m.ticker, s.ticker)              AS ticker,
            m.company_name                            AS company_name,
            COALESCE(m.id, s.analysis_id)             AS analysis_id,
            m.created_at                              AS created_at,
            s.last_viewed                             AS last_viewed_at,
            COALESCE(s.views, 0)                      AS view_count,
            (m.id IS NOT NULL)                        AS is_own
       FROM mine m FULL OUTER JOIN seen s ON s.analysis_id = m.id
      ORDER BY GREATEST(COALESCE(s.last_viewed, m.created_at),
                        COALESCE(m.created_at, s.last_viewed)) DESC NULLS LAST
      LIMIT $2`,
    [userId, limit],
  );
  return rows.map(r => ({
    ticker: r.ticker,
    companyName: r.company_name ?? null,
    analysisId: r.analysis_id == null ? null : Number(r.analysis_id),
    createdAt: r.created_at ?? null,
    lastViewedAt: r.last_viewed_at ?? null,
    viewCount: Number(r.view_count ?? 0),
    isOwn: r.is_own === true,
  }));
}

/** 운영 화면 요약 — 어떤 종목이 실제로 많이 읽혔나 */
export async function getTopViewedTickers(days = 7, limit = 20) {
  const { rows } = await pool.query(
    `SELECT ticker, count(*)::int AS views, count(DISTINCT user_id)::int AS users
       FROM analysis_views
      WHERE ticker IS NOT NULL AND viewed_at > NOW() - ($1 || ' days')::interval
      GROUP BY ticker ORDER BY views DESC LIMIT $2`,
    [String(days), limit],
  );
  return rows.map(r => ({ ticker: r.ticker, views: Number(r.views), users: Number(r.users) }));
}

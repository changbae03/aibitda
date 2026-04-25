import { Router } from "express";
import { pool } from "@workspace/db";
import { getUserId } from "../lib/credits.js";

const router = Router();

async function isAdmin(userId: string | null): Promise<boolean> {
  if (!userId) return false;
  const r = await pool.query(`SELECT 1 FROM admins WHERE user_id = $1`, [userId]);
  return r.rowCount !== null && r.rowCount > 0;
}

async function adminCount(): Promise<number> {
  const r = await pool.query(`SELECT COUNT(*) FROM admins`);
  return parseInt(r.rows[0].count, 10);
}

// GET /api/admin/me — 현재 사용자 관리자 여부 + userId 반환
router.get("/me", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.json({ isAdmin: false, userId: null });
    return;
  }
  const admin = await isAdmin(userId);
  res.json({ isAdmin: admin, userId });
});

// GET /api/admin/users — 관리자 목록 (관리자 전용)
router.get("/users", async (req, res) => {
  const userId = getUserId(req);
  if (!(await isAdmin(userId))) {
    res.status(403).json({ error: "관리자만 접근 가능합니다" });
    return;
  }
  const r = await pool.query(
    `SELECT user_id, display_name, added_by, added_at FROM admins ORDER BY added_at ASC`
  );
  res.json(r.rows.map(row => ({
    userId: row.user_id,
    displayName: row.display_name ?? row.user_id,
    addedBy: row.added_by,
    addedAt: row.added_at,
  })));
});

// POST /api/admin/users — 관리자 추가
// 관리자가 0명이면 누구든 첫 관리자 등록 가능 (부트스트랩)
router.post("/users", async (req, res) => {
  const requesterId = getUserId(req);
  if (!requesterId) {
    res.status(401).json({ error: "로그인이 필요합니다" });
    return;
  }

  const { userId: targetId, displayName } = req.body as { userId?: string; displayName?: string };

  const count = await adminCount();

  if (count > 0 && !(await isAdmin(requesterId))) {
    res.status(403).json({ error: "관리자만 다른 관리자를 추가할 수 있습니다" });
    return;
  }

  const target = targetId ?? requesterId;

  await pool.query(
    `INSERT INTO admins (user_id, display_name, added_by, added_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name`,
    [target, displayName?.trim() || null, requesterId]
  );

  res.json({ ok: true, userId: target });
});

// DELETE /api/admin/users/:userId — 관리자 제거 (관리자 전용)
router.delete("/users/:userId", async (req, res) => {
  const requesterId = getUserId(req);
  if (!(await isAdmin(requesterId))) {
    res.status(403).json({ error: "관리자만 접근 가능합니다" });
    return;
  }

  const target = req.params.userId;

  if (target === requesterId) {
    const count = await adminCount();
    if (count <= 1) {
      res.status(400).json({ error: "마지막 관리자는 삭제할 수 없습니다" });
      return;
    }
  }

  await pool.query(`DELETE FROM admins WHERE user_id = $1`, [target]);
  res.json({ ok: true });
});

// ─── 사용량 통계 ────────────────────────────────────────────────────────────────

// GET /api/admin/stats — 일별/주별 분석 수 + 신규 가입자
router.get("/stats", async (req, res) => {
  const userId = getUserId(req);
  if (!(await isAdmin(userId))) {
    res.status(403).json({ error: "관리자만 접근 가능합니다" });
    return;
  }

  const days = parseInt((req.query.days as string) ?? "30", 10);

  const analysisRows = await pool.query(
    `SELECT DATE(created_at AT TIME ZONE 'Asia/Seoul') AS day, COUNT(*) AS cnt
     FROM analyses
     WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL
     GROUP BY day
     ORDER BY day ASC`,
    [days]
  );

  const userRows = await pool.query(
    `SELECT DATE(created_at AT TIME ZONE 'Asia/Seoul') AS day, COUNT(*) AS cnt
     FROM user_credits
     WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL
     GROUP BY day
     ORDER BY day ASC`,
    [days]
  );

  const totalUsers = await pool.query(`SELECT COUNT(*) FROM user_credits`);
  const totalAnalyses = await pool.query(`SELECT COUNT(*) FROM analyses`);
  const todayAnalyses = await pool.query(
    `SELECT COUNT(*) FROM analyses WHERE created_at >= CURRENT_DATE`
  );

  const tierCounts = await pool.query(
    `SELECT tier, COUNT(*) AS cnt FROM user_credits GROUP BY tier`
  );

  res.json({
    analysisByDay: analysisRows.rows.map(r => ({ day: r.day, count: parseInt(r.cnt, 10) })),
    usersByDay: userRows.rows.map(r => ({ day: r.day, count: parseInt(r.cnt, 10) })),
    totals: {
      users: parseInt(totalUsers.rows[0].count, 10),
      analyses: parseInt(totalAnalyses.rows[0].count, 10),
      todayAnalyses: parseInt(todayAnalyses.rows[0].count, 10),
    },
    tierCounts: Object.fromEntries(tierCounts.rows.map(r => [r.tier, parseInt(r.cnt, 10)])),
  });
});

// ─── 시스템 설정 ────────────────────────────────────────────────────────────────

// GET /api/admin/settings — 시스템 설정 조회
router.get("/settings", async (req, res) => {
  const userId = getUserId(req);
  if (!(await isAdmin(userId))) {
    res.status(403).json({ error: "관리자만 접근 가능합니다" });
    return;
  }
  const { rows } = await pool.query(`SELECT key, value FROM system_settings`);
  const settings: Record<string, string> = {};
  for (const r of rows) settings[r.key] = r.value;
  res.json(settings);
});

// POST /api/admin/settings — 시스템 설정 저장
router.post("/settings", async (req, res) => {
  const userId = getUserId(req);
  if (!(await isAdmin(userId))) {
    res.status(403).json({ error: "관리자만 접근 가능합니다" });
    return;
  }
  const updates = req.body as Record<string, string>;
  for (const [key, value] of Object.entries(updates)) {
    await pool.query(
      `INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, String(value)]
    );
  }
  res.json({ ok: true });
});

// GET /api/admin/settings/public — 공개 설정 (로그인 불필요)
router.get("/settings/public", async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT key, value FROM system_settings WHERE key IN ('notice_enabled', 'notice_text', 'notice_type')`
  );
  const settings: Record<string, string> = {};
  for (const r of rows) settings[r.key] = r.value;
  res.json(settings);
});

// POST /api/admin/global-limit — 전체 유저 일일 한도 변경
router.post("/global-limit", async (req, res) => {
  const userId = getUserId(req);
  if (!(await isAdmin(userId))) {
    res.status(403).json({ error: "관리자만 접근 가능합니다" });
    return;
  }
  const { limit, tier } = req.body as { limit?: number; tier?: string };
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 0) {
    res.status(400).json({ error: "limit는 0 이상 정수여야 합니다" });
    return;
  }
  if (tier) {
    await pool.query(`UPDATE user_credits SET daily_limit = $1 WHERE tier = $2`, [limit, tier]);
  } else {
    await pool.query(`UPDATE user_credits SET daily_limit = $1`, [limit]);
  }
  console.log(`[ADMIN] ${userId} → global-limit ${limit} (tier=${tier ?? "all"})`);
  res.json({ ok: true });
});

// ─── 유저 관리 ────────────────────────────────────────────────────────────────

// GET /api/admin/user-list — 유저 목록 (크레딧 + 분석 통계)
router.get("/user-list", async (req, res) => {
  const userId = getUserId(req);
  if (!(await isAdmin(userId))) {
    res.status(403).json({ error: "관리자만 접근 가능합니다" });
    return;
  }

  const search = (req.query.search as string | undefined)?.trim() ?? "";
  const page = Math.max(1, parseInt((req.query.page as string) ?? "1", 10));
  const limit = 50;
  const offset = (page - 1) * limit;

  const whereClause = search
    ? `WHERE uc.user_id ILIKE $3`
    : "";

  const params: any[] = search
    ? [limit, offset, `%${search}%`]
    : [limit, offset];

  const { rows } = await pool.query(
    `SELECT
       uc.user_id,
       uc.daily_used,
       uc.daily_limit,
       uc.bonus_credits,
       uc.total_analyses,
       uc.tier,
       uc.admin_memo,
       uc.display_name,
       uc.created_at,
       COUNT(a.id) FILTER (WHERE a.created_at >= NOW() - INTERVAL '7 days') AS recent_analyses
     FROM user_credits uc
     LEFT JOIN analyses a ON a.user_id = uc.user_id
     ${whereClause}
     GROUP BY uc.user_id, uc.daily_used, uc.daily_limit, uc.bonus_credits, uc.total_analyses, uc.tier, uc.admin_memo, uc.display_name, uc.created_at
     ORDER BY uc.created_at DESC
     LIMIT $1 OFFSET $2`,
    params
  );

  const countResult = await pool.query(
    `SELECT COUNT(*) FROM user_credits uc ${search ? `WHERE uc.user_id ILIKE $1` : ""}`,
    search ? [`%${search}%`] : []
  );

  res.json({
    users: rows.map(r => ({
      userId: r.user_id,
      dailyUsed: r.daily_used,
      dailyLimit: r.daily_limit,
      bonusCredits: r.bonus_credits,
      totalAnalyses: r.total_analyses,
      recentAnalyses: parseInt(r.recent_analyses, 10),
      tier: r.tier ?? "free",
      adminMemo: r.admin_memo ?? "",
      displayName: r.display_name ?? null,
      createdAt: r.created_at,
    })),
    total: parseInt(countResult.rows[0].count, 10),
    page,
    limit,
  });
});

// GET /api/admin/user-list/:userId/analyses — 특정 유저의 분석 이력
router.get("/user-list/:userId/analyses", async (req, res) => {
  const requesterId = getUserId(req);
  if (!(await isAdmin(requesterId))) {
    res.status(403).json({ error: "관리자만 접근 가능합니다" });
    return;
  }

  const { userId } = req.params;
  const page = Math.max(1, parseInt((req.query.page as string) ?? "1", 10));
  const limit = 20;
  const offset = (page - 1) * limit;

  const { rows } = await pool.query(
    `SELECT id, ticker, company_name, status, investment_verdict, target_price, start_price, created_at
     FROM analyses
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );

  const countResult = await pool.query(
    `SELECT COUNT(*) FROM analyses WHERE user_id = $1`,
    [userId]
  );

  res.json({
    analyses: rows.map(r => ({
      id: r.id,
      ticker: r.ticker,
      companyName: r.company_name,
      status: r.status,
      verdict: r.investment_verdict,
      targetPrice: r.target_price,
      startPrice: r.start_price,
      createdAt: r.created_at,
    })),
    total: parseInt(countResult.rows[0].count, 10),
  });
});

// POST /api/admin/user-list/:userId/credits — 보너스 크레딧 조정
router.post("/user-list/:userId/credits", async (req, res) => {
  const requesterId = getUserId(req);
  if (!(await isAdmin(requesterId))) {
    res.status(403).json({ error: "관리자만 접근 가능합니다" });
    return;
  }

  const { userId } = req.params;
  const { delta, reason } = req.body as { delta: number; reason?: string };

  if (typeof delta !== "number" || !Number.isInteger(delta) || delta === 0) {
    res.status(400).json({ error: "delta는 0이 아닌 정수여야 합니다" });
    return;
  }

  const { rows } = await pool.query(
    `UPDATE user_credits
     SET bonus_credits = GREATEST(0, bonus_credits + $1)
     WHERE user_id = $2
     RETURNING bonus_credits`,
    [delta, userId]
  );

  if (rows.length === 0) {
    res.status(404).json({ error: "유저를 찾을 수 없습니다" });
    return;
  }

  console.log(`[ADMIN] ${requesterId} → ${userId} bonus_credits ${delta > 0 ? "+" : ""}${delta} (${reason ?? "사유 없음"})`);
  res.json({ ok: true, newBonusCredits: rows[0].bonus_credits });
});

// POST /api/admin/user-list/:userId/daily-reset — 일일 크레딧 초기화
router.post("/user-list/:userId/daily-reset", async (req, res) => {
  const requesterId = getUserId(req);
  if (!(await isAdmin(requesterId))) {
    res.status(403).json({ error: "관리자만 접근 가능합니다" });
    return;
  }

  const { userId } = req.params;

  await pool.query(
    `UPDATE user_credits SET daily_used = 0 WHERE user_id = $1`,
    [userId]
  );

  res.json({ ok: true });
});

// PATCH /api/admin/user-list/:userId/tier — 유저 등급 변경 + 크레딧 자동 적용
const TIER_LIMITS: Record<string, number> = { free: 3, beta: 10, premium: 50 };

router.patch("/user-list/:userId/tier", async (req, res) => {
  const requesterId = getUserId(req);
  if (!(await isAdmin(requesterId))) {
    res.status(403).json({ error: "관리자만 접근 가능합니다" });
    return;
  }
  const { userId } = req.params;
  const { tier } = req.body as { tier: string };
  if (!["free", "beta", "premium"].includes(tier)) {
    res.status(400).json({ error: "유효하지 않은 등급입니다" });
    return;
  }
  const newLimit = TIER_LIMITS[tier];
  const { rows } = await pool.query(
    `UPDATE user_credits SET tier = $1, daily_limit = $2 WHERE user_id = $3
     RETURNING tier, daily_limit`,
    [tier, newLimit, userId]
  );
  if (rows.length === 0) {
    res.status(404).json({ error: "유저를 찾을 수 없습니다" });
    return;
  }
  console.log(`[ADMIN] ${requesterId} → ${userId} tier=${tier} limit=${newLimit}`);
  res.json({ ok: true, tier: rows[0].tier, dailyLimit: rows[0].daily_limit });
});

// PATCH /api/admin/user-list/:userId/memo — 관리자 메모 저장
router.patch("/user-list/:userId/memo", async (req, res) => {
  const requesterId = getUserId(req);
  if (!(await isAdmin(requesterId))) {
    res.status(403).json({ error: "관리자만 접근 가능합니다" });
    return;
  }
  const { userId } = req.params;
  const { memo } = req.body as { memo: string };
  await pool.query(
    `UPDATE user_credits SET admin_memo = $1 WHERE user_id = $2`,
    [String(memo ?? ""), userId]
  );
  res.json({ ok: true });
});

// POST /api/admin/reset-analysis-data — 분석 데이터 초기화 (관리자 전용)
router.post("/reset-analysis-data", async (req, res) => {
  const requesterId = getUserId(req);
  if (!(await isAdmin(requesterId))) {
    res.status(403).json({ error: "관리자만 접근 가능합니다" });
    return;
  }

  await pool.query(`DELETE FROM model_insights`);
  await pool.query(`DELETE FROM analysis_steps`);
  await pool.query(`DELETE FROM analyses`);

  console.log(`[ADMIN] ${requesterId} — reset-analysis-data 실행`);
  res.json({ ok: true, message: "분석 데이터가 초기화됐습니다" });
});

// ─── GET /api/admin/user-detail/:userId ──────────────────────────────────────
router.get("/user-detail/:userId", async (req, res) => {
  const userId = getUserId(req);
  if (!(await isAdmin(userId))) return res.status(403).json({ error: "관리자만 접근 가능합니다" });
  const targetId = req.params.userId;
  try {
    const [creditRow, topTickers, recentAnalyses, activityByDay] = await Promise.all([
      pool.query(
        `SELECT user_id, daily_limit, daily_used, bonus_credits, total_analyses, tier, admin_memo, display_name, created_at
         FROM user_credits WHERE user_id = $1`, [targetId]
      ),
      pool.query(
        `SELECT ticker, company_name, COUNT(*) AS cnt,
                MAX(investment_verdict) AS last_verdict,
                MAX(created_at) AS last_at
         FROM analyses WHERE user_id = $1 AND status = 'done'
         GROUP BY ticker, company_name ORDER BY cnt DESC LIMIT 5`, [targetId]
      ),
      pool.query(
        `SELECT id, ticker, company_name, investment_verdict, target_price, created_at
         FROM analyses WHERE user_id = $1
         ORDER BY created_at DESC LIMIT 8`, [targetId]
      ),
      pool.query(
        `SELECT DATE(created_at AT TIME ZONE 'Asia/Seoul') AS day, COUNT(*) AS cnt
         FROM analyses WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '30 days'
         GROUP BY day ORDER BY day ASC`, [targetId]
      ),
    ]);
    if (!creditRow.rows[0]) return res.status(404).json({ error: "유저를 찾을 수 없습니다" });
    res.json({
      user: creditRow.rows[0],
      topTickers: topTickers.rows,
      recentAnalyses: recentAnalyses.rows,
      activityByDay: activityByDay.rows,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "DB error" });
  }
});

// ─── GET /api/admin/cohort ─────────────────────────────────────────────────
router.get("/cohort", async (req, res) => {
  const userId = getUserId(req);
  if (!(await isAdmin(userId))) return res.status(403).json({ error: "관리자만 접근 가능합니다" });
  try {
    const { rows } = await pool.query(`
      WITH cohorts AS (
        SELECT user_id,
               DATE_TRUNC('week', created_at AT TIME ZONE 'Asia/Seoul')::DATE AS cohort_week
        FROM user_credits
        WHERE created_at >= NOW() - INTERVAL '12 weeks'
      ),
      activities AS (
        SELECT DISTINCT user_id,
               DATE_TRUNC('week', created_at AT TIME ZONE 'Asia/Seoul')::DATE AS activity_week
        FROM analyses
      ),
      cohort_activity AS (
        SELECT c.cohort_week,
               c.user_id,
               (a.activity_week - c.cohort_week) / 7 AS week_offset
        FROM cohorts c
        JOIN activities a ON c.user_id = a.user_id
      )
      SELECT
        cohort_week::TEXT,
        COUNT(DISTINCT c2.user_id) AS cohort_size,
        COALESCE(
          JSON_AGG(
            JSON_BUILD_OBJECT('week', ca.week_offset, 'users', ca.retained)
            ORDER BY ca.week_offset
          ) FILTER (WHERE ca.week_offset IS NOT NULL),
          '[]'
        ) AS retention
      FROM cohorts c2
      LEFT JOIN (
        SELECT cohort_week, week_offset, COUNT(DISTINCT user_id) AS retained
        FROM cohort_activity
        WHERE week_offset >= 0 AND week_offset <= 8
        GROUP BY cohort_week, week_offset
      ) ca ON c2.cohort_week = ca.cohort_week
      GROUP BY c2.cohort_week
      ORDER BY c2.cohort_week DESC
      LIMIT 8
    `);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "DB error" });
  }
});

// ─── 수익 지표 ─────────────────────────────────────────────────────────────
router.get("/revenue-stats", async (req, res) => {
  const userId = getUserId(req);
  if (!(await isAdmin(userId))) return res.status(403).json({ error: "관리자만 접근 가능합니다" });
  try {
    const [tierCounts, weeklySignups, tokenCosts, repeatUsers] = await Promise.all([
      pool.query(`SELECT tier, COUNT(*) AS cnt FROM user_credits GROUP BY tier`),
      pool.query(`
        SELECT DATE_TRUNC('week', created_at AT TIME ZONE 'Asia/Seoul')::DATE AS week,
               COUNT(*) AS signups
        FROM user_credits WHERE created_at >= NOW() - INTERVAL '8 weeks'
        GROUP BY week ORDER BY week ASC`),
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE token_count > 0) AS tracked_analyses,
          SUM(token_count) AS total_tokens,
          SUM(estimated_cost_usd) AS total_cost_usd,
          AVG(estimated_cost_usd) FILTER (WHERE estimated_cost_usd > 0) AS avg_cost_usd
        FROM analyses WHERE status = 'completed'`),
      pool.query(`
        SELECT COUNT(DISTINCT user_id) AS repeat_users
        FROM analyses WHERE user_id IS NOT NULL
        GROUP BY user_id HAVING COUNT(*) > 1`),
    ]);
    const tiers: Record<string, number> = {};
    for (const r of tierCounts.rows) tiers[r.tier] = parseInt(r.cnt, 10);
    const PRICING: Record<string, number> = { free: 0, beta: 9900, premium: 29900 };
    const mrrKrw = Object.entries(tiers)
      .reduce((sum, [t, n]) => sum + (PRICING[t] ?? 0) * n, 0);
    res.json({
      tierCounts: tiers,
      mrrKrw,
      weeklySignups: weeklySignups.rows,
      tokenCosts: tokenCosts.rows[0],
      repeatUserCount: repeatUsers.rowCount ?? 0,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "DB error" });
  }
});

// ─── 프로모 코드 CRUD ──────────────────────────────────────────────────────
router.get("/promo-codes", async (req, res) => {
  const userId = getUserId(req);
  if (!(await isAdmin(userId))) return res.status(403).json({ error: "관리자만 접근 가능합니다" });
  const { rows } = await pool.query(
    `SELECT * FROM promo_codes ORDER BY created_at DESC`
  );
  res.json(rows);
});

router.post("/promo-codes", async (req, res) => {
  const userId = getUserId(req);
  if (!(await isAdmin(userId))) return res.status(403).json({ error: "관리자만 접근 가능합니다" });
  const { code, description, credit_amount, tier_upgrade, max_uses, expires_at } = req.body;
  if (!code || typeof code !== "string") return res.status(400).json({ error: "code 필수" });
  try {
    const { rows } = await pool.query(
      `INSERT INTO promo_codes (code, description, credit_amount, tier_upgrade, max_uses, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [code.toUpperCase().trim(), description ?? null, credit_amount ?? 0, tier_upgrade ?? null, max_uses ?? null, expires_at ?? null]
    );
    res.json(rows[0]);
  } catch (err: any) {
    if (err.code === "23505") return res.status(409).json({ error: "이미 존재하는 코드입니다" });
    res.status(500).json({ error: err?.message });
  }
});

router.patch("/promo-codes/:id/toggle", async (req, res) => {
  const userId = getUserId(req);
  if (!(await isAdmin(userId))) return res.status(403).json({ error: "관리자만 접근 가능합니다" });
  const { rows } = await pool.query(
    `UPDATE promo_codes SET enabled = NOT enabled WHERE id = $1 RETURNING *`,
    [req.params.id]
  );
  res.json(rows[0] ?? { error: "not found" });
});

router.delete("/promo-codes/:id", async (req, res) => {
  const userId = getUserId(req);
  if (!(await isAdmin(userId))) return res.status(403).json({ error: "관리자만 접근 가능합니다" });
  await pool.query(`DELETE FROM promo_codes WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
});

export default router;

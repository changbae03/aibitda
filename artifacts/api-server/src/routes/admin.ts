import { Router } from "express";
import { pool } from "@workspace/db";
import { getUserId } from "../lib/credits.js";
import { clearBatchDateForToday, runDailyAutoBatch } from "../lib/auto-batch-runner.js";
import { loadKRXList } from "../lib/krx-cache.js";
import { US_MASTER_LIST } from "../lib/us-full-harvester.js";
import { SECTOR_PRIORS } from "./performance.js";

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

  const [analysisRows, userRows, activeUserRows, totalUsers, totalAnalyses, todayAnalyses, tierCounts] = await Promise.all([
    pool.query(
      `SELECT DATE(created_at AT TIME ZONE 'Asia/Seoul') AS day, COUNT(*) AS cnt
       FROM analyses
       WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL
       GROUP BY day ORDER BY day ASC`,
      [days]
    ),
    pool.query(
      `SELECT DATE(created_at AT TIME ZONE 'Asia/Seoul') AS day, COUNT(*) AS cnt
       FROM user_credits
       WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL
       GROUP BY day ORDER BY day ASC`,
      [days]
    ),
    pool.query(
      `SELECT DATE(created_at AT TIME ZONE 'Asia/Seoul') AS day, COUNT(DISTINCT user_id) AS cnt
       FROM analyses
       WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL AND user_id IS NOT NULL
       GROUP BY day ORDER BY day ASC`,
      [days]
    ),
    pool.query(`SELECT COUNT(*) FROM user_credits`),
    pool.query(`SELECT COUNT(*) FROM analyses`),
    pool.query(`SELECT COUNT(*) FROM analyses WHERE created_at >= CURRENT_DATE`),
    pool.query(`SELECT tier, COUNT(*) AS cnt FROM user_credits GROUP BY tier`),
  ]);

  res.json({
    analysisByDay: analysisRows.rows.map(r => ({ day: r.day, count: parseInt(r.cnt, 10) })),
    usersByDay: userRows.rows.map(r => ({ day: r.day, count: parseInt(r.cnt, 10) })),
    activeUsersByDay: activeUserRows.rows.map(r => ({ day: r.day, count: parseInt(r.cnt, 10) })),
    totals: {
      users: parseInt(totalUsers.rows[0].count, 10),
      analyses: parseInt(totalAnalyses.rows[0].count, 10),
      todayAnalyses: parseInt(todayAnalyses.rows[0].count, 10),
    },
    tierCounts: Object.fromEntries(tierCounts.rows.map(r => [r.tier, parseInt(r.cnt, 10)])),
  });
});

// ─── 자동 배치 현황 ──────────────────────────────────────────────────────────────

const DAILY_TARGET_KR = 25;
const DAILY_TARGET_US = 15;
const DAILY_TARGET = DAILY_TARGET_KR + DAILY_TARGET_US;

// GET /api/admin/batch-status — 일일 자동 배치 실행 현황
router.get("/batch-status", async (req, res) => {
  const userId = getUserId(req);
  if (!(await isAdmin(userId))) {
    res.status(403).json({ error: "관리자만 접근 가능합니다" });
    return;
  }

  const todayStart = `CURRENT_DATE AT TIME ZONE 'Asia/Seoul'`;
  const todayEnd   = `CURRENT_DATE AT TIME ZONE 'Asia/Seoul' + INTERVAL '1 day'`;

  const [cacheRows, lockRow, todayRows, historyRows, totalRow,
         qaAvgRow, peerIssueRow, coverageKrRow, coverageUsRow] = await Promise.all([
    pool.query(`SELECT data FROM system_cache WHERE key = 'auto_batch_last_run'`),
    pool.query(`SELECT expires_at FROM system_cache WHERE key = 'auto_batch_lock' AND expires_at > NOW()`),
    pool.query(`
      SELECT id, ticker, company_name, status, investment_verdict,
             qa_score, peer_flags, created_at
      FROM analyses
      WHERE user_id IS NULL
        AND created_at >= ${todayStart}
        AND created_at <  ${todayEnd}
      ORDER BY created_at ASC
    `),
    pool.query(`
      SELECT
        DATE(created_at AT TIME ZONE 'Asia/Seoul') AS day,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed,
        COUNT(*) FILTER (WHERE status IN ('error','failed')) AS failed,
        COUNT(*) AS total
      FROM analyses
      WHERE user_id IS NULL AND created_at >= NOW() - INTERVAL '14 days'
      GROUP BY day ORDER BY day ASC
    `),
    pool.query(`SELECT COUNT(*) FROM analyses WHERE user_id IS NULL`),
    // 오늘 완료된 AI 보고서 QA 평균
    pool.query(`
      SELECT ROUND(AVG(qa_score), 1) AS avg_qa
      FROM analyses
      WHERE user_id IS NULL AND status = 'completed'
        AND created_at >= ${todayStart} AND created_at < ${todayEnd}
        AND qa_score IS NOT NULL
    `),
    // 오늘 피어 이슈 감지 수
    pool.query(`
      SELECT COUNT(*) FROM analyses
      WHERE user_id IS NULL
        AND created_at >= ${todayStart} AND created_at < ${todayEnd}
        AND peer_flags IS NOT NULL
        AND peer_flags::jsonb ->> 'hasIssues' = 'true'
    `),
    // 누적 KR 종목 커버리지 (6자리 숫자 티커)
    pool.query(`
      SELECT COUNT(DISTINCT ticker) FROM analyses
      WHERE user_id IS NULL AND ticker ~ '^[0-9]{6}'
    `),
    // 누적 US 종목 커버리지
    pool.query(`
      SELECT COUNT(DISTINCT ticker) FROM analyses
      WHERE user_id IS NULL AND ticker !~ '^[0-9]'
    `),
  ]);

  const lastRun = cacheRows.rows[0]?.data?.date ?? null;
  const todayKST = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const lockActive = lockRow.rows.length > 0;
  const lockExpiresAt = lockRow.rows[0]?.expires_at ?? null;

  const todayItems = todayRows.rows.map(r => ({
    id: r.id,
    ticker: r.ticker,
    companyName: r.company_name,
    status: r.status,
    verdict: r.investment_verdict,
    qaScore: r.qa_score ?? null,
    hasPeerIssue: r.peer_flags
      ? (JSON.parse(r.peer_flags)?.hasIssues === true)
      : false,
    createdAt: r.created_at,
  }));
  const todayStats = {
    total:     todayItems.length,
    completed: todayItems.filter(r => r.status === "completed").length,
    failed:    todayItems.filter(r => ["error", "failed"].includes(r.status)).length,
    running:   todayItems.filter(r => ["pending", "running"].includes(r.status)).length,
  };

  const history = historyRows.rows.map(r => ({
    day:       String(r.day).slice(0, 10),
    completed: parseInt(r.completed, 10),
    failed:    parseInt(r.failed, 10),
    total:     parseInt(r.total, 10),
  }));

  res.json({
    lastRun,
    todayRan: lastRun === todayKST,
    lockActive,
    lockExpiresAt,
    todayStats,
    todayItems,
    history,
    totalAutoAnalyses: parseInt(totalRow.rows[0].count, 10),
    dailyTarget:       DAILY_TARGET,
    qaAvgToday:        qaAvgRow.rows[0]?.avg_qa ? parseFloat(qaAvgRow.rows[0].avg_qa) : null,
    peerIssueCountToday: parseInt(peerIssueRow.rows[0].count, 10),
    coverageKr:        parseInt(coverageKrRow.rows[0].count, 10),
    coverageUs:        parseInt(coverageUsRow.rows[0].count, 10),
  });
});

// GET /api/admin/batch-reports — AI 자동 생성 보고서 목록 (페이지네이션)
router.get("/batch-reports", async (req, res) => {
  const userId = getUserId(req);
  if (!(await isAdmin(userId))) {
    res.status(403).json({ error: "관리자만 접근 가능합니다" });
    return;
  }

  const page        = Math.max(1, parseInt(String(req.query.page  ?? "1"),  10));
  const limit       = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? "30"), 10)));
  const offset      = (page - 1) * limit;
  const dateFilter  = String(req.query.date    ?? "").slice(0, 10) || null;
  const verdictFilter = String(req.query.verdict ?? "") || null;
  const hasPeerIssue = req.query.hasPeerIssue === "1";

  const conditions: string[] = ["a.user_id IS NULL"];
  const params: any[] = [];

  if (dateFilter) {
    params.push(dateFilter);
    conditions.push(`DATE(a.created_at AT TIME ZONE 'Asia/Seoul') = $${params.length}`);
  }
  if (verdictFilter) {
    params.push(verdictFilter);
    conditions.push(`a.investment_verdict = $${params.length}`);
  }
  if (hasPeerIssue) {
    conditions.push(`a.peer_flags IS NOT NULL AND a.peer_flags::jsonb ->> 'hasIssues' = 'true'`);
  }
  const where = conditions.join(" AND ");

  params.push(limit, offset);
  const limitParam  = params.length - 1;
  const offsetParam = params.length;

  const [itemsRes, countRes] = await Promise.all([
    pool.query(`
      SELECT a.id, a.ticker, a.company_name, a.status, a.investment_verdict,
             a.created_at, a.qa_score, a.qa_flags, a.peer_flags
      FROM analyses a
      WHERE ${where}
      ORDER BY a.created_at DESC
      LIMIT $${limitParam} OFFSET $${offsetParam}
    `, params),
    pool.query(`
      SELECT COUNT(*) FROM analyses a
      WHERE ${where}
    `, params.slice(0, params.length - 2)),
  ]);

  const items = itemsRes.rows.map(r => ({
    id:           r.id,
    ticker:       r.ticker,
    companyName:  r.company_name,
    status:       r.status,
    verdict:      r.investment_verdict,
    createdAt:    r.created_at,
    qaScore:      r.qa_score ?? null,
    qaFlags:      r.qa_flags ? JSON.parse(r.qa_flags) : [],
    peerResult:   r.peer_flags ? JSON.parse(r.peer_flags) : null,
  }));

  res.json({
    items,
    total:    parseInt(countRes.rows[0].count, 10),
    page,
    limit,
    pages:    Math.ceil(parseInt(countRes.rows[0].count, 10) / limit),
  });
});

// POST /api/admin/force-batch — 오늘 배치 기록 초기화 후 즉시 강제 실행
// 관리자 세션 OR X-Scheduler-Token 헤더로 인증
router.post("/force-batch", async (req, res) => {
  const schedulerToken = req.headers["x-scheduler-token"];
  const userId = getUserId(req);
  const authorized =
    schedulerToken === "internal-scheduler-cbst-2024" ||
    (await isAdmin(userId));
  if (!authorized) {
    res.status(403).json({ error: "관리자만 접근 가능합니다" });
    return;
  }

  try {
    await clearBatchDateForToday();
    const port = parseInt(process.env["PORT"] ?? "8080", 10);
    // 백그라운드 실행 (응답 먼저 반환)
    runDailyAutoBatch(port).catch(e =>
      console.error("[admin/force-batch] 실행 오류:", e?.message)
    );
    res.json({ ok: true, message: "배치 기록 초기화 완료. 자동 배치 실행 시작됩니다." });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "알 수 없는 오류" });
  }
});

// GET /api/admin/peer-issues — 피어 이상 감지된 분석 목록
router.get("/peer-issues", async (req, res) => {
  const userId = getUserId(req);
  if (!(await isAdmin(userId))) {
    res.status(403).json({ error: "관리자만 접근 가능합니다" });
    return;
  }

  // 피어 검증 결과가 있고 이상이 있는 분석만 반환
  const { rows } = await pool.query(`
    SELECT id, ticker, company_name, industry, investment_verdict,
           qa_score, peer_flags, created_at
    FROM analyses
    WHERE status = 'completed'
      AND peer_flags IS NOT NULL
      AND peer_flags::jsonb ->> 'hasIssues' = 'true'
    ORDER BY created_at DESC
    LIMIT 200
  `);

  const items = rows.map(r => {
    let pv: any = {};
    try { pv = JSON.parse(r.peer_flags); } catch { /* ignore */ }
    return {
      id: r.id,
      ticker: r.ticker,
      companyName: r.company_name,
      industry: r.industry,
      verdict: r.investment_verdict,
      qaScore: r.qa_score,
      createdAt: r.created_at,
      validPeerCount: pv.validPeerCount ?? 0,
      totalPeerCount: pv.totalPeerCount ?? 0,
      issues: (pv.issues ?? []) as Array<{
        type: string; ticker?: string; detail: string; severity: string;
      }>,
    };
  });

  // 이상 유형별 집계
  const typeCounts: Record<string, number> = {};
  for (const item of items) {
    for (const issue of item.issues) {
      typeCounts[issue.type] = (typeCounts[issue.type] ?? 0) + 1;
    }
  }

  // 아직 피어 검증 안 된 분석 수
  const { rows: uncheckedRows } = await pool.query(`
    SELECT COUNT(*) FROM analyses
    WHERE status = 'completed' AND peer_flags IS NULL
  `);

  res.json({
    items,
    typeCounts,
    totalIssues: items.length,
    uncheckedCount: parseInt(uncheckedRows[0].count, 10),
  });
});

// POST /api/admin/peer-validate-all — 기존 완료 분석 피어 일괄 재검증
router.post("/peer-validate-all", async (req, res) => {
  const userId = getUserId(req);
  if (!(await isAdmin(userId))) {
    res.status(403).json({ error: "관리자만 접근 가능합니다" });
    return;
  }

  // peer_flags 없는 완료 분석만 (최대 100개씩 배치)
  const { rows } = await pool.query(`
    SELECT id, ticker, industry FROM analyses
    WHERE status = 'completed' AND peer_flags IS NULL
    LIMIT 100
  `);

  res.json({ queued: rows.length, message: `${rows.length}개 피어 검증 백그라운드 실행 중` });

  // 백그라운드에서 비동기 실행
  (async () => {
    const { validatePeers } = await import("../lib/peer-validator.js");
    await pool.query(`ALTER TABLE analyses ADD COLUMN IF NOT EXISTS peer_flags TEXT`);

    let ok = 0, skip = 0;
    for (const row of rows) {
      try {
        const pvResult = await validatePeers(row.ticker, row.industry ?? null);
        if (pvResult.totalPeerCount > 0 || pvResult.issues.length > 0) {
          await pool.query(
            `UPDATE analyses SET peer_flags=$1 WHERE id=$2`,
            [JSON.stringify(pvResult), row.id]
          );
          ok++;
        } else {
          // 피어 파일 없음 — NULL 대신 빈 결과 저장해 재실행 방지
          await pool.query(
            `UPDATE analyses SET peer_flags=$1 WHERE id=$2`,
            [JSON.stringify({ issues: [], validPeerCount: 0, totalPeerCount: 0, hasIssues: false }), row.id]
          );
          skip++;
        }
      } catch (e: any) {
        console.error(`[peer-validate-all] #${row.id} ${row.ticker} 실패:`, e?.message);
      }
      // 야후 API 부하 방지
      await new Promise(r => setTimeout(r, 300));
    }
    console.log(`[peer-validate-all] 완료: ${ok}개 결과 저장, ${skip}개 피어 파일 없음`);
  })();
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
  const ALLOWED_SETTING_KEYS = new Set([
    "notice_enabled", "notice_text", "notice_type",
    "maintenance_mode", "signup_enabled", "default_daily_limit",
    "banner_text", "banner_url", "feature_flags",
  ]);
  const updates = req.body as Record<string, string>;
  const invalid = Object.keys(updates).filter(k => !ALLOWED_SETTING_KEYS.has(k));
  if (invalid.length > 0) {
    res.status(400).json({ error: `허용되지 않은 설정 키: ${invalid.join(", ")}` });
    return;
  }
  for (const [key, value] of Object.entries(updates)) {
    await pool.query(
      `INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, String(value).slice(0, 2000)]
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
  const tierFilter = (req.query.tier as string | undefined)?.trim() ?? "";
  const sortBy = (req.query.sortBy as string | undefined) ?? "created_at";
  const page = Math.max(1, parseInt((req.query.page as string) ?? "1", 10));
  const limit = 50;
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const baseParams: any[] = [];

  if (search) {
    const idx = baseParams.length + 1;
    conditions.push(`(uc.user_id ILIKE $${idx} OR uc.display_name ILIKE $${idx} OR uc.email ILIKE $${idx})`);
    baseParams.push(`%${search}%`);
  }
  if (tierFilter && tierFilter !== "all") {
    const idx = baseParams.length + 1;
    conditions.push(`uc.tier = $${idx}`);
    baseParams.push(tierFilter);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const SORT_MAP: Record<string, string> = {
    created_at: "uc.created_at DESC",
    total_analyses: "uc.total_analyses DESC",
    last_activity: "last_activity DESC NULLS LAST",
    recent_analyses: "recent_analyses DESC",
  };
  const orderBy = SORT_MAP[sortBy] ?? SORT_MAP.created_at;

  const listParams = [...baseParams, limit, offset];
  const limitIdx = baseParams.length + 1;
  const offsetIdx = baseParams.length + 2;

  const { rows } = await pool.query(
    `SELECT
       uc.user_id,
       uc.daily_used,
       uc.daily_limit,
       uc.bonus_credits,
       COUNT(a.id) AS total_analyses,
       uc.tier,
       uc.admin_memo,
       uc.display_name,
       uc.email,
       uc.created_at,
       uc.last_login_at,
       COUNT(a.id) FILTER (WHERE a.created_at >= NOW() - INTERVAL '7 days') AS recent_analyses,
       MAX(a.created_at) AS last_activity
     FROM user_credits uc
     LEFT JOIN analyses a ON a.user_id = uc.user_id
     ${whereClause}
     GROUP BY uc.user_id, uc.daily_used, uc.daily_limit, uc.bonus_credits, uc.tier, uc.admin_memo, uc.display_name, uc.email, uc.created_at, uc.last_login_at
     ORDER BY ${orderBy}
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    listParams
  );

  const countResult = await pool.query(
    `SELECT COUNT(*) FROM user_credits uc ${whereClause}`,
    baseParams
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
      email: r.email ?? null,
      createdAt: r.created_at,
      lastLoginAt: r.last_login_at ?? null,
      lastActivity: r.last_activity ?? null,
    })),
    total: parseInt(countResult.rows[0].count, 10),
    page,
    limit,
  });
});

// GET /api/admin/user-list/export — 유저 목록 CSV 내보내기
router.get("/user-list/export", async (req, res) => {
  const userId = getUserId(req);
  if (!(await isAdmin(userId))) {
    res.status(403).json({ error: "관리자만 접근 가능합니다" });
    return;
  }
  const { rows } = await pool.query(
    `SELECT
       uc.user_id, uc.display_name, uc.email, uc.tier,
       COUNT(a.id) AS total_analyses, uc.bonus_credits, uc.daily_limit, uc.daily_used,
       uc.created_at,
       MAX(a.created_at) AS last_activity,
       COUNT(a.id) FILTER (WHERE a.created_at >= NOW() - INTERVAL '7 days') AS recent_analyses
     FROM user_credits uc
     LEFT JOIN analyses a ON a.user_id = uc.user_id
     GROUP BY uc.user_id, uc.display_name, uc.email, uc.tier,
              uc.bonus_credits, uc.daily_limit, uc.daily_used, uc.created_at
     ORDER BY uc.created_at DESC`
  );
  const header = "카카오ID,닉네임,이메일,등급,전체분석,7일분석,보너스크레딧,오늘한도,마지막활동,가입일";
  const lines = rows.map(r => [
    r.user_id,
    r.display_name ?? "",
    r.email ?? "",
    r.tier ?? "free",
    r.total_analyses,
    r.recent_analyses,
    r.bonus_credits,
    r.daily_limit,
    r.last_activity ? new Date(r.last_activity).toISOString().slice(0, 10) : "",
    r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : "",
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="users_${new Date().toISOString().slice(0,10)}.csv"`);
  res.send("\uFEFF" + [header, ...lines].join("\n"));
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
        `SELECT uc.user_id, uc.daily_limit, uc.daily_used, uc.bonus_credits,
                COUNT(a.id) AS total_analyses,
                uc.tier, uc.admin_memo, uc.display_name, uc.email, uc.created_at
         FROM user_credits uc
         LEFT JOIN analyses a ON a.user_id = uc.user_id
         WHERE uc.user_id = $1
         GROUP BY uc.user_id, uc.daily_limit, uc.daily_used, uc.bonus_credits,
                  uc.tier, uc.admin_memo, uc.display_name, uc.email, uc.created_at`, [targetId]
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


// ─── 수익 지표 ─────────────────────────────────────────────────────────────
router.get("/revenue-stats", async (req, res) => {
  const userId = getUserId(req);
  if (!(await isAdmin(userId))) return res.status(403).json({ error: "관리자만 접근 가능합니다" });
  try {
    const [tierCounts, weeklySignups, tokenCosts, repeatUsers, funnelData] = await Promise.all([
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
      pool.query(`
        SELECT
          (SELECT COUNT(*) FROM user_credits) AS total_users,
          (SELECT COUNT(DISTINCT a.user_id) FROM analyses a WHERE a.user_id IS NOT NULL) AS analyzed_users,
          (SELECT COUNT(DISTINCT a.user_id) FROM analyses a WHERE a.user_id IS NOT NULL
           GROUP BY a.user_id HAVING COUNT(*) > 1) AS repeat_count
      `),
    ]);
    const tiers: Record<string, number> = {};
    for (const r of tierCounts.rows) tiers[r.tier] = parseInt(r.cnt, 10);
    const PRICING: Record<string, number> = { free: 0, beta: 9900, premium: 29900 };
    const mrrKrw = Object.entries(tiers)
      .reduce((sum, [t, n]) => sum + (PRICING[t] ?? 0) * n, 0);
    const f = funnelData.rows[0];
    res.json({
      tierCounts: tiers,
      mrrKrw,
      weeklySignups: weeklySignups.rows,
      tokenCosts: tokenCosts.rows[0],
      repeatUserCount: repeatUsers.rowCount ?? 0,
      funnel: {
        totalUsers: parseInt(f?.total_users ?? "0", 10),
        analyzedUsers: parseInt(f?.analyzed_users ?? "0", 10),
        repeatUsers: repeatUsers.rowCount ?? 0,
      },
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

// ─── AI 품질 모니터링 ────────────────────────────────────────────────────────
router.get("/quality-stats", async (req, res) => {
  const userId = getUserId(req);
  if (!(await isAdmin(userId))) return res.status(403).json({ error: "관리자만 접근 가능합니다" });
  try {
    // 일별 오류율 + 평균 소요 시간 (최근 30일)
    const { rows: daily } = await pool.query(`
      SELECT
        TO_CHAR(created_at AT TIME ZONE 'Asia/Seoul', 'MM/DD') AS day,
        DATE_TRUNC('day', created_at AT TIME ZONE 'Asia/Seoul') AS day_ts,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'error') AS errors,
        ROUND(
          COUNT(*) FILTER (WHERE status = 'error')::NUMERIC / NULLIF(COUNT(*), 0) * 100,
          1
        ) AS error_rate,
        ROUND(
          AVG(
            EXTRACT(EPOCH FROM (
              COALESCE(completed_at, updated_at) - created_at
            ))
          ) FILTER (WHERE status = 'completed') / 60.0,
          1
        ) AS avg_duration_min
      FROM analyses
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY day, day_ts
      ORDER BY day_ts ASC
    `);

    // 전체 요약
    const { rows: summary } = await pool.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed,
        COUNT(*) FILTER (WHERE status = 'error') AS errors,
        COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress,
        ROUND(
          COUNT(*) FILTER (WHERE status = 'error')::NUMERIC / NULLIF(COUNT(*), 0) * 100,
          1
        ) AS error_rate,
        ROUND(
          AVG(EXTRACT(EPOCH FROM (COALESCE(completed_at, updated_at) - created_at)) / 60.0)
          FILTER (WHERE status = 'completed'),
          1
        ) AS avg_duration_min
      FROM analyses
      WHERE created_at >= NOW() - INTERVAL '30 days'
    `);

    // 오류 상세 최근 10건
    const { rows: recentErrors } = await pool.query(`
      SELECT id, ticker, company_name, error_message, created_at
      FROM analyses
      WHERE status = 'error'
      ORDER BY created_at DESC
      LIMIT 10
    `);

    res.json({ daily, summary: summary[0], recentErrors });
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// ─── 프롬프트 버전 관리 ──────────────────────────────────────────────────────
router.get("/prompt-versions", async (req, res) => {
  const userId = getUserId(req);
  if (!(await isAdmin(userId))) return res.status(403).json({ error: "관리자만 접근 가능합니다" });
  const { rows } = await pool.query(
    `SELECT id, name, stage, description, ab_group, is_active, created_at, updated_at,
            LENGTH(content) AS content_length
     FROM prompt_versions
     ORDER BY stage, created_at DESC`
  );
  res.json(rows);
});

router.get("/prompt-versions/:id", async (req, res) => {
  const userId = getUserId(req);
  if (!(await isAdmin(userId))) return res.status(403).json({ error: "관리자만 접근 가능합니다" });
  const { rows } = await pool.query(`SELECT * FROM prompt_versions WHERE id = $1`, [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: "not found" });
  res.json(rows[0]);
});

router.post("/prompt-versions", async (req, res) => {
  const userId = getUserId(req);
  if (!(await isAdmin(userId))) return res.status(403).json({ error: "관리자만 접근 가능합니다" });
  const { name, stage, content, description, ab_group } = req.body;
  if (!name || !stage || !content) return res.status(400).json({ error: "name, stage, content 필수" });
  const { rows } = await pool.query(
    `INSERT INTO prompt_versions (name, stage, content, description, ab_group)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [name, stage, content, description ?? null, ab_group ?? null]
  );
  res.json(rows[0]);
});

router.put("/prompt-versions/:id", async (req, res) => {
  const userId = getUserId(req);
  if (!(await isAdmin(userId))) return res.status(403).json({ error: "관리자만 접근 가능합니다" });
  const { name, stage, content, description, ab_group, is_active } = req.body;
  const { rows } = await pool.query(
    `UPDATE prompt_versions
     SET name = COALESCE($1, name),
         stage = COALESCE($2, stage),
         content = COALESCE($3, content),
         description = COALESCE($4, description),
         ab_group = $5,
         is_active = COALESCE($6, is_active),
         updated_at = NOW()
     WHERE id = $7 RETURNING *`,
    [name, stage, content, description, ab_group ?? null, is_active, req.params.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: "not found" });
  res.json(rows[0]);
});

router.patch("/prompt-versions/:id/toggle-active", async (req, res) => {
  const userId = getUserId(req);
  if (!(await isAdmin(userId))) return res.status(403).json({ error: "관리자만 접근 가능합니다" });
  const { rows } = await pool.query(
    `UPDATE prompt_versions SET is_active = NOT is_active, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [req.params.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: "not found" });
  res.json(rows[0]);
});

router.delete("/prompt-versions/:id", async (req, res) => {
  const userId = getUserId(req);
  if (!(await isAdmin(userId))) return res.status(403).json({ error: "관리자만 접근 가능합니다" });
  await pool.query(`DELETE FROM prompt_versions WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
});

// ─── QA 자동 채점 ──────────────────────────────────────────────────────────────

import { runQACheck } from "../lib/qa-checker.js";

async function ensureQAColumns() {
  await pool.query(`
    ALTER TABLE analyses
      ADD COLUMN IF NOT EXISTS qa_score INTEGER,
      ADD COLUMN IF NOT EXISTS qa_flags TEXT
  `);
}

async function scoreOne(analysisId: number) {
  await ensureQAColumns();
  const [aRes, sRes] = await Promise.all([
    pool.query(
      `SELECT investment_verdict, target_price, entry_price, stop_loss, risk_reward_ratio
       FROM analyses WHERE id = $1`,
      [analysisId]
    ),
    pool.query(
      `SELECT step_key, content FROM analysis_steps WHERE analysis_id = $1`,
      [analysisId]
    ),
  ]);
  if (!aRes.rows[0]) return null;
  const a = aRes.rows[0];
  const result = runQACheck({
    investmentVerdict: a.investment_verdict,
    targetPrice: a.target_price,
    entryPrice: a.entry_price,
    stopLoss: a.stop_loss,
    riskRewardRatio: a.risk_reward_ratio,
    steps: sRes.rows.map((r: any) => ({ stepKey: r.step_key, content: r.content ?? "" })),
  });
  await pool.query(
    `UPDATE analyses SET qa_score=$1, qa_flags=$2 WHERE id=$3`,
    [result.score, JSON.stringify(result.flags), analysisId]
  );
  return result;
}

// GET /api/admin/qa-reports — QA 점수 포함 완성 리포트 목록
router.get("/qa-reports", async (req, res) => {
  const userId = getUserId(req);
  if (!(await isAdmin(userId))) { res.status(403).json({ error: "관리자만 접근 가능합니다" }); return; }

  await ensureQAColumns();

  const minScore = parseInt(req.query.minScore as string ?? "0", 10);
  const maxScore = parseInt(req.query.maxScore as string ?? "100", 10);
  const limit = Math.min(parseInt(req.query.limit as string ?? "100", 10), 500);

  const { rows } = await pool.query(
    `SELECT a.id, a.ticker, a.company_name, a.investment_verdict, a.target_price, a.start_price,
            a.qa_score, a.qa_flags, a.created_at, a.updated_at,
            uc.display_name AS user_name
     FROM analyses a
     LEFT JOIN user_credits uc ON uc.user_id = a.user_id
     WHERE a.status = 'completed'
       AND (a.qa_score IS NULL OR (a.qa_score >= $1 AND a.qa_score <= $2))
     ORDER BY a.qa_score ASC NULLS FIRST, a.created_at DESC
     LIMIT $3`,
    [minScore, maxScore, limit]
  );

  const gradeOf = (s: number | null): string => {
    if (s === null) return "?";
    if (s >= 90) return "A";
    if (s >= 75) return "B";
    if (s >= 60) return "C";
    if (s >= 40) return "D";
    return "F";
  };

  const summary = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status='completed') AS total,
       ROUND(AVG(qa_score) FILTER (WHERE status='completed' AND qa_score IS NOT NULL)) AS avg_score,
       COUNT(*) FILTER (WHERE status='completed' AND qa_score IS NULL) AS unscored,
       COUNT(*) FILTER (WHERE status='completed' AND qa_score >= 90) AS grade_a,
       COUNT(*) FILTER (WHERE status='completed' AND qa_score >= 75 AND qa_score < 90) AS grade_b,
       COUNT(*) FILTER (WHERE status='completed' AND qa_score >= 60 AND qa_score < 75) AS grade_c,
       COUNT(*) FILTER (WHERE status='completed' AND qa_score >= 40 AND qa_score < 60) AS grade_d,
       COUNT(*) FILTER (WHERE status='completed' AND qa_score < 40) AS grade_f
     FROM analyses`
  );

  res.json({
    summary: summary.rows[0],
    reports: rows.map(r => ({
      ...r,
      qa_flags: r.qa_flags ? JSON.parse(r.qa_flags) : [],
      grade: gradeOf(r.qa_score),
    })),
  });
});

// POST /api/admin/qa-check/:id — 단일 리포트 채점
router.post("/qa-check/:id", async (req, res) => {
  const userId = getUserId(req);
  if (!(await isAdmin(userId))) { res.status(403).json({ error: "관리자만 접근 가능합니다" }); return; }

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "잘못된 ID" }); return; }

  const result = await scoreOne(id);
  if (!result) { res.status(404).json({ error: "분석을 찾을 수 없습니다" }); return; }

  res.json(result);
});

// POST /api/admin/qa-check-all — 완성 리포트 전체 배치 채점
router.post("/qa-check-all", async (req, res) => {
  const userId = getUserId(req);
  if (!(await isAdmin(userId))) { res.status(403).json({ error: "관리자만 접근 가능합니다" }); return; }

  const { rows } = await pool.query(
    `SELECT id FROM analyses WHERE status='completed' ORDER BY created_at DESC LIMIT 500`
  );

  res.json({ started: true, count: rows.length });

  (async () => {
    let ok = 0, fail = 0;
    for (const row of rows) {
      try { await scoreOne(row.id); ok++; }
      catch { fail++; }
    }
    console.log(`[qa-batch] 완료: ${ok}건 성공, ${fail}건 실패`);
  })().catch(console.error);
});

// GET /api/admin/analysis/:id/text — 리포트 전체를 plain text로 반환 (관리자 전용, Claude 검수용)
router.get("/analysis/:id/text", async (req, res) => {
  const userId = getUserId(req);
  if (!(await isAdmin(userId))) {
    res.status(403).send("관리자만 접근 가능합니다");
    return;
  }
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).send("Invalid id"); return; }

  try {
    const aRows = await pool.query(`SELECT * FROM analyses WHERE id = $1 LIMIT 1`, [id]);
    if (!aRows.rows[0]) { res.status(404).send("Not found"); return; }
    const a = aRows.rows[0];

    const stepsRows = await pool.query(
      `SELECT * FROM analysis_steps WHERE analysis_id = $1 ORDER BY id ASC`, [id]
    );

    const STEP_ORDER_LOCAL = [
      "company_intro","industry_analysis","catalyst_analysis",
      "company_analysis","relative_valuation","market_analysis","investment_strategy",
    ];
    const STEP_NAMES: Record<string, string> = {
      company_intro:      "브리핑",
      industry_analysis:  "매크로 및 산업 분석",
      catalyst_analysis:  "투자 촉매 및 수급 분석",
      company_analysis:   "실적 전망",
      relative_valuation: "적정주가 산출",
      market_analysis:    "기술적 분석",
      investment_strategy:"최종 결론",
    };

    function cleanContent(raw: string): string {
      return raw
        .replace(/\nCHART_DATA:\{[^\n]+\}(\nEVENTS_DATA:\[[^\n]*\])?(\nVALUATION_DATA:\{[^\n]+\})?(\nFINAL_VALUATION_DATA:\{[^\n]+\})?\s*$/m, "")
        .replace(/\nFINAL_VALUATION_DATA:\{[^\n]+\}\s*$/m, "")
        .replace(/FINAL_VALUATION_DATA:\{[^}]+\}/g, "")
        .replace(/```json[\s\S]*?```/g, "")
        .replace(/\{[\s\S]*?"verdict"[\s\S]*?\}/g, "")
        .replace(/^\[STEP \d+\][^\n]*/gm, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }

    const steps = stepsRows.rows
      .filter((s: any) => s.status === "completed" && s.content)
      .sort((a: any, b: any) => STEP_ORDER_LOCAL.indexOf(a.step_key) - STEP_ORDER_LOCAL.indexOf(b.step_key));

    const lines: string[] = [];
    lines.push(`# ${a.company_name} (${a.ticker}) 리서치 리포트`);
    lines.push(`분석일: ${a.created_at ? new Date(a.created_at).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" }) : "—"}`);
    if (a.investment_verdict) lines.push(`투자 판정: ${a.investment_verdict}`);
    if (a.target_price) lines.push(`적정주가: ${Number(a.target_price).toLocaleString()}`);
    lines.push(`\n${"=".repeat(60)}\n`);

    for (const step of steps) {
      const stepName = STEP_NAMES[step.step_key] ?? step.step_key;
      lines.push(`## ${stepName}`);
      lines.push(cleanContent(step.content ?? ""));
      lines.push(`\n${"─".repeat(40)}\n`);
    }

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send(lines.join("\n"));
  } catch (err: any) {
    console.error("[admin/analysis/:id/text] error:", err?.message);
    res.status(500).send("Server error");
  }
});

// GET /api/admin/ticker-coverage — 종목 커버리지 (KR / US)
router.get("/ticker-coverage", async (req, res) => {
  const userId = getUserId(req);
  if (!(await isAdmin(userId))) {
    res.status(403).json({ error: "관리자만 접근 가능합니다" });
    return;
  }

  const market  = String(req.query.market  ?? "KR").toUpperCase() as "KR" | "US";
  const search  = String(req.query.search  ?? "").trim().toLowerCase();
  const status  = String(req.query.status  ?? "all") as "all" | "covered" | "uncovered";
  const page    = Math.max(1, parseInt(String(req.query.page  ?? "1"),  10));
  const limit   = Math.min(100, Math.max(10, parseInt(String(req.query.limit ?? "50"), 10)));

  try {
    // DB에서 AI 자동 분석이 있는 종목별 통계 조회
    const covRows = await pool.query(`
      SELECT ticker,
             COUNT(*)                                        AS report_count,
             MAX(created_at AT TIME ZONE 'Asia/Seoul')::date AS last_date
      FROM analyses
      WHERE user_id IS NULL
      GROUP BY ticker
    `);

    const covMap = new Map<string, { reportCount: number; lastDate: string }>();
    for (const r of covRows.rows) {
      covMap.set(r.ticker, {
        reportCount: parseInt(r.report_count, 10),
        lastDate: String(r.last_date).slice(0, 10),
      });
    }

    // 마스터 목록 로드
    type MasterEntry = { ticker: string; name: string; exchange: string };
    let masterList: MasterEntry[] = [];

    if (market === "KR") {
      const krxList = await loadKRXList();
      masterList = krxList.map(e => ({ ticker: e.code, name: e.name, exchange: e.exchange }));
    } else {
      masterList = US_MASTER_LIST.map(e => ({ ticker: e.ticker, name: e.name, exchange: e.exchange }));
    }

    // 검색 + 상태 필터
    let filtered = masterList.filter(e => {
      if (search) {
        const t = e.ticker.toLowerCase();
        const n = e.name.toLowerCase();
        if (!t.includes(search) && !n.includes(search)) return false;
      }
      if (status === "covered")   return covMap.has(e.ticker);
      if (status === "uncovered") return !covMap.has(e.ticker);
      return true;
    });

    const total     = filtered.length;
    const totalFull = masterList.length;
    const coveredFull = masterList.filter(e => covMap.has(e.ticker)).length;
    const pages     = Math.max(1, Math.ceil(total / limit));
    const offset    = (page - 1) * limit;
    const slice     = filtered.slice(offset, offset + limit);

    const tickers = slice.map(e => ({
      ticker:      e.ticker,
      name:        e.name,
      exchange:    e.exchange,
      isCovered:   covMap.has(e.ticker),
      reportCount: covMap.get(e.ticker)?.reportCount ?? 0,
      lastDate:    covMap.get(e.ticker)?.lastDate ?? null,
    }));

    res.json({
      tickers,
      total,
      totalFull,
      covered: coveredFull,
      uncovered: totalFull - coveredFull,
      page,
      pages,
      limit,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "failed" });
  }
});

// ─── 섹터 보정 지침 관리 ──────────────────────────────────────────────────────

// GET /api/admin/sector-priors — 모든 섹터의 보정 지침 + 실적 통계 반환
router.get("/sector-priors", async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!(await isAdmin(userId))) { res.status(403).json({ error: "forbidden" }); return; }

    const [priorsRes, statsRes] = await Promise.all([
      pool.query(`SELECT * FROM sector_priors ORDER BY sector`),
      pool.query(`SELECT sector, direction_accuracy, avg_price_deviation, sample_count, sector_benchmarks, diagnosis_note, last_recalc_at FROM model_calibration ORDER BY sector`),
    ]);

    const dbPriorMap = new Map(priorsRes.rows.map((r: any) => [r.sector, r]));
    const dbStatsMap = new Map(statsRes.rows.map((r: any) => [r.sector, r]));

    const allSectors = new Set([
      ...Object.keys(SECTOR_PRIORS),
      ...priorsRes.rows.map((r: any) => r.sector),
      ...statsRes.rows.map((r: any) => r.sector),
    ]);

    const result = Array.from(allSectors).map(sector => {
      const dbPrior = dbPriorMap.get(sector) as any;
      const hcPrior = SECTOR_PRIORS[sector];
      const s = dbStatsMap.get(sector) as any;
      return {
        sector,
        prior: dbPrior ? {
          waccRange:        dbPrior.wacc_range,
          terminalG:        dbPrior.terminal_g,
          peersNote:        dbPrior.peers_note,
          biasRisk:         dbPrior.bias_risk,
          specificLevers:   dbPrior.specific_levers ?? [],
          updatedAt:        dbPrior.updated_at,
          isCustomized:     true,
          isAutoUpdated:    dbPrior.is_auto_updated ?? false,
          autoUpdateNotes:  dbPrior.auto_update_notes ?? null,
        } : hcPrior ? {
          waccRange:      hcPrior.waccRange,
          terminalG:      hcPrior.terminalG,
          peersNote:      hcPrior.peersNote,
          biasRisk:       hcPrior.biasRisk,
          specificLevers: hcPrior.specificLevers,
          updatedAt:      null,
          isCustomized:   false,
        } : null,
        stats: s ? {
          directionAccuracy: s.direction_accuracy,
          avgDeviation:      s.avg_price_deviation,
          sampleCount:       s.sample_count,
          diagnosisNote:     s.diagnosis_note,
          lastRecalc:        s.last_recalc_at,
          benchmarks:        s.sector_benchmarks,
        } : null,
      };
    }).sort((a, b) => a.sector.localeCompare(b.sector));

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "failed" });
  }
});

// PUT /api/admin/sector-priors/:sector — 섹터 보정 지침 저장 (DB 우선 적용)
router.put("/sector-priors/:sector", async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!(await isAdmin(userId))) { res.status(403).json({ error: "forbidden" }); return; }

    const { sector } = req.params;
    const { waccRange, terminalG, peersNote, biasRisk, specificLevers } = req.body;

    await pool.query(
      `INSERT INTO sector_priors (sector, wacc_range, terminal_g, peers_note, bias_risk, specific_levers, is_auto_updated, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, FALSE, NOW())
       ON CONFLICT (sector) DO UPDATE SET
         wacc_range      = EXCLUDED.wacc_range,
         terminal_g      = EXCLUDED.terminal_g,
         peers_note      = EXCLUDED.peers_note,
         bias_risk       = EXCLUDED.bias_risk,
         specific_levers = EXCLUDED.specific_levers,
         is_auto_updated = FALSE,
         updated_at      = NOW()`,
      [sector, waccRange ?? "", terminalG ?? "", peersNote ?? "", biasRisk ?? "", JSON.stringify(specificLevers ?? [])]
    );
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "failed" });
  }
});

// POST /api/admin/sector-priors/auto-update — 전체 섹터 자동 최적화 트리거 (sample_count >= 5인 섹터만)
router.post("/sector-priors/auto-update", async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!(await isAdmin(userId))) { res.status(403).json({ error: "forbidden" }); return; }

    const { autoUpdateAllSectorPriors } = await import("./performance.js");
    const result = await autoUpdateAllSectorPriors();
    res.json({ ok: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "failed" });
  }
});

// POST /api/admin/sector-priors/:sector/auto-update — 단일 섹터 자동 최적화
router.post("/sector-priors/:sector/auto-update", async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!(await isAdmin(userId))) { res.status(403).json({ error: "forbidden" }); return; }

    const { sector } = req.params;
    const { autoUpdateAllSectorPriors } = await import("./performance.js");
    // 해당 섹터의 model_calibration을 1건만 확인 후 함수 재사용
    const statsRes = await pool.query(
      `SELECT sample_count FROM model_calibration WHERE sector = $1`, [sector]
    );
    const sampleCount = statsRes.rows[0]?.sample_count ?? 0;
    if (sampleCount < 5) {
      res.json({ ok: false, reason: `분석 이력 부족 (현재 ${sampleCount}건, 최소 5건 필요)` });
      return;
    }
    // 전체 함수를 호출하되 결과에서 해당 섹터 확인
    const result = await autoUpdateAllSectorPriors();
    res.json({ ok: true, sector, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "failed" });
  }
});

// DELETE /api/admin/sector-priors/:sector — 커스터마이즈 삭제 (하드코딩 기본값으로 복원)
router.delete("/sector-priors/:sector", async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!(await isAdmin(userId))) { res.status(403).json({ error: "forbidden" }); return; }

    const { sector } = req.params;
    await pool.query(`DELETE FROM sector_priors WHERE sector = $1`, [sector]);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "failed" });
  }
});

export default router;

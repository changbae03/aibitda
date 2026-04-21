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

export default router;

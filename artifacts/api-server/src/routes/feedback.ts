import { Router } from "express";
import { pool } from "@workspace/db";
import { getUserId } from "../lib/credits.js";

const router = Router();

async function q(sql: string, params: any[] = []) {
  const client = await pool.connect();
  try {
    const res = await client.query(sql, params);
    return res.rows;
  } finally {
    client.release();
  }
}

async function isAdmin(userId: string | null): Promise<boolean> {
  if (!userId) return false;
  const rows = await q(`SELECT 1 FROM admins WHERE user_id = $1 LIMIT 1`, [userId]);
  return rows.length > 0;
}

router.post("/feedback", async (req, res) => {
  const userId = getUserId(req);
  const { category, content } = req.body as { category?: string; content?: string };

  if (!content || content.trim().length < 5) {
    res.status(400).json({ error: "피드백 내용을 5자 이상 입력해주세요." });
    return;
  }
  if (content.trim().length > 2000) {
    res.status(400).json({ error: "피드백은 2000자 이하로 입력해주세요." });
    return;
  }

  try {
    await q(
      `CREATE TABLE IF NOT EXISTS feedback (
        id SERIAL PRIMARY KEY,
        user_id TEXT,
        category TEXT,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      )`,
      []
    );

    await q(
      `INSERT INTO feedback (user_id, category, content) VALUES ($1, $2, $3)`,
      [userId ?? null, category ?? null, content.trim()]
    );

    res.json({ success: true });
  } catch (err: any) {
    console.error("[POST /feedback] error:", err?.message);
    res.status(500).json({ error: "저장 중 오류가 발생했습니다." });
  }
});

// GET /api/feedback — 어드민 전용 목록 조회
router.get("/feedback", async (req, res) => {
  const userId = getUserId(req);
  if (!(await isAdmin(userId))) {
    res.status(403).json({ error: "관리자 전용" });
    return;
  }

  try {
    await q(
      `CREATE TABLE IF NOT EXISTS feedback (
        id SERIAL PRIMARY KEY,
        user_id TEXT,
        category TEXT,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      )`,
      []
    );

    const { category, search, limit = "50", offset = "0" } = req.query as Record<string, string>;

    const conditions: string[] = [];
    const params: any[] = [];

    if (category && category !== "all") {
      params.push(category);
      conditions.push(`category = $${params.length}`);
    }
    if (search && search.trim()) {
      params.push(`%${search.trim()}%`);
      conditions.push(`content ILIKE $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const rows = await q(
      `SELECT id, user_id, category, content, created_at
       FROM feedback ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, parseInt(limit), parseInt(offset)]
    );

    const countRows = await q(
      `SELECT COUNT(*)::int AS total FROM feedback ${where}`,
      params
    );

    res.json({ items: rows, total: countRows[0]?.total ?? 0 });
  } catch (err: any) {
    console.error("[GET /feedback] error:", err?.message);
    res.status(500).json({ error: "조회 중 오류가 발생했습니다." });
  }
});

// DELETE /api/feedback/:id — 어드민 전용 삭제
router.delete("/feedback/:id", async (req, res) => {
  const userId = getUserId(req);
  if (!(await isAdmin(userId))) {
    res.status(403).json({ error: "관리자 전용" });
    return;
  }

  try {
    await q(`DELETE FROM feedback WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: "삭제 중 오류가 발생했습니다." });
  }
});

export default router;

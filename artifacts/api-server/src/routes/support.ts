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

async function ensureTable() {
  await q(`
    CREATE TABLE IF NOT EXISTS support_inquiries (
      id SERIAL PRIMARY KEY,
      user_id TEXT,
      category TEXT,
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      admin_reply TEXT,
      replied_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `);
}

// POST /api/support/inquiry — 문의 제출 (누구나)
router.post("/support/inquiry", async (req, res) => {
  await ensureTable();
  const userId = getUserId(req);
  const { category, content } = req.body as { category?: string; content?: string };

  if (!content || content.trim().length < 5) {
    res.status(400).json({ error: "문의 내용을 5자 이상 입력해주세요." });
    return;
  }
  if (content.trim().length > 3000) {
    res.status(400).json({ error: "문의는 3000자 이하로 입력해주세요." });
    return;
  }

  try {
    await q(
      `INSERT INTO support_inquiries (user_id, category, content) VALUES ($1, $2, $3)`,
      [userId ?? null, category ?? null, content.trim()]
    );
    res.json({ success: true });
  } catch (err: any) {
    console.error("[POST /support/inquiry]", err?.message);
    res.status(500).json({ error: "저장 중 오류가 발생했습니다." });
  }
});

// GET /api/support/my — 내 문의 목록 (로그인 필요)
router.get("/support/my", async (req, res) => {
  await ensureTable();
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "로그인 필요" }); return; }

  try {
    const rows = await q(
      `SELECT id, category, content, status, admin_reply, replied_at, created_at
       FROM support_inquiries WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [userId]
    );
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: "조회 중 오류가 발생했습니다." });
  }
});

// GET /api/support/inquiry — 어드민 목록 조회
router.get("/support/inquiry", async (req, res) => {
  await ensureTable();
  const userId = getUserId(req);
  if (!(await isAdmin(userId))) { res.status(403).json({ error: "관리자 전용" }); return; }

  const { status, search, limit = "100", offset = "0" } = req.query as Record<string, string>;
  const conditions: string[] = [];
  const params: any[] = [];

  if (status && status !== "all") {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }
  if (search?.trim()) {
    params.push(`%${search.trim()}%`);
    conditions.push(`content ILIKE $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  try {
    const rows = await q(
      `SELECT id, user_id, category, content, status, admin_reply, replied_at, created_at
       FROM support_inquiries ${where} ORDER BY created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, parseInt(limit), parseInt(offset)]
    );
    const countRows = await q(`SELECT COUNT(*)::int AS total FROM support_inquiries ${where}`, params);
    res.json({ items: rows, total: countRows[0]?.total ?? 0 });
  } catch (err: any) {
    res.status(500).json({ error: "조회 중 오류가 발생했습니다." });
  }
});

// POST /api/support/inquiry/:id/reply — 어드민 답변
router.post("/support/inquiry/:id/reply", async (req, res) => {
  await ensureTable();
  const userId = getUserId(req);
  if (!(await isAdmin(userId))) { res.status(403).json({ error: "관리자 전용" }); return; }

  const { reply } = req.body as { reply?: string };
  if (!reply || reply.trim().length < 1) {
    res.status(400).json({ error: "답변 내용을 입력해주세요." });
    return;
  }

  try {
    await q(
      `UPDATE support_inquiries SET admin_reply = $1, status = 'replied', replied_at = NOW() WHERE id = $2`,
      [reply.trim(), req.params.id]
    );
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: "답변 저장 중 오류가 발생했습니다." });
  }
});

// PATCH /api/support/inquiry/:id/status — 상태 변경
router.patch("/support/inquiry/:id/status", async (req, res) => {
  await ensureTable();
  const userId = getUserId(req);
  if (!(await isAdmin(userId))) { res.status(403).json({ error: "관리자 전용" }); return; }

  const { status } = req.body as { status?: string };
  const allowed = ["open", "replied", "closed"];
  if (!status || !allowed.includes(status)) {
    res.status(400).json({ error: "유효하지 않은 상태입니다." });
    return;
  }

  try {
    await q(`UPDATE support_inquiries SET status = $1 WHERE id = $2`, [status, req.params.id]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: "상태 변경 중 오류가 발생했습니다." });
  }
});

// DELETE /api/support/inquiry/:id — 어드민 삭제
router.delete("/support/inquiry/:id", async (req, res) => {
  await ensureTable();
  const userId = getUserId(req);
  if (!(await isAdmin(userId))) { res.status(403).json({ error: "관리자 전용" }); return; }

  try {
    await q(`DELETE FROM support_inquiries WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: "삭제 중 오류가 발생했습니다." });
  }
});

export default router;

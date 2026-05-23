import { Router } from "express";
import { pool } from "@workspace/db";
import { getUserId } from "../lib/credits.js";

const router = Router();

async function q(sql: string, params: any[] = []) {
  const client = await pool.connect();
  try { return (await client.query(sql, params)).rows; }
  finally { client.release(); }
}

async function isAdmin(userId: string | null): Promise<boolean> {
  if (!userId) return false;
  return (await q(`SELECT 1 FROM admins WHERE user_id = $1 LIMIT 1`, [userId])).length > 0;
}

async function ensureTable() {
  await q(`
    CREATE TABLE IF NOT EXISTS macro_reports (
      id          SERIAL PRIMARY KEY,
      title       TEXT NOT NULL,
      category    TEXT NOT NULL DEFAULT '기타',
      summary     TEXT,
      content     TEXT NOT NULL,
      is_published BOOLEAN NOT NULL DEFAULT true,
      created_at  TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at  TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `);
}

// GET /api/macro-reports — 공개 목록 조회
router.get("/macro-reports", async (req, res) => {
  await ensureTable();
  const { category } = req.query as { category?: string };
  try {
    const where = category && category !== "전체"
      ? `WHERE is_published = true AND category = $1`
      : `WHERE is_published = true`;
    const params = category && category !== "전체" ? [category] : [];
    const rows = await q(
      `SELECT id, title, category, summary, created_at, updated_at FROM macro_reports ${where} ORDER BY created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// GET /api/macro-reports/:id — 단건 전체 조회
router.get("/macro-reports/:id", async (req, res) => {
  await ensureTable();
  try {
    const rows = await q(`SELECT * FROM macro_reports WHERE id = $1 AND is_published = true LIMIT 1`, [req.params.id]);
    if (!rows[0]) { res.status(404).json({ error: "not found" }); return; }
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// POST /api/admin/macro-reports — 보고서 작성 (관리자)
router.post("/admin/macro-reports", async (req, res) => {
  await ensureTable();
  const userId = getUserId(req);
  if (!(await isAdmin(userId))) { res.status(403).json({ error: "관리자 전용" }); return; }

  const { title, category = "기타", summary = "", content, is_published = true } = req.body as {
    title?: string; category?: string; summary?: string; content?: string; is_published?: boolean;
  };
  if (!title?.trim() || !content?.trim()) {
    res.status(400).json({ error: "제목과 본문을 입력해주세요." }); return;
  }
  try {
    const rows = await q(
      `INSERT INTO macro_reports (title, category, summary, content, is_published) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [title.trim(), category, summary?.trim() ?? "", content.trim(), !!is_published]
    );
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// PATCH /api/admin/macro-reports/:id — 보고서 수정 (관리자)
router.patch("/admin/macro-reports/:id", async (req, res) => {
  await ensureTable();
  const userId = getUserId(req);
  if (!(await isAdmin(userId))) { res.status(403).json({ error: "관리자 전용" }); return; }

  const { title, category, summary, content, is_published } = req.body as {
    title?: string; category?: string; summary?: string; content?: string; is_published?: boolean;
  };
  try {
    const rows = await q(
      `UPDATE macro_reports SET
        title        = COALESCE($1, title),
        category     = COALESCE($2, category),
        summary      = COALESCE($3, summary),
        content      = COALESCE($4, content),
        is_published = COALESCE($5, is_published),
        updated_at   = NOW()
       WHERE id = $6 RETURNING *`,
      [title?.trim() ?? null, category ?? null, summary?.trim() ?? null, content?.trim() ?? null, is_published ?? null, req.params.id]
    );
    if (!rows[0]) { res.status(404).json({ error: "not found" }); return; }
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// DELETE /api/admin/macro-reports/:id — 보고서 삭제 (관리자)
router.delete("/admin/macro-reports/:id", async (req, res) => {
  await ensureTable();
  const userId = getUserId(req);
  if (!(await isAdmin(userId))) { res.status(403).json({ error: "관리자 전용" }); return; }
  try {
    await q(`DELETE FROM macro_reports WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

export default router;

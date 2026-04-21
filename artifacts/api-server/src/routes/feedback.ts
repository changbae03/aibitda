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

export default router;

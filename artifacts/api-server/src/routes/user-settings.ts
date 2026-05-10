import { Router } from "express";
import { pool } from "@workspace/db";
import { getUserId } from "../lib/credits.js";

const router = Router();

router.get("/user/settings", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.json({ language: "ko" });
    return;
  }
  try {
    const result = await pool.query(
      `SELECT language FROM user_settings WHERE user_id = $1`,
      [userId]
    );
    const language = result.rows[0]?.language ?? "ko";
    res.json({ language });
  } catch {
    res.json({ language: "ko" });
  }
});

router.put("/user/settings", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "로그인이 필요합니다" });
    return;
  }
  const { language } = req.body as { language?: string };
  if (!language || !["ko", "en"].includes(language)) {
    res.status(400).json({ error: "language must be 'ko' or 'en'" });
    return;
  }
  try {
    await pool.query(
      `INSERT INTO user_settings (user_id, language, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id) DO UPDATE SET language = $2, updated_at = NOW()`,
      [userId, language]
    );
    res.json({ ok: true, language });
  } catch (err: any) {
    res.status(500).json({ error: "설정 저장 실패", detail: err?.message });
  }
});

export default router;

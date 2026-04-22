import { Router } from "express";
import {
  getUserId,
  getCreditStatus,
  getOrCreateReferralCode,
  registerReferral,
} from "../lib/credits.js";
import { pool } from "@workspace/db";

const router = Router();

router.get("/credits", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    return res.status(401).json({ error: "로그인이 필요합니다" });
  }
  const status = await getCreditStatus(userId);
  res.json(status);
});

router.post("/credits/referral/code", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    return res.status(401).json({ error: "로그인이 필요합니다" });
  }
  const code = await getOrCreateReferralCode(userId);
  res.json({ code });
});

router.post("/credits/referral/register", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    return res.status(401).json({ error: "로그인이 필요합니다" });
  }
  const { code } = req.body as { code?: string };
  if (!code) {
    return res.status(400).json({ error: "code 필드가 필요합니다" });
  }
  const result = await registerReferral(userId, code);
  res.json(result);
});

// GET /api/profile — 내 프로필 조회 (display_name)
router.get("/profile", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: "로그인이 필요합니다" });
  const { rows } = await pool.query(
    `SELECT display_name FROM user_credits WHERE user_id = $1`,
    [userId]
  );
  res.json({ displayName: rows[0]?.display_name ?? null });
});

// PATCH /api/profile — 닉네임(display_name) 저장
router.patch("/profile", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: "로그인이 필요합니다" });
  const { displayName } = req.body as { displayName?: string };
  const trimmed = displayName?.trim() ?? "";
  if (trimmed.length > 20) {
    return res.status(400).json({ error: "닉네임은 20자 이내여야 합니다" });
  }
  await pool.query(
    `UPDATE user_credits SET display_name = $1 WHERE user_id = $2`,
    [trimmed || null, userId]
  );
  res.json({ ok: true, displayName: trimmed || null });
});

export default router;

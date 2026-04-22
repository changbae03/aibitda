import { Router } from "express";
import cookie from "cookie";
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

// DELETE /api/profile/account — 계정 탈퇴
router.delete("/profile/account", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: "로그인이 필요합니다" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 분석 관련 데이터 삭제
    const { rows: analyses } = await client.query(
      `SELECT id FROM analyses WHERE user_id = $1`,
      [userId]
    );
    for (const row of analyses) {
      await client.query(`DELETE FROM analysis_steps WHERE analysis_id = $1`, [row.id]);
      await client.query(`DELETE FROM model_insights WHERE analysis_id = $1`, [row.id]);
    }
    await client.query(`DELETE FROM analyses WHERE user_id = $1`, [userId]);

    // 추천인 기록 삭제
    await client.query(`DELETE FROM referral_uses WHERE referrer_id = $1 OR referred_id = $1`, [userId]);
    await client.query(`DELETE FROM referral_codes WHERE user_id = $1`, [userId]);

    // 크레딧 / 유저 정보 삭제
    await client.query(`DELETE FROM user_credits WHERE user_id = $1`, [userId]);

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }

  // 쿠키 삭제 (로그아웃)
  res.setHeader("Set-Cookie", cookie.serialize("auth_token", "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
  }));
  res.json({ ok: true });
});

export default router;

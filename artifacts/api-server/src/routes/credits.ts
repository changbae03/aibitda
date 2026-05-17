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

// ─── POST /credits/promo ─── 프로모 코드 적용 ─────────────────────────────
router.post("/credits/promo", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: "로그인이 필요합니다" });
  const { code } = req.body as { code?: string };
  if (!code?.trim()) return res.status(400).json({ error: "코드를 입력하세요" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const normalized = code.trim().toUpperCase();
    const { rows: pc } = await client.query(
      `SELECT * FROM promo_codes WHERE code = $1 AND enabled = true`, [normalized]
    );
    if (!pc[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "유효하지 않거나 만료된 코드입니다" });
    }
    const promo = pc[0];
    if (promo.expires_at && new Date(promo.expires_at) < new Date()) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "기간이 만료된 코드입니다" });
    }
    if (promo.max_uses !== null && promo.uses_count >= promo.max_uses) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "사용 한도가 초과된 코드입니다" });
    }
    // 중복 사용 체크
    const { rows: used } = await client.query(
      `SELECT 1 FROM promo_code_uses WHERE code = $1 AND user_id = $2`, [normalized, userId]
    );
    if (used.length > 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "이미 사용한 코드입니다" });
    }
    // 크레딧 지급
    if (promo.credit_amount > 0) {
      await client.query(
        `UPDATE user_credits SET bonus_credits = bonus_credits + $1 WHERE user_id = $2`,
        [promo.credit_amount, userId]
      );
    }
    // 등급 업그레이드
    if (promo.tier_upgrade) {
      await client.query(
        `UPDATE user_credits SET tier = $1, daily_limit = CASE $1 WHEN 'premium' THEN 50 WHEN 'beta' THEN 10 ELSE daily_limit END WHERE user_id = $2`,
        [promo.tier_upgrade, userId]
      );
    }
    // 사용 기록
    await client.query(
      `INSERT INTO promo_code_uses (code, user_id) VALUES ($1, $2)`, [normalized, userId]
    );
    await client.query(
      `UPDATE promo_codes SET uses_count = uses_count + 1 WHERE code = $1`, [normalized]
    );
    await client.query("COMMIT");
    res.json({
      ok: true,
      creditAmount: promo.credit_amount,
      tierUpgrade: promo.tier_upgrade,
      message: `코드가 적용됐습니다! ${promo.credit_amount > 0 ? `크레딧 ${promo.credit_amount}개 지급` : ""}${promo.tier_upgrade ? ` · ${promo.tier_upgrade} 등급으로 업그레이드` : ""}`.trim(),
    });
  } catch (err: any) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err?.message ?? "오류 발생" });
  } finally {
    client.release();
  }
});

// ─── POST /credits/share ─── 카카오톡 공유 크레딧 (하루 1회) ─────────────────
router.post("/credits/share", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: "로그인이 필요합니다" });

  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const today = kst.toISOString().slice(0, 10);

  const { rows } = await pool.query(
    `SELECT share_credit_date FROM user_credits WHERE user_id = $1`,
    [userId]
  );
  if (!rows[0]) return res.status(404).json({ error: "유저를 찾을 수 없습니다" });

  if (rows[0].share_credit_date === today) {
    return res.json({ ok: true, credited: false, alreadyUsed: true });
  }

  await pool.query(
    `UPDATE user_credits SET bonus_credits = bonus_credits + 1, share_credit_date = $1 WHERE user_id = $2`,
    [today, userId]
  );

  res.json({ ok: true, credited: true });
});

export default router;

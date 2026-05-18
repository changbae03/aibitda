import { Router } from "express";
import cookie from "cookie";
import jwt from "jsonwebtoken";
import {
  getUserId,
  getCreditStatus,
  getOrCreateCredits,
  getOrCreateReferralCode,
  registerReferral,
} from "../lib/credits.js";
import { pool } from "@workspace/db";

const JWT_SECRET = process.env.JWT_SECRET || "cbst-ai-research-secret-2024";

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

// ─── POST /credits/share ─── 카카오톡 공유 크레딧 — 대기 등록 (하루 1회) ────
// 즉시 크레딧을 주지 않고 share_pending_analysis_id 에 저장.
// 다른 사람이 /share/:id 를 열었을 때 POST /credits/share/viewed 에서 지급.
router.post("/credits/share", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: "로그인이 필요합니다" });

  const { analysisId } = req.body as { analysisId?: number };
  if (!analysisId) return res.status(400).json({ error: "analysisId가 필요합니다" });

  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const today = kst.toISOString().slice(0, 10);

  const { rows } = await pool.query(
    `SELECT share_credit_date FROM user_credits WHERE user_id = $1`,
    [userId]
  );
  if (!rows[0]) return res.status(404).json({ error: "유저를 찾을 수 없습니다" });

  if (rows[0].share_credit_date === today) {
    return res.json({ ok: true, registered: false, alreadyUsed: true });
  }

  // 대기 상태 저장 (기존 pending 덮어쓰기)
  await pool.query(
    `UPDATE user_credits SET share_pending_analysis_id = $1, share_pending_at = NOW() WHERE user_id = $2`,
    [analysisId, userId]
  );

  res.json({ ok: true, registered: true });
});

// ─── POST /credits/share/viewed ─── 공유 링크 열림 감지 → 크레딧 지급 ──────
// share.tsx 페이지 마운트 시 호출.
// 뷰어가 공유자와 다른 사람이면 공유자에게 크레딧 +1 지급.
router.post("/credits/share/viewed", async (req, res) => {
  const viewerUserId = getUserId(req); // 비로그인이면 null
  const { analysisId } = req.body as { analysisId?: number };
  if (!analysisId) return res.status(400).json({ error: "analysisId가 필요합니다" });

  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const today = kst.toISOString().slice(0, 10);

  // 이 analysisId 로 pending 중인 공유자 조회
  // — 뷰어가 로그인 상태면 공유자와 다른 사람인지 확인
  // — 7일 이내 pending 만 유효
  const { rows } = await pool.query(
    `SELECT user_id, share_credit_date FROM user_credits
     WHERE share_pending_analysis_id = $1
       AND ($2::text IS NULL OR user_id != $2)
       AND share_pending_at > NOW() - INTERVAL '7 days'
     LIMIT 1`,
    [analysisId, viewerUserId ?? null]
  );

  if (!rows[0]) return res.json({ ok: true, credited: false });

  const sharer = rows[0];

  // 오늘 이미 크레딧 받은 경우 패스
  if (sharer.share_credit_date === today) {
    // pending 은 유지 (다음 날 다른 뷰어가 열면 받을 수 있음)
    return res.json({ ok: true, credited: false });
  }

  // 크레딧 지급 + pending 초기화
  await pool.query(
    `UPDATE user_credits
     SET bonus_credits = bonus_credits + 1,
         share_credit_date = $1,
         share_pending_analysis_id = NULL,
         share_pending_at = NULL
     WHERE user_id = $2`,
    [today, sharer.user_id]
  );

  console.log(`[share-credit] +1 → ${sharer.user_id} | analysis=${analysisId} | viewer=${viewerUserId ?? "anonymous"}`);
  return res.json({ ok: true, credited: true });
});

// GET /api/mypage — 마이페이지 통합 데이터
router.get("/mypage", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: "로그인이 필요합니다" });

  // JWT에서 카카오 프로필 정보 추출
  const cookies = cookie.parse(req.headers.cookie || "");
  const token = cookies.auth_token;
  let jwtUser: any = null;
  if (token) {
    try { jwtUser = jwt.verify(token, JWT_SECRET) as any; } catch {}
  }

  const [row, dbRes] = await Promise.all([
    getOrCreateCredits(userId),
    pool.query(
      `SELECT tier, total_analyses, created_at, display_name, email
       FROM user_credits WHERE user_id = $1`,
      [userId]
    ),
  ]);
  const db = dbRes.rows[0] ?? {};
  const dailyRemaining = Math.max(0, row.daily_limit - row.daily_used);

  // 단기 ID (마지막 6자 표시용)
  const shortId = userId.replace(/^kakao_/, "").replace(/^clerk_/, "").slice(-8).toUpperCase();

  res.json({
    user: {
      id:            shortId,
      fullId:        userId,
      nickname:      db.display_name || jwtUser?.nickname || "사용자",
      profileImage:  jwtUser?.profileImage ?? null,
      email:         db.email || jwtUser?.email || null,
      loginProvider: userId.startsWith("kakao_") ? "kakao" : "clerk",
    },
    credits: {
      dailyUsed:      row.daily_used,
      dailyLimit:     row.daily_limit,
      bonusCredits:   row.bonus_credits,
      remaining:      dailyRemaining + row.bonus_credits,
      tier:           db.tier ?? "free",
      totalAnalyses:  db.total_analyses ?? 0,
      joinedAt:       db.created_at ?? null,
      referralCode:   row.referral_code ?? null,
    },
  });
});

export default router;

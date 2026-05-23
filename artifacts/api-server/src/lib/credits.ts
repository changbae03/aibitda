import { pool } from "@workspace/db";
import jwt from "jsonwebtoken";
import cookie from "cookie";
import { getAuth } from "@clerk/express";
import type { Request } from "express";

const JWT_SECRET = process.env.JWT_SECRET || "dev-only-insecure-fallback-DO-NOT-USE-IN-PROD";

function getTodayKST(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function randomCode(len = 8): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < len; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export function getUserId(req: Request): string | null {
  const cookies = cookie.parse(req.headers.cookie || "");
  const token = cookies.auth_token;
  if (token) {
    try {
      const user = jwt.verify(token, JWT_SECRET) as any;
      if (user?.id) return `kakao_${user.id}`;
    } catch {}
  }
  try {
    const { userId } = getAuth(req as any);
    if (userId) return `clerk_${userId}`;
  } catch {}
  return null;
}

export async function getOrCreateCredits(userId: string) {
  const today = getTodayKST();
  const client = await pool.connect();
  try {
    // 신규 가입 시 10크레딧 지급 (bonus_credits = 10)
    await client.query(
      `INSERT INTO user_credits (user_id, daily_reset_date, bonus_credits)
       VALUES ($1, $2, 10)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId, today]
    );
    const res = await client.query(
      `SELECT * FROM user_credits WHERE user_id = $1`,
      [userId]
    );
    let row = res.rows[0];
    if (row.daily_reset_date !== today) {
      const upd = await client.query(
        `UPDATE user_credits SET daily_used = 0, daily_reset_date = $1 WHERE user_id = $2 RETURNING *`,
        [today, userId]
      );
      row = upd.rows[0];
    }
    return row;
  } finally {
    client.release();
  }
}

export interface CreditStatus {
  dailyUsed: number;
  dailyLimit: number;
  bonusCredits: number;
  remaining: number;
  referralCode: string | null;
}

export async function getCreditStatus(userId: string): Promise<CreditStatus> {
  const row = await getOrCreateCredits(userId);
  const dailyRemaining = Math.max(0, row.daily_limit - row.daily_used);
  const total = dailyRemaining + row.bonus_credits;
  return {
    dailyUsed: row.daily_used,
    dailyLimit: row.daily_limit,
    bonusCredits: row.bonus_credits,
    remaining: total,
    referralCode: row.referral_code ?? null,
  };
}

export async function checkAndDeductCredit(userId: string): Promise<{ ok: boolean; reason?: string }> {
  const row = await getOrCreateCredits(userId);
  const dailyRemaining = row.daily_limit - row.daily_used;

  const client = await pool.connect();
  try {
    if (dailyRemaining > 0) {
      await client.query(
        `UPDATE user_credits SET daily_used = daily_used + 1, total_analyses = total_analyses + 1 WHERE user_id = $1`,
        [userId]
      );
      return { ok: true };
    } else if (row.bonus_credits > 0) {
      await client.query(
        `UPDATE user_credits SET bonus_credits = bonus_credits - 1, total_analyses = total_analyses + 1 WHERE user_id = $1`,
        [userId]
      );
      return { ok: true };
    } else {
      return { ok: false, reason: "오늘 크레딧이 모두 소진됐습니다. 내일 다시 이용해주세요." };
    }
  } finally {
    client.release();
  }
}

export async function getOrCreateReferralCode(userId: string): Promise<string> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT referral_code FROM user_credits WHERE user_id = $1`,
      [userId]
    );
    const existing = res.rows[0]?.referral_code;
    if (existing) return existing;

    let code = randomCode();
    let attempts = 0;
    while (attempts < 10) {
      const check = await client.query(
        `SELECT 1 FROM user_credits WHERE referral_code = $1`,
        [code]
      );
      if (check.rows.length === 0) break;
      code = randomCode();
      attempts++;
    }

    await client.query(
      `UPDATE user_credits SET referral_code = $1 WHERE user_id = $2`,
      [code, userId]
    );
    return code;
  } finally {
    client.release();
  }
}

export async function registerReferral(refereeId: string, code: string): Promise<{ success: boolean; message: string }> {
  const client = await pool.connect();
  try {
    const refCheck = await client.query(
      `SELECT 1 FROM referral_uses WHERE referee_id = $1`,
      [refereeId]
    );
    if (refCheck.rows.length > 0) {
      return { success: false, message: "이미 추천인 코드를 사용했습니다." };
    }

    const referrerRes = await client.query(
      `SELECT user_id FROM user_credits WHERE referral_code = $1`,
      [code]
    );
    if (referrerRes.rows.length === 0) {
      return { success: false, message: "유효하지 않은 추천 코드입니다." };
    }
    const referrerId = referrerRes.rows[0].user_id;
    if (referrerId === refereeId) {
      return { success: false, message: "본인의 추천 코드는 사용할 수 없습니다." };
    }

    await client.query(
      `INSERT INTO referral_uses (referral_code, referee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [code, refereeId]
    );
    await client.query(
      `UPDATE user_credits SET bonus_credits = bonus_credits + 1 WHERE user_id = $1`,
      [referrerId]
    );

    return { success: true, message: "추천인에게 보너스 크레딧이 지급됐습니다." };
  } finally {
    client.release();
  }
}

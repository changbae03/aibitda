import { Router } from "express";
import jwt from "jsonwebtoken";
import cookie from "cookie";
import { pool } from "@workspace/db";

const router = Router();

const KAKAO_REST_API_KEY = process.env.KAKAO_REST_API_KEY ?? "";
const KAKAO_CLIENT_SECRET = process.env.KAKAO_CLIENT_SECRET ?? "";
const JWT_SECRET = process.env.JWT_SECRET || "cbst-ai-research-secret-2024";

// ── 서버 시작 시 환경변수 로드 확인 ──────────────────────────────────────────
console.log("[Kakao] module loaded");
console.log("[Kakao] KAKAO_REST_API_KEY set:", !!KAKAO_REST_API_KEY);
console.log("[Kakao] KAKAO_REST_API_KEY length:", KAKAO_REST_API_KEY.length);
console.log("[Kakao] KAKAO_REST_API_KEY prefix:", KAKAO_REST_API_KEY.slice(0, 6) || "(empty)");
console.log("[Kakao] KAKAO_CLIENT_SECRET set:", !!KAKAO_CLIENT_SECRET);
console.log("[Kakao] KAKAO_REDIRECT_URI:", process.env.KAKAO_REDIRECT_URI ?? "(not set, will auto-detect)");

// 환경변수로 redirect_uri 고정 (프록시 헤더 불일치 방지)
function getRedirectUri(req: any): string {
  if (process.env.KAKAO_REDIRECT_URI) {
    return process.env.KAKAO_REDIRECT_URI;
  }
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  const host = req.headers["x-forwarded-host"] || req.get("host");
  const uri = `${proto}://${host}/api/auth/kakao/callback`;
  console.log("[Kakao] redirect_uri (auto):", uri);
  return uri;
}

router.get("/auth/kakao", (req, res) => {
  const redirectUri = getRedirectUri(req);
  console.log("[Kakao] /auth/kakao → redirect_uri:", redirectUri);
  console.log("[Kakao] API key prefix:", KAKAO_REST_API_KEY?.slice(0, 6) + "...");
  const url = `https://kauth.kakao.com/oauth/authorize?client_id=${KAKAO_REST_API_KEY}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code`;
  res.redirect(url);
});

router.get("/auth/kakao/callback", async (req, res) => {
  const { code, error, error_description } = req.query;

  if (error) {
    console.error("[Kakao] callback error from Kakao:", error, error_description);
    return res.status(400).send(`카카오 인증 실패: ${error_description ?? error}`);
  }

  if (!code) {
    return res.status(400).send("카카오 로그인 실패: code 없음");
  }

  const redirectUri = getRedirectUri(req);
  console.log("[Kakao] /auth/kakao/callback → redirect_uri:", redirectUri);
  console.log("[Kakao] API key prefix:", KAKAO_REST_API_KEY?.slice(0, 6) + "...");

  try {
    const params = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: KAKAO_REST_API_KEY,
      redirect_uri: redirectUri,
      code: code as string,
      ...(KAKAO_CLIENT_SECRET ? { client_secret: KAKAO_CLIENT_SECRET } : {}),
    });

    console.log("[Kakao] token request params:", {
      grant_type: "authorization_code",
      client_id: KAKAO_REST_API_KEY?.slice(0, 6) + "...",
      redirect_uri: redirectUri,
      code: (code as string).slice(0, 8) + "...",
      client_secret: KAKAO_CLIENT_SECRET ? "[set]" : "[not set]",
    });

    const tokenRes = await fetch("https://kauth.kakao.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });

    const tokenData = await tokenRes.json() as any;

    if (!tokenData.access_token) {
      console.error("[Kakao] token error full response:", JSON.stringify(tokenData));
      console.error("[Kakao] token request status:", tokenRes.status);
      return res.status(400).send(`카카오 토큰 발급 실패: ${tokenData.error_description ?? tokenData.error ?? "unknown"}`);
    }

    const userRes = await fetch("https://kapi.kakao.com/v2/user/me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const userData = await userRes.json() as any;

    const user = {
      id: String(userData.id),
      nickname: userData.kakao_account?.profile?.nickname || "사용자",
      profileImage: userData.kakao_account?.profile?.profile_image_url || null,
      email: userData.kakao_account?.email || null,
    };

    const token = jwt.sign(user, JWT_SECRET, { expiresIn: "30d" });

    const proto = req.headers["x-forwarded-proto"] || req.protocol;
    const host = req.headers["x-forwarded-host"] || req.get("host");

    // 프론트엔드 URL 결정: KAKAO_REDIRECT_URI origin > FRONTEND_URL > 요청 헤더 순서로 우선
    // 배포 환경에서 x-forwarded-host가 내부 API 호스트로 오는 경우 방지
    const kakaoRedirectUri = process.env.KAKAO_REDIRECT_URI;
    const frontendOrigin =
      process.env.FRONTEND_URL?.trim() ||
      (kakaoRedirectUri ? new URL(kakaoRedirectUri).origin : null) ||
      `${proto}://${host}`;

    console.log("[Kakao] headers x-forwarded-host:", req.headers["x-forwarded-host"]);
    console.log("[Kakao] headers host:", req.get("host"));
    console.log("[Kakao] resolved frontendOrigin:", frontendOrigin);

    const isSecure = proto === "https" || frontendOrigin.startsWith("https://");

    res.setHeader("Set-Cookie", cookie.serialize("auth_token", token, {
      httpOnly: true,
      secure: isSecure,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
    }));

    // 카카오 닉네임·이메일 → user_credits 저장 (kakao_ 접두사로 통일)
    // getUserId()도 kakao_${id} 형식을 반환하므로 동일한 키를 사용해야 중복 방지
    const prefixedUserId = `kakao_${user.id}`;
    try {
      await pool.query(
        `INSERT INTO user_credits (user_id, display_name, email, last_login_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (user_id) DO UPDATE
           SET display_name = COALESCE(user_credits.display_name, EXCLUDED.display_name),
               email = COALESCE(user_credits.email, EXCLUDED.email),
               last_login_at = NOW()`,
        [prefixedUserId, user.nickname || null, user.email || null]
      );
    } catch (_) {}

    console.log("[Kakao] login success, user:", user.id, user.nickname);
    console.log("[Kakao] redirecting to:", `${frontendOrigin}/`);
    res.redirect(`${frontendOrigin}/`);
  } catch (err) {
    console.error("[Kakao] callback exception:", err);
    res.status(500).send("카카오 로그인 처리 중 오류 발생");
  }
});

router.get("/auth/me", async (req, res) => {
  const cookies = cookie.parse(req.headers.cookie || "");
  const token = cookies.auth_token;
  if (!token) {
    return res.json({ user: null });
  }
  try {
    const user = jwt.verify(token, JWT_SECRET) as Record<string, any>;
    const { rows } = await pool.query(
      `SELECT display_name FROM user_credits WHERE user_id = $1`,
      [`kakao_${user.id}`]
    ).catch(() => ({ rows: [] }));
    const displayName = rows[0]?.display_name ?? null;
    res.json({ user: { ...user, displayName } });
  } catch {
    res.json({ user: null });
  }
});

router.post("/auth/logout", (req, res) => {
  res.setHeader("Set-Cookie", cookie.serialize("auth_token", "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
  }));
  res.json({ success: true });
});

// ── 개발 환경 전용 테스트 로그인 ────────────────────────────────────────────
if (process.env.NODE_ENV !== "production") {
  router.post("/auth/dev-login", async (req, res) => {
    const devUser = {
      id: "dev_preview",
      nickname: "미리보기 계정",
      profileImage: null,
      email: "dev@aibitda.kr",
    };
    const token = jwt.sign(devUser, JWT_SECRET, { expiresIn: "7d" });

    // user_credits 행 생성 (없으면 insert)
    try {
      await pool.query(
        `INSERT INTO user_credits (user_id, display_name, email, daily_limit)
         VALUES ($1, $2, $3, 99)
         ON CONFLICT (user_id) DO UPDATE SET daily_limit = 99`,
        [`kakao_${devUser.id}`, devUser.nickname, devUser.email]
      );
    } catch (_) {}

    const proto = req.headers["x-forwarded-proto"] || req.protocol;
    const isSecure = proto === "https";

    res.setHeader("Set-Cookie", cookie.serialize("auth_token", token, {
      httpOnly: true,
      secure: isSecure,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7,
      path: "/",
    }));
    res.json({ success: true, user: devUser });
  });
}

export default router;

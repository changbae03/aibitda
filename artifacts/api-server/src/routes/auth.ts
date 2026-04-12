import { Router } from "express";
import jwt from "jsonwebtoken";
import cookie from "cookie";

const router = Router();

const KAKAO_REST_API_KEY = process.env.KAKAO_REST_API_KEY!;
const JWT_SECRET = process.env.JWT_SECRET || "cbst-ai-research-secret-2024";

function getRedirectUri(req: any) {
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return `${proto}://${host}/api/auth/kakao/callback`;
}

router.get("/auth/kakao", (req, res) => {
  const redirectUri = getRedirectUri(req);
  const url = `https://kauth.kakao.com/oauth/authorize?client_id=${KAKAO_REST_API_KEY}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code`;
  res.redirect(url);
});

router.get("/auth/kakao/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) {
    return res.status(400).send("카카오 로그인 실패: code 없음");
  }

  const redirectUri = getRedirectUri(req);

  try {
    const tokenRes = await fetch("https://kauth.kakao.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: KAKAO_REST_API_KEY,
        redirect_uri: redirectUri,
        code: code as string,
      }),
    });

    const tokenData = await tokenRes.json() as any;
    if (!tokenData.access_token) {
      console.error("Kakao token error:", tokenData);
      return res.status(400).send("카카오 토큰 발급 실패");
    }

    const userRes = await fetch("https://kapi.kakao.com/v2/user/me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const userData = await userRes.json() as any;

    const user = {
      id: String(userData.id),
      nickname: userData.kakao_account?.profile?.nickname || "사용자",
      profileImage: userData.kakao_account?.profile?.profile_image_url || null,
    };

    const token = jwt.sign(user, JWT_SECRET, { expiresIn: "7d" });

    const proto = req.headers["x-forwarded-proto"] || req.protocol;
    const host = req.headers["x-forwarded-host"] || req.get("host");
    const baseUrl = `${proto}://${host}`;

    res.setHeader("Set-Cookie", cookie.serialize("auth_token", token, {
      httpOnly: true,
      secure: proto === "https",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7,
      path: "/",
    }));

    res.redirect(`${baseUrl}/`);
  } catch (err) {
    console.error("Kakao callback error:", err);
    res.status(500).send("카카오 로그인 처리 중 오류 발생");
  }
});

router.get("/auth/me", (req, res) => {
  const cookies = cookie.parse(req.headers.cookie || "");
  const token = cookies.auth_token;
  if (!token) {
    return res.json({ user: null });
  }
  try {
    const user = jwt.verify(token, JWT_SECRET);
    res.json({ user });
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

export default router;

import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { clerkMiddleware } from "@clerk/express";
import { CLERK_PROXY_PATH, clerkProxyMiddleware } from "./middlewares/clerkProxyMiddleware";
import router from "./routes";
import marketAnalysisRouter from "./routes/market-analysis.js";
import fs from "fs";
import path from "path";
import { pool } from "@workspace/db";
import { generateOgPng, type OgImageData } from "./lib/og-image";

const app: Express = express();

// ─── 신뢰할 수 있는 프록시 ────────────────────────────────────────────────
app.set("trust proxy", 1);

// ─── 보안 헤더 (Helmet) ───────────────────────────────────────────────────
// 전체 앱: HSTS 등 기본 보안 헤더 적용, CSP는 API 라우트에만 적용
app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: false,   // SPA(Clerk·Kakao iFrame 등) 호환을 위해 글로벌 CSP 비활성화
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
  })
);
// API 라우트 전용 엄격한 CSP (프론트엔드 SPA에는 미적용, JSON 응답이므로 unsafe-inline 불필요)
app.use(
  "/api",
  helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        scriptSrc: ["'none'"],
        styleSrc: ["'none'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
    hsts: false,  // 전체 앱 HSTS에서 이미 적용
  })
);

// ─── Permissions-Policy 헤더 (불필요한 브라우저 기능 차단) ──────────────────
app.use((_req, res, next) => {
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()"
  );
  next();
});

// ─── CORS ────────────────────────────────────────────────────────────────
const ALLOWED_ORIGIN_PATTERNS: RegExp[] = [
  /^https?:\/\/localhost(:\d+)?$/,
  /\.replit\.dev$/,
  /\.replit\.app$/,
  /\.riker\.replit\.dev$/,
  /\.worf\.replit\.dev$/,
  /^https:\/\/[\w-]+\.repl\.co$/,
  /^https:\/\/(www\.)?aibitda\.kr$/,
];

app.use(
  cors({
    credentials: true,
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const allowed = ALLOWED_ORIGIN_PATTERNS.some((re) => re.test(origin));
      if (allowed) return callback(null, true);
      callback(new Error(`CORS: origin not allowed — ${origin}`));
    },
  })
);

// ─── Rate Limiting ────────────────────────────────────────────────────────
const isDev = process.env.NODE_ENV === "development";

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "요청이 너무 많습니다. 잠시 후 다시 시도하세요." },
  skip: (req) => isDev || req.path.startsWith("/api/clerk"),
});

const analysisLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "분석 요청이 너무 많습니다. 5분 후 다시 시도하세요." },
  skip: (req) => isDev || req.method !== "POST",
  // Clerk 사용자 ID 기반으로 키 설정 — 프록시 환경에서 IP 공유 문제 방지
  keyGenerator: (req) => {
    const auth = (req as any).auth;
    const userId = auth?.userId ?? auth?.user?.id;
    if (userId) return `user:${userId}`;
    return ipKeyGenerator(req);
  },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "인증 요청이 너무 많습니다. 잠시 후 다시 시도하세요." },
  skip: () => isDev,
});

const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "관리자 API 요청이 너무 많습니다." },
  skip: () => isDev,
});

// ─── 헬스체크 (Clerk·Rate-limit 미들웨어 이전 등록) ──────────────────────────
// Cloud Run 시작 프로브가 /api/healthz에 도달해야 배포가 성공함.
// clerkMiddleware()가 JWK 네트워크 호출로 block되는 경우를 방지.
app.get("/api/healthz", (_req, res) => res.json({ status: "ok" }));

// ─── 기본 미들웨어 ─────────────────────────────────────────────────────────
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

app.use(clerkMiddleware());

// ─── Rate limit 적용 ──────────────────────────────────────────────────────
app.use("/api", generalLimiter);
app.use("/api/auth", authLimiter);
app.use("/api/analysis", analysisLimiter);
app.use("/api/admin", adminLimiter);

// ── 시장분석 라우터 직접 마운트 (별도 프로세스 없이 메인 서버에 통합) ─────────
app.use("/api/market-analysis", marketAnalysisRouter);

app.use("/api", router);

// ─── OG 이미지 캐시 ────────────────────────────────────────────────────────
const SHARE_OG_IMAGE_STATIC = "https://aibitda.kr/share-og.png";
const ogImageCache = new Map<number, { png: Buffer; ts: number }>();
const OG_CACHE_TTL = 1000 * 60 * 60 * 24; // 24시간
const OG_CACHE_MAX = 200; // 최대 항목 수 (메모리 누수 방지)

// 만료·초과 항목 주기적 정리 (1시간마다)
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of ogImageCache) {
    if (now - entry.ts > OG_CACHE_TTL) ogImageCache.delete(id);
  }
  // 최대 항목 초과 시 가장 오래된 것부터 삭제
  if (ogImageCache.size > OG_CACHE_MAX) {
    const sorted = [...ogImageCache.entries()].sort((a, b) => a[1].ts - b[1].ts);
    for (const [id] of sorted.slice(0, ogImageCache.size - OG_CACHE_MAX)) {
      ogImageCache.delete(id);
    }
  }
}, 1000 * 60 * 60).unref();

let _staticOgPng: Buffer | null = null;
async function getStaticOgPng(): Promise<Buffer | null> {
  if (_staticOgPng) return _staticOgPng;
  try {
    const res = await fetch(SHARE_OG_IMAGE_STATIC);
    if (!res.ok) return null;
    _staticOgPng = Buffer.from(await res.arrayBuffer());
    return _staticOgPng;
  } catch { return null; }
}

// ─── 동적 OG 이미지 엔드포인트 ─────────────────────────────────────────────
app.get("/api/og/:id", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).end(); return; }

  const cached = ogImageCache.get(id);
  if (cached && Date.now() - cached.ts < OG_CACHE_TTL) {
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(cached.png);
    return;
  }

  try {
    const result = await pool.query(
      `SELECT company_name, ticker, investment_verdict, target_price, start_price, created_at
       FROM analyses WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (!result.rows[0]) { res.status(404).end(); return; }
    const r = result.rows[0];
    const isUS = !/^\d{6}$/.test(r.ticker) && !r.ticker.endsWith(".KS") && !r.ticker.endsWith(".KQ");
    const data: OgImageData = {
      companyName: r.company_name ?? "분석 보고서",
      ticker: r.ticker ?? "",
      verdict: r.investment_verdict ?? null,
      targetPrice: r.target_price ? Number(r.target_price) : null,
      startPrice: r.start_price ? Number(r.start_price) : null,
      currency: isUS ? "USD" : "KRW",
      createdAt: r.created_at ? new Date(r.created_at) : null,
    };
    const png = await generateOgPng(data);
    const imgBuf = png ?? await getStaticOgPng();
    if (!imgBuf) { res.status(503).end(); return; }
    if (png) ogImageCache.set(id, { png, ts: Date.now() });
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(imgBuf);
  } catch (e: any) {
    console.error("[GET /api/og/:id] error:", e?.message);
    const fallback = await getStaticOgPng();
    if (fallback) {
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.send(fallback);
    } else {
      res.status(500).end();
    }
  }
});

// ─── 공유 페이지 OG 메타태그 핸들러 (/share/:id) ────────────────────────────
const FRONTEND_DIST = path.resolve(process.cwd(), "artifacts/hedge-fund-ai/dist/public/index.html");

let _baseHtml: string | null = null;
function getBaseHtml(): string {
  if (_baseHtml) return _baseHtml;
  try {
    _baseHtml = fs.readFileSync(FRONTEND_DIST, "utf-8");
  } catch {
    _baseHtml = "";
  }
  return _baseHtml;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function verdictLabel(v: string | null): string {
  switch (v) {
    case "Strong Buy":  return "높은 상승여력";
    case "Buy":         return "상승여력";
    case "Hold":        return "적정 수준";
    case "Sell":        return "하락여지";
    case "Strong Sell": return "높은 하락여지";
    default:            return "";
  }
}

app.get("/share/:id", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.redirect("/"); return; }

  let companyName = "분석 보고서";
  let ticker = "";
  let verdict = "";
  let targetPrice: number | null = null;
  let startPrice: number | null = null;

  try {
    const result = await pool.query(
      `SELECT company_name, ticker, investment_verdict, target_price, start_price
       FROM analyses WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (result.rows[0]) {
      const r = result.rows[0];
      companyName = r.company_name ?? companyName;
      ticker = r.ticker ?? "";
      verdict = r.investment_verdict ?? "";
      targetPrice = r.target_price ? Number(r.target_price) : null;
      startPrice = r.start_price ? Number(r.start_price) : null;
    }
  } catch (e: any) {
    console.error("[OG /share/:id] DB error:", e?.message);
  }

  const ogTitle = `${companyName} 분석 보고서 by Aibitda`;
  let ogDesc = `${ticker} | AI 7단계 파이프라인 분석`;
  if (targetPrice && startPrice && startPrice > 0) {
    const upside = ((targetPrice - startPrice) / startPrice) * 100;
    const sign = upside >= 0 ? "+" : "";
    const vLabel = verdictLabel(verdict);
    const label = vLabel ? `[${vLabel}] ` : "";
    const isUS = !/^\d{6}$/.test(ticker) && !ticker.endsWith(".KS") && !ticker.endsWith(".KQ");
    const priceStr = isUS
      ? `$${targetPrice.toLocaleString("en-US", { minimumFractionDigits: 2 })}`
      : `${targetPrice.toLocaleString("ko-KR")}원`;
    ogDesc = `${label}적정주가 ${priceStr} (${sign}${upside.toFixed(1)}%) | ${ticker} AI 기업가치 분석`;
  }

  const pageUrl = `https://aibitda.kr/share/${id}`;
  const safePageUrl = escapeAttr(pageUrl);
  const ogImage = `https://aibitda.kr/opengraph.jpg`;

  const baseHtml = getBaseHtml();
  let html: string;

  if (baseHtml) {
    html = baseHtml
      .replace(/<title>[^<]*<\/title>/, `<title>${escapeAttr(ogTitle)}</title>`)
      .replace(/<meta property="og:title"[^>]*\/>/, `<meta property="og:title" content="${escapeAttr(ogTitle)}" />`)
      .replace(/<meta property="og:description"[^>]*\/>/, `<meta property="og:description" content="${escapeAttr(ogDesc)}" />`)
      .replace(/<meta property="og:image"[^>]*\/>/, `<meta property="og:image" content="${escapeAttr(ogImage)}" />`)
      .replace(/<meta property="og:type"[^>]*\/>/, `<meta property="og:type" content="article" />`)
      .replace(/<meta name="twitter:title"[^>]*\/>/, `<meta name="twitter:title" content="${escapeAttr(ogTitle)}" />`)
      .replace(/<meta name="twitter:description"[^>]*\/>/, `<meta name="twitter:description" content="${escapeAttr(ogDesc)}" />`)
      .replace(/<meta name="twitter:image"[^>]*\/>/, `<meta name="twitter:image" content="${escapeAttr(ogImage)}" />`)
      + `\n<!-- og:url --><meta property="og:url" content="${safePageUrl}" />`;
  } else {
    html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${escapeAttr(ogTitle)}</title>
  <meta property="og:type" content="article"/>
  <meta property="og:site_name" content="애빛다"/>
  <meta property="og:title" content="${escapeAttr(ogTitle)}"/>
  <meta property="og:description" content="${escapeAttr(ogDesc)}"/>
  <meta property="og:image" content="${escapeAttr(ogImage)}"/>
  <meta property="og:image:width" content="1200"/>
  <meta property="og:image:height" content="630"/>
  <meta property="og:url" content="${safePageUrl}"/>
  <meta name="twitter:card" content="summary_large_image"/>
  <meta name="twitter:title" content="${escapeAttr(ogTitle)}"/>
  <meta name="twitter:description" content="${escapeAttr(ogDesc)}"/>
  <meta name="twitter:image" content="${escapeAttr(ogImage)}"/>
  <meta http-equiv="refresh" content="0;url=${safePageUrl}"/>
</head>
<body></body>
</html>`;
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=60");
  res.send(html);
});

// ─── SPA catch-all: 빌드된 프론트엔드 정적 파일 서빙 ──────────────────────────
// 배포 환경에서 별도 프론트엔드 서비스가 없을 경우 API 서버가 직접 SPA를 서빙
// process.cwd()가 workspace root 또는 api-server 패키지 디렉토리일 수 있으므로 둘 다 탐색
const DIST_PUBLIC_CANDIDATES = [
  path.resolve(process.cwd(), "artifacts/hedge-fund-ai/dist/public"),        // cwd = workspace root
  path.resolve(process.cwd(), "../../artifacts/hedge-fund-ai/dist/public"),  // cwd = api-server dir
  path.resolve(import.meta.dirname ?? __dirname, "../../../artifacts/hedge-fund-ai/dist/public"), // ESM __dirname
];
const DIST_PUBLIC = DIST_PUBLIC_CANDIDATES.find(p => fs.existsSync(p) && fs.existsSync(path.join(p, "index.html"))) ?? "";
if (DIST_PUBLIC) {
  console.log("[SPA] Static files found, serving SPA from:", DIST_PUBLIC);
  // 정적 에셋 (JS·CSS·이미지)을 먼저 서빙, index.html 자동 fallback 비활성화
  app.use(express.static(DIST_PUBLIC, { index: false }));
  // API나 특정 경로에 해당하지 않는 모든 GET 요청 → index.html 반환 (SPA 라우팅)
  // Express 5에서는 "*" 와일드카드 대신 정규식 사용
  app.get(/.*/, (_req: Request, res: Response) => {
    res.sendFile(path.join(DIST_PUBLIC, "index.html"));
  });
} else {
  console.log("[SPA] No dist/public found — skipping static serving (dev mode)");
}

// ─── 글로벌 에러 핸들러 ────────────────────────────────────────────────────
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (err.message?.startsWith("CORS:")) {
    return res.status(403).json({ error: "접근이 허용되지 않은 출처입니다." });
  }
  console.error("[ERROR]", err.message);
  res.status(500).json({ error: "서버 오류가 발생했습니다." });
});

export default app;

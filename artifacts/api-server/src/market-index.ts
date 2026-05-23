import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { clerkMiddleware } from "@clerk/express";
import marketAnalysisRouter from "./routes/market-analysis.js";
import { startMarketScheduler } from "./lib/market-scheduler.js";
import { fetchECOSMacro } from "./lib/ecos-client.js";
import { fetchFREDMacro } from "./lib/fred-client.js";

const rawPort = process.env["PORT"];
if (!rawPort) throw new Error("[market-server] PORT env var required");
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) throw new Error(`[market-server] PORT invalid: "${rawPort}"`);

const app = express();

const ALLOWED_ORIGIN_PATTERNS: RegExp[] = [
  /^https?:\/\/localhost(:\d+)?$/,
  /\.replit\.dev$/,
  /\.replit\.app$/,
  /\.riker\.replit\.dev$/,
  /\.worf\.replit\.dev$/,
  /^https:\/\/[\w-]+\.repl\.co$/,
  /^https:\/\/(www\.)?aibitda\.kr$/,
];

app.use(cors({
  credentials: true,
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    const allowed = ALLOWED_ORIGIN_PATTERNS.some(re => re.test(origin));
    cb(allowed ? null : new Error(`CORS: origin not allowed — ${origin}`), allowed);
  },
}));

app.get("/api/healthz", (_req, res) => res.json({ status: "ok", service: "market-server" }));

app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(clerkMiddleware());

app.use("/api/market-analysis", marketAnalysisRouter);

const server = app.listen(port, () => {
  console.log(`[market-server] 기동 완료 — port ${port}`);

  startMarketScheduler();

  setTimeout(() => {
    Promise.all([
      fetchECOSMacro().catch(e => console.warn("[market-server] ECOS 예열 실패:", e?.message)),
      fetchFREDMacro().catch(e => console.warn("[market-server] FRED 예열 실패:", e?.message)),
    ]).then(() => console.log("[market-server] 매크로 캐시 예열 완료"));
  }, 5_000);
});

function gracefulShutdown(signal: string) {
  console.log(`[market-server] ${signal} — 종료 시작`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000);
}
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT",  () => gracefulShutdown("SIGINT"));

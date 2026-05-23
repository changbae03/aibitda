import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const rawUrl = process.env.NEON_DATABASE_URL ?? process.env.DATABASE_URL;

if (!rawUrl) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const sslmodeMatch = rawUrl.match(/[?&]sslmode=([^&]*)/);
const sslmode = sslmodeMatch ? sslmodeMatch[1] : null;
const sslDisabled = sslmode === "disable";

if (!sslDisabled) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const connectionString = rawUrl
  .replace(/[?&]sslmode=[^&]*/g, "")
  .replace(/[?&]channel_binding=[^&]*/g, "")
  .replace(/[?&]$/, "");

export const pool = new Pool({
  connectionString,
  ssl: sslDisabled ? false : { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 120_000,      // 120s — LLM 호출 중 커넥션 유지
  connectionTimeoutMillis: 20_000, // 20s — Neon cold-start 대기
  allowExitOnIdle: true,
});

// 끊긴 연결 에러 전파 방지 (Neon 서버리스 환경에서 흔함)
pool.on("error", (err) => {
  console.warn("[DB] pool idle client error (ignored):", err.message?.slice(0, 80));
});
export const db = drizzle(pool, { schema });

export * from "./schema";
export { runMigrations } from "./migrate";

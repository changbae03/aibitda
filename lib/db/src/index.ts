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

/**
 * jsonb 컬럼 값을 읽는다.
 *
 * **jsonb 컬럼에 JSON.parse를 걸지 말 것.** pg 드라이버는 jsonb를 이미 객체로 돌려주고,
 * 거기에 JSON.parse를 걸면 `"[object Object]" is not valid JSON` 예외가 난다.
 * 그 예외가 try/catch에 삼켜지면 캐시가 통째로 죽는데 아무도 모른다 — 실제로
 * corp_code 맵 3,977건이 system_cache에 멀쩡히 있는데도 조회가 **항상 실패**했고,
 * 그 탓에 DART 사업보고서가 한 건도 수집되지 않았다.
 *
 * 문자열로 저장된 과거 행이 섞여 있을 수 있어 두 경우를 모두 받는다.
 */
export function readJsonb<T>(value: unknown): T | null {
  if (value == null) return null;
  if (typeof value === "string") {
    try { return JSON.parse(value) as T; } catch { return null; }
  }
  return value as T;
}

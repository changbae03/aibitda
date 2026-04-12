import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const dbUrl = process.env.DATABASE_URL!;

const sslmodeMatch = dbUrl.match(/[?&]sslmode=([^&]*)/);
const sslmode = sslmodeMatch ? sslmodeMatch[1] : null;

const sslDisabled = sslmode === "disable";

if (!sslDisabled) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const connectionString = dbUrl.replace(/[?&]sslmode=[^&]*/g, "").replace(/[?&]$/, "");

export const pool = new Pool({
  connectionString,
  ssl: sslDisabled ? false : { rejectUnauthorized: false },
});
export const db = drizzle(pool, { schema });

export * from "./schema";
export { runMigrations } from "./migrate";

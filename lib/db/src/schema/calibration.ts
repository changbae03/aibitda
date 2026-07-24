import { pgTable, serial, text, integer, real, timestamp, jsonb, unique } from "drizzle-orm/pg-core";

export const modelCalibrationTable = pgTable("model_calibration", {
  id: serial("id").primaryKey(),
  sector: text("sector").notNull(),
  market: text("market").notNull().default("KR"),
  directionAccuracy: real("direction_accuracy"),
  avgPriceDeviation: real("avg_price_deviation"),
  sampleCount: integer("sample_count").notNull().default(0),
  sectorBenchmarks: jsonb("sector_benchmarks"),
  lastRecalcAt: timestamp("last_recalc_at", { withTimezone: true }).defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  // 실제 DB 제약: UNIQUE (sector, market) — migrate.ts에서 생성
  unique("model_calibration_sector_market_key").on(t.sector, t.market),
]);

export type ModelCalibration = typeof modelCalibrationTable.$inferSelect;

export const calibrationHistoryTable = pgTable("calibration_history", {
  id: serial("id").primaryKey(),
  sector: text("sector").notNull(),
  market: text("market").notNull(),
  directionAccuracy: real("direction_accuracy"),
  avgPriceDeviation: real("avg_price_deviation"),
  sampleCount: integer("sample_count").notNull().default(0),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
});

export type CalibrationHistory = typeof calibrationHistoryTable.$inferSelect;

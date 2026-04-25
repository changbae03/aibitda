import { pgTable, serial, text, integer, real, timestamp, unique } from "drizzle-orm/pg-core";

export const modelCalibrationTable = pgTable("model_calibration", {
  id: serial("id").primaryKey(),
  sector: text("sector").notNull().unique(),
  market: text("market").notNull(),
  directionAccuracy: real("direction_accuracy"),
  avgPriceDeviation: real("avg_price_deviation"),
  sampleCount: integer("sample_count").notNull().default(0),
  lastRecalcAt: timestamp("last_recalc_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ModelCalibration = typeof modelCalibrationTable.$inferSelect;

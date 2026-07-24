import { pgTable, serial, text, integer, real, timestamp, boolean } from "drizzle-orm/pg-core";
import { analysesTable } from "./analyses";

export const modelInsightsTable = pgTable("model_insights", {
  id: serial("id").primaryKey(),
  analysisId: integer("analysis_id").references(() => analysesTable.id, { onDelete: "set null" }),
  ticker: text("ticker").notNull(),
  companyName: text("company_name").notNull(),
  industry: text("industry").notNull(),
  verdict: text("verdict"),
  entryPrice: real("entry_price"),
  targetPrice: real("target_price"),
  stopLoss: real("stop_loss"),
  priceAtReview: real("price_at_review"),
  priceReturn: real("price_return"),
  daysElapsed: integer("days_elapsed"),
  outcome: text("outcome").notNull().default("pending"),
  directionMatch: boolean("direction_match"),
  valuationMethod: text("valuation_method"),
  targetAchievementPct: real("target_achievement_pct"),
  lesson: text("lesson"),
  analysisDate: timestamp("analysis_date"),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ModelInsight = typeof modelInsightsTable.$inferSelect;

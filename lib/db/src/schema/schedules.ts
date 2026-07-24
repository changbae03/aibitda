import { pgTable, serial, text, integer, timestamp, boolean } from "drizzle-orm/pg-core";

export const analysisSchedulesTable = pgTable("analysis_schedules", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  ticker: text("ticker").notNull(),
  companyName: text("company_name").notNull(),
  industry: text("industry"),
  additionalContext: text("additional_context"),
  frequency: text("frequency").notNull(),
  enabled: boolean("enabled").default(true),
  nextRunAt: timestamp("next_run_at").notNull(),
  lastRunAt: timestamp("last_run_at"),
  lastAnalysisId: integer("last_analysis_id"),
  sourceAnalysisId: integer("source_analysis_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type AnalysisSchedule = typeof analysisSchedulesTable.$inferSelect;

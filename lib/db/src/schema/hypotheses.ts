import { pgTable, serial, text, integer, real, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const hypothesesTable = pgTable("hypotheses", {
  id: serial("id").primaryKey(),
  analysisId: integer("analysis_id"),
  ticker: text("ticker").notNull(),
  companyName: text("company_name").notNull(),
  hypothesisText: text("hypothesis_text").notNull(),
  targetPrice: real("target_price").notNull(),
  entryPrice: real("entry_price").notNull(),
  actualPrice: real("actual_price"),
  timeHorizon: text("time_horizon"),
  catalysts: text("catalysts"),
  risks: text("risks"),
  outcome: text("outcome").notNull().default("pending"),
  accuracyScore: real("accuracy_score"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertHypothesisSchema = createInsertSchema(hypothesesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertHypothesis = z.infer<typeof insertHypothesisSchema>;
export type Hypothesis = typeof hypothesesTable.$inferSelect;

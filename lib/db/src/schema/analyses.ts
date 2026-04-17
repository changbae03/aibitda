import { pgTable, serial, text, integer, real, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const analysesTable = pgTable("analyses", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull(),
  companyName: text("company_name").notNull(),
  englishName: text("english_name"),
  industry: text("industry").notNull(),
  additionalContext: text("additional_context"),
  status: text("status").notNull().default("in_progress"),
  currentStep: text("current_step"),
  investmentVerdict: text("investment_verdict"),
  targetPrice: real("target_price"),
  entryPrice: real("entry_price"),
  stopLoss: real("stop_loss"),
  riskRewardRatio: real("risk_reward_ratio"),
  memo: text("memo"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertAnalysisSchema = createInsertSchema(analysesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAnalysis = z.infer<typeof insertAnalysisSchema>;
export type Analysis = typeof analysesTable.$inferSelect;

export const analysisStepsTable = pgTable("analysis_steps", {
  id: serial("id").primaryKey(),
  analysisId: integer("analysis_id").notNull().references(() => analysesTable.id),
  stepKey: text("step_key").notNull(),
  agentName: text("agent_name").notNull(),
  agentRole: text("agent_role").notNull(),
  content: text("content").notNull(),
  validationNotes: text("validation_notes"),
  informationType: text("information_type").notNull().default("data_based_estimate"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertAnalysisStepSchema = createInsertSchema(analysisStepsTable).omit({ id: true, createdAt: true });
export type InsertAnalysisStep = z.infer<typeof insertAnalysisStepSchema>;
export type AnalysisStep = typeof analysisStepsTable.$inferSelect;

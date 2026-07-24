import { relations } from "drizzle-orm";
import { analysesTable, analysisStepsTable } from "./analyses";
import { hypothesesTable } from "./hypotheses";
import { modelInsightsTable } from "./model_insights";
import { userCreditsTable, referralUsesTable } from "./credits";

// 테이블 간 관계 정의 — db.query.*.findMany({ with: ... }) 조인 쿼리를 가능하게 함

export const analysesRelations = relations(analysesTable, ({ many }) => ({
  steps: many(analysisStepsTable),
  hypotheses: many(hypothesesTable),
  insights: many(modelInsightsTable),
}));

export const analysisStepsRelations = relations(analysisStepsTable, ({ one }) => ({
  analysis: one(analysesTable, {
    fields: [analysisStepsTable.analysisId],
    references: [analysesTable.id],
  }),
}));

export const hypothesesRelations = relations(hypothesesTable, ({ one }) => ({
  analysis: one(analysesTable, {
    fields: [hypothesesTable.analysisId],
    references: [analysesTable.id],
  }),
}));

export const modelInsightsRelations = relations(modelInsightsTable, ({ one }) => ({
  analysis: one(analysesTable, {
    fields: [modelInsightsTable.analysisId],
    references: [analysesTable.id],
  }),
}));

export const userCreditsRelations = relations(userCreditsTable, ({ many }) => ({
  referralUses: many(referralUsesTable),
}));

export const referralUsesRelations = relations(referralUsesTable, ({ one }) => ({
  referrer: one(userCreditsTable, {
    fields: [referralUsesTable.referralCode],
    references: [userCreditsTable.referralCode],
  }),
}));

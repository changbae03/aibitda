import { pgTable, serial, text, integer, timestamp, varchar, jsonb, boolean } from "drizzle-orm/pg-core";

// ML 모델 DB 저장 (재배포 후 즉시 복원용)
export const mlModelsTable = pgTable("ml_models", {
  symbol: varchar("symbol", { length: 10 }).primaryKey(),
  modelData: text("model_data").notNull(),
  version: integer("version").notNull(),
  trainedAt: timestamp("trained_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const mlModelMetaTable = pgTable("ml_model_meta", {
  id: integer("id").primaryKey().default(1),
  metaData: text("meta_data").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// 섹터 밸류에이션 보정 지침 (DB 편집 가능)
export const sectorPriorsTable = pgTable("sector_priors", {
  sector: text("sector").primaryKey(),
  waccRange: text("wacc_range").notNull().default(""),
  terminalG: text("terminal_g").notNull().default(""),
  peersNote: text("peers_note").notNull().default(""),
  biasRisk: text("bias_risk").notNull().default(""),
  specificLevers: jsonb("specific_levers").notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// 프롬프트 버전 관리
export const promptVersionsTable = pgTable("prompt_versions", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  stage: text("stage").notNull(),
  content: text("content").notNull(),
  description: text("description"),
  abGroup: text("ab_group"),
  isActive: boolean("is_active").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type MlModel = typeof mlModelsTable.$inferSelect;
export type SectorPrior = typeof sectorPriorsTable.$inferSelect;

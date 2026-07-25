import { pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const systemSettingsTable = pgTable("system_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull().default(""),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const userSettingsTable = pgTable("user_settings", {
  userId: text("user_id").primaryKey(),
  language: varchar("language", { length: 5 }).notNull().default("ko"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const adminsTable = pgTable("admins", {
  userId: text("user_id").primaryKey(),
  displayName: text("display_name"),
  addedBy: text("added_by"),
  addedAt: timestamp("added_at").defaultNow().notNull(),
});

export const tickerNotesTable = pgTable("ticker_notes", {
  ticker: text("ticker").primaryKey(),
  memo: text("memo").notNull().default(""),
  autoLearning: text("auto_learning").notNull().default(""),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type SystemSetting = typeof systemSettingsTable.$inferSelect;
export type UserSetting = typeof userSettingsTable.$inferSelect;
export type Admin = typeof adminsTable.$inferSelect;
export type TickerNote = typeof tickerNotesTable.$inferSelect;

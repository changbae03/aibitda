import { pgTable, serial, text, integer, timestamp, varchar } from "drizzle-orm/pg-core";

export const userCreditsTable = pgTable("user_credits", {
  id: serial("id").primaryKey(),
  userId: text("user_id").unique().notNull(),
  dailyUsed: integer("daily_used").notNull().default(0),
  dailyLimit: integer("daily_limit").notNull().default(3),
  dailyResetDate: text("daily_reset_date").notNull().default(""),
  bonusCredits: integer("bonus_credits").notNull().default(0),
  referralCode: text("referral_code").unique(),
  totalAnalyses: integer("total_analyses").notNull().default(0),
  tier: varchar("tier").notNull().default("free"),
  adminMemo: text("admin_memo").notNull().default(""),
  displayName: text("display_name"),
  email: text("email"),
  lastLoginAt: timestamp("last_login_at"),
  sharePendingAnalysisId: integer("share_pending_analysis_id"),
  sharePendingAt: timestamp("share_pending_at", { withTimezone: true }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const referralUsesTable = pgTable("referral_uses", {
  id: serial("id").primaryKey(),
  referralCode: text("referral_code").notNull().references(() => userCreditsTable.referralCode),
  refereeId: text("referee_id").unique().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type UserCredits = typeof userCreditsTable.$inferSelect;
export type ReferralUse = typeof referralUsesTable.$inferSelect;

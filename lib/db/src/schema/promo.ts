import { pgTable, serial, text, integer, timestamp, boolean, unique } from "drizzle-orm/pg-core";

export const promoCodesTable = pgTable("promo_codes", {
  id: serial("id").primaryKey(),
  code: text("code").unique().notNull(),
  description: text("description"),
  creditAmount: integer("credit_amount").notNull().default(0),
  tierUpgrade: text("tier_upgrade"),
  maxUses: integer("max_uses"),
  usesCount: integer("uses_count").notNull().default(0),
  expiresAt: timestamp("expires_at"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const promoCodeUsesTable = pgTable("promo_code_uses", {
  id: serial("id").primaryKey(),
  code: text("code").notNull(),
  userId: text("user_id").notNull(),
  usedAt: timestamp("used_at").defaultNow().notNull(),
}, (t) => [
  unique("promo_code_uses_code_user_id_key").on(t.code, t.userId),
]);

export type PromoCode = typeof promoCodesTable.$inferSelect;
export type PromoCodeUse = typeof promoCodeUsesTable.$inferSelect;

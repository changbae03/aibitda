import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const feedbackTable = pgTable("feedback", {
  id: serial("id").primaryKey(),
  userId: text("user_id"),
  category: text("category"),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Feedback = typeof feedbackTable.$inferSelect;

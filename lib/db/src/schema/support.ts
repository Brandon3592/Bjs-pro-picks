import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const helpSubmissionsTable = pgTable("help_submissions", {
  id: serial("id").primaryKey(),
  userId: text("user_id"),
  name: text("name").notNull(),
  email: text("email").notNull(),
  subject: text("subject").notNull(),
  message: text("message").notNull(),
  status: text("status").notNull().default("new"),
  adminReply: text("admin_reply"),
  repliedAt: timestamp("replied_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
});

export type HelpSubmission = typeof helpSubmissionsTable.$inferSelect;
export type InsertHelpSubmission = typeof helpSubmissionsTable.$inferInsert;

import { pgTable, text, serial, integer, real, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const betsTable = pgTable("bets", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  gameId: text("game_id"),
  sport: text("sport").notNull(),
  homeTeam: text("home_team").notNull(),
  awayTeam: text("away_team").notNull(),
  team: text("team").notNull(),
  betType: text("bet_type").notNull(),
  bookmaker: text("bookmaker").notNull(),
  odds: integer("odds").notNull(),
  stake: real("stake").notNull(),
  result: text("result").notNull().default("pending"),
  profit: real("profit"),
  gameDate: timestamp("game_date").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertBetSchema = createInsertSchema(betsTable).omit({ id: true, createdAt: true });
export type InsertBet = z.infer<typeof insertBetSchema>;
export type Bet = typeof betsTable.$inferSelect;

export const alertSubscriptionsTable = pgTable("alert_subscriptions", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  minEdge: real("min_edge").notNull().default(3),
  sports: text("sports").array(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type AlertSubscription = typeof alertSubscriptionsTable.$inferSelect;

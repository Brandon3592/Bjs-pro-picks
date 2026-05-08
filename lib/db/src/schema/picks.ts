import { pgTable, text, serial, integer, real, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

export const aiPickHistoryTable = pgTable("ai_pick_history", {
  id: serial("id").primaryKey(),
  sport: text("sport").notNull(),
  gameId: text("game_id"),
  homeTeam: text("home_team").notNull(),
  awayTeam: text("away_team").notNull(),
  pick: text("pick").notNull(),
  player: text("player"),
  bookmaker: text("bookmaker").notNull(),
  odds: integer("odds").notNull(),
  confidence: integer("confidence").notNull(),
  reasoning: text("reasoning"),
  betType: text("bet_type").notNull().default("moneyline"),
  gameStartTime: timestamp("game_start_time").notNull(),
  result: text("result").notNull().default("pending"),
  profit: real("profit"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_pick_history_sport").on(t.sport),
  index("idx_pick_history_created_at").on(t.createdAt),
  index("idx_pick_history_result").on(t.result),
]);

export type AiPickHistory = typeof aiPickHistoryTable.$inferSelect;
export type InsertAiPickHistory = typeof aiPickHistoryTable.$inferInsert;

export const ladderProgressTable = pgTable("ladder_progress", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  sport: text("sport").notNull(),
  currentDay: integer("current_day").notNull().default(1),
  currentStake: real("current_stake").notNull().default(10),
  lastSettledDate: text("last_settled_date"),
  lastResult: text("last_result"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("idx_ladder_user_sport").on(t.userId, t.sport),
]);

export type LadderProgress = typeof ladderProgressTable.$inferSelect;

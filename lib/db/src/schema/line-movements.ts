import { pgTable, text, serial, integer, real, timestamp, index } from "drizzle-orm/pg-core";

export const oddsSnapshotsTable = pgTable("odds_snapshots", {
  id: serial("id").primaryKey(),
  gameId: text("game_id").notNull(),
  sport: text("sport").notNull(),
  homeTeam: text("home_team").notNull(),
  awayTeam: text("away_team").notNull(),
  commenceTime: timestamp("commence_time").notNull(),
  bookmaker: text("bookmaker").notNull(),
  market: text("market").notNull(),
  outcomeName: text("outcome_name").notNull(),
  price: integer("price").notNull(),
  point: real("point"),
  snapshotAt: timestamp("snapshot_at").defaultNow().notNull(),
}, (t) => [
  index("idx_snapshots_game_id").on(t.gameId),
  index("idx_snapshots_snapshot_at").on(t.snapshotAt),
]);

export type OddsSnapshot = typeof oddsSnapshotsTable.$inferSelect;
export type InsertOddsSnapshot = typeof oddsSnapshotsTable.$inferInsert;

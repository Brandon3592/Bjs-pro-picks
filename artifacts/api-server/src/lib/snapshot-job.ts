import { db, oddsSnapshotsTable } from "@workspace/db";
import { lt } from "drizzle-orm";
import { fetchAllSportOdds, hasApiKey, BOOKMAKER_DISPLAY } from "./odds-api";
import { logger } from "./logger";

const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const SNAPSHOT_TTL_MS = 48 * 60 * 60 * 1000; // keep 48 hours of history

async function takeSnapshot() {
  if (!hasApiKey()) return;

  try {
    const allOdds = await fetchAllSportOdds();
    const rows: typeof oddsSnapshotsTable.$inferInsert[] = [];
    const now = new Date();

    for (const { sport, events } of allOdds) {
      for (const ev of events) {
        const commenceTime = new Date(ev.commence_time);
        // Only snapshot upcoming/live games (not games that started >6h ago)
        if (now.getTime() - commenceTime.getTime() > 6 * 60 * 60 * 1000) continue;

        for (const bk of ev.bookmakers) {
          const bookmaker = BOOKMAKER_DISPLAY[bk.key] ?? bk.title;

          for (const market of bk.markets) {
            for (const outcome of market.outcomes) {
              rows.push({
                gameId: ev.id,
                sport,
                homeTeam: ev.home_team,
                awayTeam: ev.away_team,
                commenceTime,
                bookmaker,
                market: market.key,
                outcomeName: outcome.name,
                price: outcome.price,
                point: outcome.point ?? null,
                snapshotAt: now,
              });
            }
          }
        }
      }
    }

    if (rows.length > 0) {
      // Insert in batches of 500 to avoid query size limits
      for (let i = 0; i < rows.length; i += 500) {
        await db.insert(oddsSnapshotsTable).values(rows.slice(i, i + 500));
      }
      logger.info({ count: rows.length }, "Odds snapshot stored");
    }

    // Prune old snapshots (older than 48h)
    const cutoff = new Date(Date.now() - SNAPSHOT_TTL_MS);
    await db.delete(oddsSnapshotsTable).where(lt(oddsSnapshotsTable.snapshotAt, cutoff));
  } catch (err) {
    logger.error({ err }, "Error taking odds snapshot");
  }
}

export function startSnapshotJob() {
  // Take an initial snapshot on startup
  takeSnapshot();
  // Then repeat every 5 minutes
  setInterval(takeSnapshot, SNAPSHOT_INTERVAL_MS);
  logger.info({ intervalMs: SNAPSHOT_INTERVAL_MS }, "Odds snapshot job started");
}

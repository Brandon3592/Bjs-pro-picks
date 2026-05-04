import { db, oddsSnapshotsTable } from "@workspace/db";
import { lt, sql, desc } from "drizzle-orm";
import { fetchAllSportOdds, hasApiKey, BOOKMAKER_DISPLAY } from "./odds-api";
import { logger } from "./logger";
import { sendPushToAll } from "./push-notifications";

const SNAPSHOT_INTERVAL_MS = 60 * 60 * 1000; // 60 minutes
const SNAPSHOT_TTL_MS = 48 * 60 * 60 * 1000; // keep 48 hours of history
const STEAM_THRESHOLD_PCT = 0.5; // 0.5% implied prob shift counts as a move
const STEAM_MIN_BOOKS = 2; // need at least 2 books moving same direction

// Convert American odds to implied probability (no vig)
function toImplied(american: number): number {
  if (american > 0) return 100 / (american + 100);
  return Math.abs(american) / (Math.abs(american) + 100);
}

// Detect steam moves by comparing current snapshot to the previous one
async function detectSteamMoves(currentAt: Date): Promise<void> {
  try {
    // Find the snapshot timestamp immediately before currentAt
    const [prevRow] = await db
      .selectDistinct({ snapshotAt: oddsSnapshotsTable.snapshotAt })
      .from(oddsSnapshotsTable)
      .where(lt(oddsSnapshotsTable.snapshotAt, currentAt))
      .orderBy(desc(oddsSnapshotsTable.snapshotAt))
      .limit(1);

    if (!prevRow) return; // no prior snapshot to compare

    const prevAt = prevRow.snapshotAt;

    // Query both snapshots in one go, grouped by game+outcome+market
    const rows = await db.execute(sql`
      SELECT
        game_id,
        sport,
        home_team,
        away_team,
        bookmaker,
        market,
        outcome_name,
        MAX(CASE WHEN snapshot_at = ${prevAt} THEN price END) AS prev_price,
        MAX(CASE WHEN snapshot_at = ${currentAt} THEN price END) AS curr_price
      FROM ${oddsSnapshotsTable}
      WHERE snapshot_at IN (${prevAt}, ${currentAt})
        AND market = 'h2h'
      GROUP BY game_id, sport, home_team, away_team, bookmaker, market, outcome_name
      HAVING
        MAX(CASE WHEN snapshot_at = ${prevAt} THEN price END) IS NOT NULL
        AND MAX(CASE WHEN snapshot_at = ${currentAt} THEN price END) IS NOT NULL
    `);

    // Group by game+outcome, collect per-book moves
    type BookMove = { bookmaker: string; direction: "steam" | "reverse"; mag: number };
    const byOutcome = new Map<string, { gameId: string; sport: string; home: string; away: string; outcomeName: string; moves: BookMove[] }>();

    for (const r of rows.rows as {
      game_id: string; sport: string; home_team: string; away_team: string;
      bookmaker: string; outcome_name: string;
      prev_price: string; curr_price: string;
    }[]) {
      const prevP = parseFloat(r.prev_price);
      const currP = parseFloat(r.curr_price);
      if (isNaN(prevP) || isNaN(currP) || prevP === currP) continue;

      const prevImpl = toImplied(prevP) * 100;
      const currImpl = toImplied(currP) * 100;
      const mag = Math.abs(currImpl - prevImpl);
      if (mag < STEAM_THRESHOLD_PCT) continue;

      const direction: "steam" | "reverse" = currImpl > prevImpl ? "steam" : "reverse";
      const key = `${r.game_id}::${r.outcome_name}`;

      if (!byOutcome.has(key)) {
        byOutcome.set(key, {
          gameId: r.game_id,
          sport: r.sport,
          home: r.home_team,
          away: r.away_team,
          outcomeName: r.outcome_name,
          moves: [],
        });
      }
      byOutcome.get(key)!.moves.push({ bookmaker: r.bookmaker, direction, mag });
    }

    // Find confirmed steam moves (≥ STEAM_MIN_BOOKS moving same direction)
    const steamMoves: Array<{ sport: string; home: string; away: string; outcomeName: string; direction: string; books: number; maxMag: number }> = [];

    for (const { sport, home, away, outcomeName, moves } of byOutcome.values()) {
      const steamCount = moves.filter((m) => m.direction === "steam").length;
      const reverseCount = moves.filter((m) => m.direction === "reverse").length;

      if (steamCount >= STEAM_MIN_BOOKS) {
        steamMoves.push({
          sport, home, away, outcomeName, direction: "steam", books: steamCount,
          maxMag: Math.max(...moves.filter((m) => m.direction === "steam").map((m) => m.mag)),
        });
      } else if (reverseCount >= STEAM_MIN_BOOKS) {
        steamMoves.push({
          sport, home, away, outcomeName, direction: "reverse", books: reverseCount,
          maxMag: Math.max(...moves.filter((m) => m.direction === "reverse").map((m) => m.mag)),
        });
      }
    }

    if (steamMoves.length === 0) return;

    logger.info({ count: steamMoves.length }, "Steam moves detected");

    // Send a push notification for each steam move
    for (const move of steamMoves) {
      const arrow = move.direction === "steam" ? "🔥" : "↩️";
      const dirLabel = move.direction === "steam" ? "STEAM" : "REVERSE";
      const mag = move.maxMag.toFixed(1);

      await sendPushToAll({
        title: `${arrow} ${dirLabel} — ${move.outcomeName}`,
        body: `${move.sport}: ${move.home} vs ${move.away} | ${move.books} books moved ${mag}% | ${dirLabel.toLowerCase()} move detected`,
        tag: `steam-${move.outcomeName}-${Date.now()}`,
        data: { type: "steam_move", ...move },
      });
    }
  } catch (err) {
    logger.error({ err }, "Error detecting steam moves");
  }
}

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

      // After storing, check for steam moves vs previous snapshot
      await detectSteamMoves(now);
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

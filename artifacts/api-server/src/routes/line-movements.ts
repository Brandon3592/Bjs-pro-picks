import { Router } from "express";
import { db, oddsSnapshotsTable } from "@workspace/db";
import { eq, and, gte, desc, asc } from "drizzle-orm";
import { fetchAllSportOdds, hasApiKey, BOOKMAKER_DISPLAY } from "../lib/odds-api";

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function americanToImplied(odds: number): number {
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

function movementMagnitude(oldPrice: number, newPrice: number): number {
  return Math.abs(americanToImplied(newPrice) - americanToImplied(oldPrice)) * 100;
}

function direction(oldPrice: number, newPrice: number): "steam" | "reverse" | "neutral" {
  // "steam" = favorite gets more favored (implied prob increases)
  const diff = americanToImplied(newPrice) - americanToImplied(oldPrice);
  if (diff > 0.005) return "steam";
  if (diff < -0.005) return "reverse";
  return "neutral";
}

function formatAmerican(odds: number): string {
  return odds > 0 ? `+${odds}` : `${odds}`;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/line-movements — most significant recent moves (for dashboard widget)
router.get("/line-movements", async (req, res) => {
  const lookbackHours = parseInt((req.query.hours as string) ?? "3", 10);
  const limitN = parseInt((req.query.limit as string) ?? "10", 10);

  try {
    const cutoff = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

    // Get all snapshots in the window for h2h moneyline markets only
    const snapshots = await db
      .select()
      .from(oddsSnapshotsTable)
      .where(and(gte(oddsSnapshotsTable.snapshotAt, cutoff), eq(oddsSnapshotsTable.market, "h2h")))
      .orderBy(asc(oddsSnapshotsTable.snapshotAt));

    if (snapshots.length === 0) {
      // Fall back to current market data to detect cross-book spread
      return res.json(await getCurrentCrossBookMoves(limitN));
    }

    // Group by gameId + bookmaker + outcomeName
    type SnapshotGroup = { earliest: typeof snapshots[0]; latest: typeof snapshots[0] };
    const groups = new Map<string, SnapshotGroup>();

    for (const snap of snapshots) {
      const key = `${snap.gameId}|${snap.bookmaker}|${snap.outcomeName}`;
      if (!groups.has(key)) {
        groups.set(key, { earliest: snap, latest: snap });
      } else {
        const g = groups.get(key)!;
        if (snap.snapshotAt < g.earliest.snapshotAt) g.earliest = snap;
        if (snap.snapshotAt > g.latest.snapshotAt) g.latest = snap;
      }
    }

    // Compute moves
    const moves: {
      gameId: string; sport: string; homeTeam: string; awayTeam: string;
      bookmaker: string; outcomeName: string; market: string;
      oldPrice: number; newPrice: number; magnitude: number;
      direction: string; oldTime: string; newTime: string;
    }[] = [];

    for (const [, { earliest, latest }] of groups) {
      if (earliest.id === latest.id) continue; // only one data point
      const mag = movementMagnitude(earliest.price, latest.price);
      if (mag < 0.1) continue; // skip tiny moves (< 0.1% implied prob shift)

      moves.push({
        gameId: earliest.gameId,
        sport: earliest.sport,
        homeTeam: earliest.homeTeam,
        awayTeam: earliest.awayTeam,
        bookmaker: earliest.bookmaker,
        outcomeName: earliest.outcomeName,
        market: earliest.market,
        oldPrice: earliest.price,
        newPrice: latest.price,
        magnitude: parseFloat(mag.toFixed(2)),
        direction: direction(earliest.price, latest.price),
        oldTime: earliest.snapshotAt.toISOString(),
        newTime: latest.snapshotAt.toISOString(),
      });
    }

    // Sort by magnitude descending
    moves.sort((a, b) => b.magnitude - a.magnitude);
    return res.json(moves.slice(0, limitN));
  } catch (err) {
    req.log.error({ err }, "Error fetching line movements");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/line-movements/:gameId — price history for a specific game
router.get("/line-movements/:gameId", async (req, res) => {
  const { gameId } = req.params;
  const lookbackHours = parseInt((req.query.hours as string) ?? "24", 10);
  const cutoff = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

  try {
    const snapshots = await db
      .select()
      .from(oddsSnapshotsTable)
      .where(and(eq(oddsSnapshotsTable.gameId, gameId), gte(oddsSnapshotsTable.snapshotAt, cutoff)))
      .orderBy(asc(oddsSnapshotsTable.snapshotAt));

    if (snapshots.length === 0) {
      // Return current consensus from live API
      return res.json(await getLiveLineHistory(gameId));
    }

    // Group by outcomeName+bookmaker, return time series
    type Series = { time: string; price: number; implied: number }[];
    const seriesMap = new Map<string, Series>();

    for (const snap of snapshots) {
      if (snap.market !== "h2h") continue;
      const key = `${snap.outcomeName} (${snap.bookmaker})`;
      if (!seriesMap.has(key)) seriesMap.set(key, []);
      seriesMap.get(key)!.push({
        time: snap.snapshotAt.toISOString(),
        price: snap.price,
        implied: parseFloat((americanToImplied(snap.price) * 100).toFixed(2)),
      });
    }

    const series = Array.from(seriesMap.entries()).map(([label, data]) => ({ label, data }));
    return res.json({ gameId, series, hasHistory: true });
  } catch (err) {
    req.log.error({ err }, "Error fetching game line history");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Fallback helpers when no DB history exists ────────────────────────────────

async function getCurrentCrossBookMoves(limitN: number) {
  if (!hasApiKey()) return [];

  const allOdds = await fetchAllSportOdds();
  const moves: {
    gameId: string; sport: string; homeTeam: string; awayTeam: string;
    bookmaker: string; outcomeName: string; market: string;
    oldPrice: number; newPrice: number; magnitude: number;
    direction: string; oldTime: string; newTime: string;
  }[] = [];

  for (const { sport, events } of allOdds) {
    for (const ev of events) {
      const h2hPrices: { bookmaker: string; outcome: string; price: number }[] = [];
      for (const bk of ev.bookmakers) {
        const h2h = bk.markets.find((m) => m.key === "h2h");
        if (!h2h) continue;
        const bookmaker = BOOKMAKER_DISPLAY[bk.key] ?? bk.title;
        for (const out of h2h.outcomes) {
          h2hPrices.push({ bookmaker, outcome: out.name, price: out.price });
        }
      }

      // Find biggest spread between best and worst price for each outcome
      const byOutcome = new Map<string, number[]>();
      for (const p of h2hPrices) {
        if (!byOutcome.has(p.outcome)) byOutcome.set(p.outcome, []);
        byOutcome.get(p.outcome)!.push(p.price);
      }

      for (const [outcome, prices] of byOutcome) {
        if (prices.length < 2) continue;
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        const mag = movementMagnitude(minPrice, maxPrice);
        if (mag < 0.1) continue; // 0.1% implied prob spread = real cross-book discrepancy

        const bestBook = h2hPrices.find((p) => p.outcome === outcome && p.price === maxPrice)?.bookmaker ?? "";
        const worstBook = h2hPrices.find((p) => p.outcome === outcome && p.price === minPrice)?.bookmaker ?? "";

        moves.push({
          gameId: ev.id,
          sport,
          homeTeam: ev.home_team,
          awayTeam: ev.away_team,
          bookmaker: `${worstBook} → ${bestBook}`,
          outcomeName: outcome,
          market: "h2h",
          oldPrice: minPrice,
          newPrice: maxPrice,
          magnitude: parseFloat(mag.toFixed(2)),
          direction: direction(minPrice, maxPrice),
          oldTime: new Date().toISOString(),
          newTime: new Date().toISOString(),
        });
      }
    }
  }

  moves.sort((a, b) => b.magnitude - a.magnitude);
  return moves.slice(0, limitN);
}

async function getLiveLineHistory(gameId: string) {
  if (!hasApiKey()) return { gameId, series: [], hasHistory: false };

  const allOdds = await fetchAllSportOdds();
  for (const { events } of allOdds) {
    const ev = events.find((e) => e.id === gameId);
    if (!ev) continue;

    const series: { label: string; data: { time: string; price: number; implied: number }[] }[] = [];
    const now = new Date().toISOString();

    for (const bk of ev.bookmakers) {
      const h2h = bk.markets.find((m) => m.key === "h2h");
      if (!h2h) continue;
      const bookmaker = BOOKMAKER_DISPLAY[bk.key] ?? bk.title;
      for (const out of h2h.outcomes) {
        series.push({
          label: `${out.name} (${bookmaker})`,
          data: [{
            time: now,
            price: out.price,
            implied: parseFloat((americanToImplied(out.price) * 100).toFixed(2)),
          }],
        });
      }
    }

    return { gameId, series, hasHistory: false };
  }

  return { gameId, series: [], hasHistory: false };
}

export default router;

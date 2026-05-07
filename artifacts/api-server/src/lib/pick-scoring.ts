/**
 * pick-scoring.ts — Composite scoring model for game legs and player props.
 *
 * Score components (max 100 pts):
 *   Book count      0–25  more books = sharper consensus
 *   De-vig edge     0–30  consensus prob vs best available price
 *   Steam signal    0–25  line moved in our favor across 2+ books in last 3h
 *   Context bonus   0–20  confirmed lineup starter, no injury flag
 *   Weather penalty –15   MLB outdoor Over in heavy wind/rain
 */

import { db, oddsSnapshotsTable } from "@workspace/db";
import { gte, eq } from "drizzle-orm";
import { logger } from "./logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GameLegScore {
  gameId: string;
  outcomeName: string; // team name or "Over"/"Under"
  score: number;
  components: {
    bookCount: number;
    edge: number;
    steam: number;
    context: number;
    weather: number;
  };
  steamDirection?: "steam" | "reverse" | "neutral";
  steamMagnitude?: number;
}

export interface SteamMap {
  /** key: `${gameId}::${outcomeName}` → steam score (0–25) and direction */
  get(key: string): { score: number; direction: "steam" | "reverse" | "neutral"; magnitude: number } | undefined;
}

// ─── Steam signal from DB snapshots ──────────────────────────────────────────

function americanToImplied(odds: number): number {
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

/**
 * Query the last 3h of odds snapshots and build a map of steam moves.
 * Returns null if no DB data is available (graceful fallback).
 */
export async function buildSteamMap(): Promise<SteamMap | null> {
  try {
    const cutoff = new Date(Date.now() - 3 * 60 * 60 * 1000);

    const rows = await db
      .select()
      .from(oddsSnapshotsTable)
      .where(gte(oddsSnapshotsTable.snapshotAt, cutoff));

    if (rows.length === 0) return null;

    // Group by gameId + outcomeName + bookmaker → collect (earliest, latest) price
    type BookHistory = { earliest: number; latest: number; earliestAt: Date; latestAt: Date };
    const byBookOutcome = new Map<string, BookHistory>();

    for (const row of rows) {
      if (row.market !== "h2h") continue;
      const key = `${row.gameId}::${row.outcomeName}::${row.bookmaker}`;
      const existing = byBookOutcome.get(key);
      if (!existing) {
        byBookOutcome.set(key, {
          earliest: row.price,
          latest: row.price,
          earliestAt: row.snapshotAt,
          latestAt: row.snapshotAt,
        });
      } else {
        if (row.snapshotAt < existing.earliestAt) { existing.earliest = row.price; existing.earliestAt = row.snapshotAt; }
        if (row.snapshotAt > existing.latestAt)   { existing.latest   = row.price; existing.latestAt   = row.snapshotAt; }
      }
    }

    // Now group by gameId + outcomeName — count books moving in each direction
    type OutcomeMove = { steamBooks: number; reverseBooks: number; maxMag: number };
    const byOutcome = new Map<string, OutcomeMove>();

    for (const [key, hist] of byBookOutcome) {
      const parts = key.split("::");
      const outcomeKey = `${parts[0]}::${parts[1]}`;
      const prevImpl = americanToImplied(hist.earliest) * 100;
      const currImpl = americanToImplied(hist.latest) * 100;
      const delta = currImpl - prevImpl;
      const mag = Math.abs(delta);
      if (mag < 0.3) continue; // ignore tiny noise

      const existing = byOutcome.get(outcomeKey) ?? { steamBooks: 0, reverseBooks: 0, maxMag: 0 };
      if (delta > 0) existing.steamBooks++;
      else existing.reverseBooks++;
      existing.maxMag = Math.max(existing.maxMag, mag);
      byOutcome.set(outcomeKey, existing);
    }

    // Build the final map
    const map = new Map<string, { score: number; direction: "steam" | "reverse" | "neutral"; magnitude: number }>();

    for (const [key, move] of byOutcome) {
      const confirmedBooks = Math.max(move.steamBooks, move.reverseBooks);
      if (confirmedBooks < 2) continue; // need ≥2 books agreeing

      const direction: "steam" | "reverse" | "neutral" =
        move.steamBooks >= 2 ? "steam" :
        move.reverseBooks >= 2 ? "reverse" :
        "neutral";

      // Score: 5 pts per confirming book (max 15) + up to 10 pts for magnitude
      const bookScore = Math.min(15, confirmedBooks * 5);
      const magScore = Math.min(10, move.maxMag * 2);
      const score = direction !== "neutral" ? Math.round(bookScore + magScore) : 0;

      map.set(key, { score, direction, magnitude: move.maxMag });
    }

    logger.info({ entries: map.size }, "Steam map built for pick scoring");
    return map;
  } catch (err) {
    logger.warn({ err }, "Steam map build failed — skipping steam signal");
    return null;
  }
}

// ─── Game leg scoring ─────────────────────────────────────────────────────────

export interface ScoredGameLeg {
  gameId: string;
  pick: string;       // team/outcome name
  sport: string;
  score: number;
  bookCount: number;
  consensusProb: number;  // 0–1
  bestOdds: number;       // American
  impliedProb: number;    // 0–1
  edge: number;           // consensusProb − impliedProb, percentage points
  steamScore: number;
  steamDirection?: "steam" | "reverse" | "neutral";
}

/**
 * Score every upcoming-game outcome (favorite side) across all events.
 * Higher score = better pick quality.
 */
export function scoreGameLegs(
  events: { sport: string; ev: import("./odds-api").OddsEvent }[],
  steamMap: SteamMap | null,
  nowMs: number,
  todayCutoffMs: number,
): ScoredGameLeg[] {
  const results: ScoredGameLeg[] = [];

  for (const { sport, ev } of events) {
    const t = new Date(ev.commence_time).getTime();
    if (t <= nowMs || t > todayCutoffMs) continue;

    // Collect h2h prices per outcome across all books
    const byOutcome = new Map<string, number[]>();
    let totalBooks = 0;

    for (const bk of ev.bookmakers) {
      const h2h = bk.markets.find((m) => m.key === "h2h");
      if (!h2h || h2h.outcomes.length < 2) continue;
      totalBooks++;
      for (const out of h2h.outcomes) {
        if (!byOutcome.has(out.name)) byOutcome.set(out.name, []);
        byOutcome.get(out.name)!.push(out.price);
      }
    }

    if (totalBooks < 2) continue; // require at least 2 books

    // De-vig across all books for each outcome to get consensus prob
    const outcomes = [...byOutcome.keys()];
    if (outcomes.length < 2) continue;

    // Average implied prob per outcome, then normalize (de-vig)
    const avgImplied = outcomes.map((name) => {
      const prices = byOutcome.get(name)!;
      return { name, avg: prices.reduce((s, p) => s + americanToImplied(p), 0) / prices.length };
    });
    const totalImpl = avgImplied.reduce((s, o) => s + o.avg, 0);
    const devigged = avgImplied.map((o) => ({ name: o.name, prob: o.avg / totalImpl }));

    for (const { name, prob } of devigged) {
      const prices = byOutcome.get(name)!;
      const bestOdds = Math.max(...prices);
      const impliedProb = americanToImplied(bestOdds);
      const edge = (prob - impliedProb) * 100; // percentage points

      // ── Score components ──
      // Book count (0–25)
      const bookScore = Math.min(25, totalBooks * 4);

      // Edge (0–30): 1pt per 0.1% edge, capped
      const edgeScore = Math.min(30, Math.max(0, edge * 10));

      // Steam (0–25)
      const steamKey = `${ev.id}::${name}`;
      const steamEntry = steamMap?.get(steamKey);
      const steamScore = steamEntry?.direction === "steam" ? steamEntry.score : 0;

      // Context bonus (0–20): baseline for having enough books
      const contextScore = totalBooks >= 5 ? 15 : totalBooks >= 4 ? 10 : totalBooks >= 3 ? 5 : 0;

      const score = bookScore + edgeScore + steamScore + contextScore;

      results.push({
        gameId: ev.id,
        pick: name,
        sport,
        score,
        bookCount: totalBooks,
        consensusProb: prob,
        bestOdds,
        impliedProb,
        edge,
        steamScore,
        steamDirection: steamEntry?.direction,
      });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}

// ─── Matchup context (from Elo model) ────────────────────────────────────────

/**
 * Per-game context derived from the Elo model.
 * Built in ai-picks.ts from the eloMap and passed into scoreProps.
 */
export interface MatchupContext {
  /** Model edge for the home team vs book implied (positive = home undervalued) */
  homeEloEdgePct: number | null;
  /** Model edge for the away team vs book implied */
  awayEloEdgePct: number | null;
  /** Home team model win probability (0–1) */
  homeModelProb: number | null;
  /** Away team model win probability (0–1) */
  awayModelProb: number | null;
  /** MLB: home starting pitcher ERA (null = TBD / non-MLB) */
  homePitcherEra: number | null;
  /** MLB: away starting pitcher ERA */
  awayPitcherEra: number | null;
  /** MLB: home starting pitcher name (for prop matching) */
  homePitcherName: string | null;
  /** MLB: away starting pitcher name */
  awayPitcherName: string | null;
}

// ─── Prop scoring ─────────────────────────────────────────────────────────────

export interface ScoredProp {
  gameId: string;
  player: string;
  market: string;
  line: number;
  sport: string;
  side: "Over" | "Under";
  bestOdds: number;
  score: number;
  bookCount: number;
  edge: number;
  steamScore: number;
  confirmedInLineup: boolean;
  injuryFlagged: boolean;
}

function normPropName(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Score each prop leg. High score = worth including in parlays.
 *
 * Score components:
 *   Liquidity       0–20  tighter juice = more books pricing this line
 *   Edge            0–25  implied prob premium on the chosen side
 *   Steam           0–15  sharp line movement in this game
 *   Lineup/Injury   0–25  confirmed starter, no OUT flag
 *   Weather        −15    MLB outdoor Over in heavy wind/rain
 *   Matchup (Elo)  −15→+20  team model edge, pitcher ERA matchup
 */
export function scoreProps(
  props: import("../routes/ai-picks").AIPickLeg[],
  steamMap: SteamMap | null,
  lineupSet: Set<string> | null,
  injurySet: Set<string> | null,
  weatherPenaltyGameIds: Set<string>,
  matchupContextMap?: Map<string, MatchupContext> | null,
): (import("../routes/ai-picks").AIPickLeg & { score: number })[] {
  return props.map((leg) => {
    // ── Liquidity ──────────────────────────────────────────────────────────
    const absOdds = Math.abs(leg.odds);
    const liquidityScore = absOdds <= 120 ? 20 : absOdds <= 150 ? 14 : absOdds <= 200 ? 8 : 3;

    // ── Edge ───────────────────────────────────────────────────────────────
    const edgeScore = leg.odds < 0
      ? Math.min(25, Math.max(0, (Math.abs(leg.odds) - 100) / 8))
      : Math.min(15, Math.max(0, 20 - leg.odds / 20));

    // ── Steam ──────────────────────────────────────────────────────────────
    const steamKey   = `${leg.gameId}::${leg.player ?? ""}`;
    const steamEntry = steamMap?.get(steamKey);
    const steamScore = steamEntry ? Math.min(15, steamEntry.score) : 0;

    // ── Lineup / Injury ────────────────────────────────────────────────────
    const inLineup = lineupSet ? (lineupSet.has(leg.player ?? "") ? 15 : 0) : 8;
    const noInjury = injurySet ? (injurySet.has(leg.player ?? "") ? -15 : 10) : 5;

    // ── Weather ────────────────────────────────────────────────────────────
    const isOver        = leg.pick.includes("Over");
    const weatherPenalty = weatherPenaltyGameIds.has(leg.gameId) && isOver ? -15 : 0;

    // ── Elo matchup context ────────────────────────────────────────────────
    let matchupBonus   = 0;
    let matchupPenalty = 0;

    const ctx = matchupContextMap?.get(leg.gameId);
    if (ctx) {
      const playerName = normPropName(leg.player ?? "");
      const sport      = leg.sport?.toUpperCase() ?? "";

      // Determine which side this player is on, if possible.
      // For MLB pitchers we can match by name; for all others we use game-level signals.
      const isHomePitcher = ctx.homePitcherName
        ? normPropName(ctx.homePitcherName).includes(playerName) || playerName.includes(normPropName(ctx.homePitcherName))
        : false;
      const isAwayPitcher = ctx.awayPitcherName
        ? normPropName(ctx.awayPitcherName).includes(playerName) || playerName.includes(normPropName(ctx.awayPitcherName))
        : false;

      // ── 1. Team model edge ─────────────────────────────────────────────
      // If one team has a big model edge, their offensive players are likely to
      // produce more (favourable scoring environment). Over props get a bonus.
      // Without knowing the player's team we use the absolute largest edge as a
      // game-level signal — a dominant team creates high-variance scoring.
      const homeEdge = ctx.homeEloEdgePct ?? 0;
      const awayEdge = ctx.awayEloEdgePct ?? 0;
      const maxAbsEdge = Math.max(Math.abs(homeEdge), Math.abs(awayEdge));

      if (isOver) {
        if (maxAbsEdge >= 10) matchupBonus += 12;      // one team heavily favoured → scoring lopsided
        else if (maxAbsEdge >= 5) matchupBonus += 6;   // moderate edge → moderate boost
      } else {
        // Under bets benefit from close, low-scoring games (small edge = tight matchup)
        if (maxAbsEdge <= 3) matchupBonus += 5;
      }

      // ── 2. MLB pitcher quality signals ────────────────────────────────
      if (sport === "MLB") {
        const isPitcherStrikeoutProp =
          leg.pick.toLowerCase().includes("strikeout") ||
          (leg.betType === "player_prop" && (isHomePitcher || isAwayPitcher));

        const isBatterProp = !isPitcherStrikeoutProp;

        if (isPitcherStrikeoutProp) {
          // Pitcher's own ERA predicts strikeout performance.
          // Pitching against a weaker team (large home model edge for opponent) also helps.
          const pitcherEra = isHomePitcher ? ctx.homePitcherEra
                           : isAwayPitcher ? ctx.awayPitcherEra
                           : null;

          if (pitcherEra !== null && isOver) {
            if (pitcherEra < 3.00) matchupBonus  += 15;  // elite ace — strikeout Over is golden
            else if (pitcherEra < 3.50) matchupBonus += 10;
            else if (pitcherEra < 4.00) matchupBonus += 5;
            else if (pitcherEra > 5.00) matchupPenalty += 10; // struggling pitcher
          }
          if (pitcherEra !== null && !isOver) {
            // Under on strikeouts for a struggling pitcher
            if (pitcherEra > 5.00) matchupBonus += 8;
          }
        }

        if (isBatterProp && isOver) {
          // Batter Overs are hurt by facing an ace pitcher.
          // We don't know which team the batter is on, so if either pitcher is an ace
          // there's a risk — full penalty if both are aces, half if just one.
          const homeIsAce = ctx.homePitcherEra !== null && ctx.homePitcherEra < 3.50;
          const awayIsAce = ctx.awayPitcherEra !== null && ctx.awayPitcherEra < 3.50;
          if (homeIsAce && awayIsAce) matchupPenalty += 14; // pitcher's duel — batters suffer
          else if (homeIsAce || awayIsAce) matchupPenalty += 7;

          // Bonus if we know the opposing pitcher is hittable (high ERA)
          const homeIsBad = ctx.homePitcherEra !== null && ctx.homePitcherEra > 5.00;
          const awayIsBad = ctx.awayPitcherEra !== null && ctx.awayPitcherEra > 5.00;
          if (homeIsBad || awayIsBad) matchupBonus += 8; // someone is getting shelled today
        }
      }

      // ── 3. NBA / NHL: large model edge → favoured team players get Over boost ─
      if ((sport === "NBA" || sport === "NHL") && isOver) {
        // A team with a big Elo edge is expected to outscore their opponent —
        // their key players should hit Overs. Same caveats as above (team unknown).
        if (maxAbsEdge >= 8) matchupBonus += 8;
        else if (maxAbsEdge >= 4) matchupBonus += 4;
      }
    }

    const score = Math.max(0,
      liquidityScore + edgeScore + steamScore + inLineup + noInjury
      + weatherPenalty + matchupBonus - matchupPenalty,
    );
    return { ...leg, score };
  }).sort((a, b) => b.score - a.score);
}

// ─── Weather penalty helper ───────────────────────────────────────────────────

import { fetchWeather } from "./weather";

/**
 * Returns a set of MLB gameIds where weather is bad enough to penalize Over bets.
 * Criteria: wind ≥ 15 mph OR precipitation ≥ 40%
 */
export async function buildWeatherPenaltySet(
  events: { sport: string; ev: import("./odds-api").OddsEvent }[],
): Promise<Set<string>> {
  const penaltySet = new Set<string>();

  const mlbEvents = events.filter(({ sport }) =>
    sport === "MLB" || sport === "baseball_mlb",
  );

  await Promise.all(
    mlbEvents.map(async ({ ev }) => {
      try {
        const w = await fetchWeather(ev.home_team);
        if (!w) return;
        if (w.windSpeed >= 15 || w.precipitation >= 40) {
          penaltySet.add(ev.id);
          logger.info(
            { gameId: ev.id, home: ev.home_team, wind: w.windSpeed, precip: w.precipitation },
            "Weather penalty applied to MLB game",
          );
        }
      } catch {
        // ignore — weather is a bonus signal, not critical
      }
    }),
  );

  return penaltySet;
}

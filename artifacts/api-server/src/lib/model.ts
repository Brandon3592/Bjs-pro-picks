import type { OddsEvent, OddsBookmaker } from "./odds-api";
import { BOOKMAKER_DISPLAY } from "./odds-api";

// ─── Odds Math ────────────────────────────────────────────────────────────────

export function americanToDecimal(odds: number): number {
  if (odds > 0) return odds / 100 + 1;
  return 100 / Math.abs(odds) + 1;
}

export function decimalToAmerican(dec: number): number {
  if (dec >= 2) return Math.round((dec - 1) * 100);
  return Math.round(-100 / (dec - 1));
}

export function americanToImplied(odds: number): number {
  const dec = americanToDecimal(odds);
  return 1 / dec;
}

/** Remove bookmaker margin from a two-outcome market, returning true probs */
export function devig(prices: number[]): number[] {
  const implied = prices.map(americanToImplied);
  const total = implied.reduce((a, b) => a + b, 0);
  return implied.map((p) => p / total);
}

/**
 * Calculate the consensus (no-vig) probability for each team by averaging
 * the de-vigged probs across all bookmakers that offer the market.
 *
 * Returns [homeProb, awayProb] in the order: [home_team, away_team]
 */
export function consensusProb(
  event: OddsEvent,
  marketKey: "h2h" | "spreads" | "totals" = "h2h",
): [number, number] | null {
  const samples: [number, number][] = [];

  for (const bk of event.bookmakers) {
    const market = bk.markets.find((m) => m.key === marketKey);
    if (!market || market.outcomes.length < 2) continue;

    const homeOutcome = market.outcomes.find((o) => o.name === event.home_team);
    const awayOutcome = market.outcomes.find((o) => o.name === event.away_team);
    if (!homeOutcome || !awayOutcome) continue;

    const [hp, ap] = devig([homeOutcome.price, awayOutcome.price]);
    samples.push([hp, ap]);
  }

  if (samples.length === 0) return null;

  const avgHome = samples.reduce((s, [h]) => s + h, 0) / samples.length;
  const avgAway = samples.reduce((s, [, a]) => s + a, 0) / samples.length;
  return [avgHome, avgAway];
}

// ─── Kelly Criterion ──────────────────────────────────────────────────────────

export function kellyFraction(modelProb: number, odds: number): number {
  const dec = americanToDecimal(odds);
  const b = dec - 1;
  const q = 1 - modelProb;
  const k = (modelProb * b - q) / b;
  return Math.max(0, Math.min(k * 0.25, 0.1)); // quarter-kelly, capped 10%
}

// ─── Value Bet Detection ──────────────────────────────────────────────────────

export const MIN_EDGE = 0.5; // percent — real markets are efficient; 0.5%+ is genuine value

export interface ValueBet {
  id: string;
  gameId: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  team: string;
  betType: "moneyline" | "spread" | "over" | "under";
  bookmaker: string;
  odds: number;
  impliedProb: number;
  modelProb: number;
  edge: number;
  kellyStake: number;
  status: "live" | "upcoming";
}

export function findValueBets(
  event: OddsEvent,
  sport: string,
  status: "live" | "upcoming",
  minEdge = MIN_EDGE,
): ValueBet[] {
  const cp = consensusProb(event, "h2h");
  if (!cp) return [];
  const [homeProb, awayProb] = cp;

  const bets: ValueBet[] = [];
  let idCounter = 0;

  for (const bk of event.bookmakers) {
    const bookmaker = BOOKMAKER_DISPLAY[bk.key] ?? bk.title;

    // ── Moneyline ────────────────────────────────────────────────────────────
    const h2h = bk.markets.find((m) => m.key === "h2h");
    if (h2h) {
      const homeOut = h2h.outcomes.find((o) => o.name === event.home_team);
      const awayOut = h2h.outcomes.find((o) => o.name === event.away_team);

      if (homeOut) {
        const impliedProb = americanToImplied(homeOut.price);
        const edge = (homeProb - impliedProb) * 100;
        if (edge >= minEdge) {
          bets.push({
            id: `${event.id}-${bk.key}-home-ml-${idCounter++}`,
            gameId: event.id,
            sport,
            homeTeam: event.home_team,
            awayTeam: event.away_team,
            startTime: event.commence_time,
            team: event.home_team,
            betType: "moneyline",
            bookmaker,
            odds: homeOut.price,
            impliedProb,
            modelProb: homeProb,
            edge: parseFloat(edge.toFixed(2)),
            kellyStake: kellyFraction(homeProb, homeOut.price),
            status,
          });
        }
      }

      if (awayOut) {
        const impliedProb = americanToImplied(awayOut.price);
        const edge = (awayProb - impliedProb) * 100;
        if (edge >= minEdge) {
          bets.push({
            id: `${event.id}-${bk.key}-away-ml-${idCounter++}`,
            gameId: event.id,
            sport,
            homeTeam: event.home_team,
            awayTeam: event.away_team,
            startTime: event.commence_time,
            team: event.away_team,
            betType: "moneyline",
            bookmaker,
            odds: awayOut.price,
            impliedProb,
            modelProb: awayProb,
            edge: parseFloat(edge.toFixed(2)),
            kellyStake: kellyFraction(awayProb, awayOut.price),
            status,
          });
        }
      }
    }

    // ── Totals (Over/Under) ──────────────────────────────────────────────────
    const totals = bk.markets.find((m) => m.key === "totals");
    if (totals) {
      const overOut = totals.outcomes.find((o) => o.name === "Over");
      const underOut = totals.outcomes.find((o) => o.name === "Under");

      if (overOut && underOut) {
        const [overProb, underProb] = devig([overOut.price, underOut.price]);
        // Check for stale markets (exactly -110/-110 from all books = no real signal)
        const impliedOver = americanToImplied(overOut.price);
        const consensusTotals = calcConsensusTotals(event, "Over", "Under");
        if (consensusTotals) {
          const [cOver, cUnder] = consensusTotals;
          const overEdge = (cOver - impliedOver) * 100;
          if (overEdge >= minEdge) {
            bets.push({
              id: `${event.id}-${bk.key}-over-${idCounter++}`,
              gameId: event.id,
              sport,
              homeTeam: event.home_team,
              awayTeam: event.away_team,
              startTime: event.commence_time,
              team: `Over ${overOut.point ?? ""}`.trim(),
              betType: "over",
              bookmaker,
              odds: overOut.price,
              impliedProb: impliedOver,
              modelProb: cOver,
              edge: parseFloat(overEdge.toFixed(2)),
              kellyStake: kellyFraction(cOver, overOut.price),
              status,
            });
          }
          const impliedUnder = americanToImplied(underOut.price);
          const underEdge = (cUnder - impliedUnder) * 100;
          if (underEdge >= minEdge) {
            bets.push({
              id: `${event.id}-${bk.key}-under-${idCounter++}`,
              gameId: event.id,
              sport,
              homeTeam: event.home_team,
              awayTeam: event.away_team,
              startTime: event.commence_time,
              team: `Under ${underOut.point ?? ""}`.trim(),
              betType: "under",
              bookmaker,
              odds: underOut.price,
              impliedProb: impliedUnder,
              modelProb: cUnder,
              edge: parseFloat(underEdge.toFixed(2)),
              kellyStake: kellyFraction(cUnder, underOut.price),
              status,
            });
          }
        }
      }
    }
  }

  return bets;
}

function calcConsensusTotals(
  event: OddsEvent,
  overName: string,
  underName: string,
): [number, number] | null {
  const samples: [number, number][] = [];
  for (const bk of event.bookmakers) {
    const market = bk.markets.find((m) => m.key === "totals");
    if (!market) continue;
    const overOut = market.outcomes.find((o) => o.name === overName);
    const underOut = market.outcomes.find((o) => o.name === underName);
    if (!overOut || !underOut) continue;
    const [op, up] = devig([overOut.price, underOut.price]);
    samples.push([op, up]);
  }
  if (samples.length === 0) return null;
  const avgOver = samples.reduce((s, [o]) => s + o, 0) / samples.length;
  const avgUnder = samples.reduce((s, [, u]) => s + u, 0) / samples.length;
  return [avgOver, avgUnder];
}

// ─── Game transformation ──────────────────────────────────────────────────────

export function gameStatus(event: OddsEvent): "live" | "upcoming" | "final" {
  const now = Date.now();
  const start = new Date(event.commence_time).getTime();
  if (start > now) return "upcoming";
  if (now - start < 5 * 60 * 60 * 1000) return "live";
  return "final";
}

/**
 * Find the best actual edge available for a game across all bookmakers.
 * Uses consensus prob as the "fair" line, then finds the book offering
 * the best price on either side.
 */
export function bestEdgeForGame(event: OddsEvent): number | null {
  const cp = consensusProb(event, "h2h");
  if (!cp) return null;
  const [homeProb, awayProb] = cp;

  let maxEdge = 0;
  for (const bk of event.bookmakers) {
    const h2h = bk.markets.find((m) => m.key === "h2h");
    if (!h2h) continue;
    const homeOut = h2h.outcomes.find((o) => o.name === event.home_team);
    const awayOut = h2h.outcomes.find((o) => o.name === event.away_team);
    if (homeOut) maxEdge = Math.max(maxEdge, (homeProb - americanToImplied(homeOut.price)) * 100);
    if (awayOut) maxEdge = Math.max(maxEdge, (awayProb - americanToImplied(awayOut.price)) * 100);
  }
  return maxEdge > 0 ? parseFloat(maxEdge.toFixed(2)) : null;
}

export function bestMoneylineForGame(bk: OddsBookmaker, teamName: string): number | null {
  const h2h = bk.markets.find((m) => m.key === "h2h");
  if (!h2h) return null;
  return h2h.outcomes.find((o) => o.name === teamName)?.price ?? null;
}

export function bestSpreadForGame(bk: OddsBookmaker, teamName: string): { point: number; price: number } | null {
  const spreads = bk.markets.find((m) => m.key === "spreads");
  if (!spreads) return null;
  const out = spreads.outcomes.find((o) => o.name === teamName);
  if (!out || out.point === undefined) return null;
  return { point: out.point, price: out.price };
}

export function bestTotals(bk: OddsBookmaker): { overUnder: number; overOdds: number; underOdds: number } | null {
  const totals = bk.markets.find((m) => m.key === "totals");
  if (!totals) return null;
  const over = totals.outcomes.find((o) => o.name === "Over");
  const under = totals.outcomes.find((o) => o.name === "Under");
  if (!over || !under) return null;
  return { overUnder: over.point ?? 0, overOdds: over.price, underOdds: under.price };
}

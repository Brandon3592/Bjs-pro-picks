import type { OddsEvent } from "./odds-api";
import { BOOKMAKER_DISPLAY } from "./odds-api";
import { americanToImplied } from "./model";
import { gameStatus } from "./model";

export interface ArbLeg {
  outcome: string;
  bookmaker: string;
  odds: number;
  impliedProb: number;
  stakeRatio: number; // fraction of total stake to place here
}

export interface ArbOpportunity {
  id: string;
  gameId: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  market: "h2h" | "totals";
  legs: ArbLeg[];
  totalImplied: number; // sum of implied probs (< 1.0 = true arb)
  profitPct: number;    // guaranteed profit % on total stake (positive = true arb)
  isArb: boolean;       // true when profitPct > 0
  status: "live" | "upcoming";
}

// Show opportunities where combined book vig ≤ 2% (near-arbs included for context)
const MAX_COMBINED_IMPLIED = 1.02;

function checkH2HArb(
  ev: OddsEvent,
  sport: string,
  status: "live" | "upcoming",
): ArbOpportunity | null {
  // Find the best (highest) American odds for each outcome across all books
  let bestHome: { bookmaker: string; odds: number } | null = null;
  let bestAway: { bookmaker: string; odds: number } | null = null;

  for (const bk of ev.bookmakers) {
    const display = BOOKMAKER_DISPLAY[bk.key] ?? bk.title;
    const h2h = bk.markets.find((m) => m.key === "h2h");
    if (!h2h) continue;

    const homeOut = h2h.outcomes.find((o) => o.name === ev.home_team);
    const awayOut = h2h.outcomes.find((o) => o.name === ev.away_team);

    if (homeOut) {
      if (!bestHome || homeOut.price > bestHome.odds) {
        bestHome = { bookmaker: display, odds: homeOut.price };
      }
    }
    if (awayOut) {
      if (!bestAway || awayOut.price > bestAway.odds) {
        bestAway = { bookmaker: display, odds: awayOut.price };
      }
    }
  }

  if (!bestHome || !bestAway) return null;

  const impliedHome = americanToImplied(bestHome.odds);
  const impliedAway = americanToImplied(bestAway.odds);
  const totalImplied = impliedHome + impliedAway;

  if (totalImplied > MAX_COMBINED_IMPLIED) return null;

  const profitPct = parseFloat(((1 / totalImplied - 1) * 100).toFixed(3));

  const legs: ArbLeg[] = [
    {
      outcome: ev.home_team,
      bookmaker: bestHome.bookmaker,
      odds: bestHome.odds,
      impliedProb: parseFloat((impliedHome * 100).toFixed(2)),
      stakeRatio: parseFloat((impliedHome / totalImplied).toFixed(4)),
    },
    {
      outcome: ev.away_team,
      bookmaker: bestAway.bookmaker,
      odds: bestAway.odds,
      impliedProb: parseFloat((impliedAway * 100).toFixed(2)),
      stakeRatio: parseFloat((impliedAway / totalImplied).toFixed(4)),
    },
  ];

  return {
    id: `${ev.id}-h2h-arb`,
    gameId: ev.id,
    sport,
    homeTeam: ev.home_team,
    awayTeam: ev.away_team,
    startTime: ev.commence_time,
    market: "h2h",
    legs,
    totalImplied: parseFloat((totalImplied * 100).toFixed(3)),
    profitPct,
    isArb: profitPct > 0,
    status,
  };
}

function checkTotalsArb(
  ev: OddsEvent,
  sport: string,
  status: "live" | "upcoming",
): ArbOpportunity[] {
  // Group best over/under prices by line (point value)
  const byLine = new Map<
    number,
    {
      bestOver: { bookmaker: string; odds: number } | null;
      bestUnder: { bookmaker: string; odds: number } | null;
    }
  >();

  for (const bk of ev.bookmakers) {
    const display = BOOKMAKER_DISPLAY[bk.key] ?? bk.title;
    const totals = bk.markets.find((m) => m.key === "totals");
    if (!totals) continue;

    const overOut = totals.outcomes.find((o) => o.name === "Over");
    const underOut = totals.outcomes.find((o) => o.name === "Under");
    if (!overOut || !underOut || overOut.point == null) continue;

    const line = overOut.point;
    if (!byLine.has(line)) byLine.set(line, { bestOver: null, bestUnder: null });
    const entry = byLine.get(line)!;

    if (!entry.bestOver || overOut.price > entry.bestOver.odds) {
      entry.bestOver = { bookmaker: display, odds: overOut.price };
    }
    if (!entry.bestUnder || underOut.price > entry.bestUnder.odds) {
      entry.bestUnder = { bookmaker: display, odds: underOut.price };
    }
  }

  const opps: ArbOpportunity[] = [];

  for (const [line, { bestOver, bestUnder }] of byLine) {
    if (!bestOver || !bestUnder) continue;

    const impliedOver = americanToImplied(bestOver.odds);
    const impliedUnder = americanToImplied(bestUnder.odds);
    const totalImplied = impliedOver + impliedUnder;

    if (totalImplied > MAX_COMBINED_IMPLIED) continue;

    const profitPct = parseFloat(((1 / totalImplied - 1) * 100).toFixed(3));

    opps.push({
      id: `${ev.id}-totals-${line}-arb`,
      gameId: ev.id,
      sport,
      homeTeam: ev.home_team,
      awayTeam: ev.away_team,
      startTime: ev.commence_time,
      market: "totals",
      legs: [
        {
          outcome: `Over ${line}`,
          bookmaker: bestOver.bookmaker,
          odds: bestOver.odds,
          impliedProb: parseFloat((impliedOver * 100).toFixed(2)),
          stakeRatio: parseFloat((impliedOver / totalImplied).toFixed(4)),
        },
        {
          outcome: `Under ${line}`,
          bookmaker: bestUnder.bookmaker,
          odds: bestUnder.odds,
          impliedProb: parseFloat((impliedUnder * 100).toFixed(2)),
          stakeRatio: parseFloat((impliedUnder / totalImplied).toFixed(4)),
        },
      ],
      totalImplied: parseFloat((totalImplied * 100).toFixed(3)),
      profitPct,
      isArb: profitPct > 0,
      status,
    });
  }

  return opps;
}

export function findArbOpportunities(
  allOdds: { sport: string; events: OddsEvent[] }[],
): ArbOpportunity[] {
  const opps: ArbOpportunity[] = [];

  for (const { sport, events } of allOdds) {
    for (const ev of events) {
      const status = gameStatus(ev);
      if (status === "final") continue;
      if (ev.bookmakers.length < 2) continue;

      const h2h = checkH2HArb(ev, sport, status);
      if (h2h) opps.push(h2h);

      opps.push(...checkTotalsArb(ev, sport, status));
    }
  }

  // Sort: true arbs first (by profit %), then near-arbs (by lowest totalImplied)
  return opps.sort((a, b) => {
    if (a.isArb !== b.isArb) return a.isArb ? -1 : 1;
    return b.profitPct - a.profitPct;
  });
}

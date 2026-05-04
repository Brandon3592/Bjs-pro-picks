import type { OddsEvent } from "./odds-api";
import { BOOKMAKER_DISPLAY } from "./odds-api";
import { americanToImplied, devig, kellyFraction } from "./model";

export interface AllMarketBet {
  id: string;
  gameId: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  status: "live" | "upcoming";
  marketKey: string;
  marketLabel: string;
  selection: string;
  bookmaker: string;
  odds: number;
  impliedProb: number;
  consensusProb: number;
  edge: number;
  kellyStake: number;
}

function uid(gameId: string, ...parts: (string | number)[]): string {
  return [gameId, ...parts].join("-").replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, 80);
}

// ─── h2h ────────────────────────────────────────────────────────────────────

function calcH2HEdges(
  event: OddsEvent,
  sport: string,
  status: "live" | "upcoming",
  minEdge: number,
): AllMarketBet[] {
  const allNames = new Set(
    event.bookmakers.flatMap(
      (bk) => bk.markets.find((m) => m.key === "h2h")?.outcomes.map((o) => o.name) ?? [],
    ),
  );
  return allNames.has("Draw")
    ? calcH2H3Way(event, sport, status, minEdge)
    : calcH2H2Way(event, sport, status, minEdge);
}

function calcH2H2Way(
  event: OddsEvent,
  sport: string,
  status: "live" | "upcoming",
  minEdge: number,
): AllMarketBet[] {
  let sumHome = 0;
  let count = 0;
  for (const bk of event.bookmakers) {
    const mkt = bk.markets.find((m) => m.key === "h2h");
    if (!mkt) continue;
    const homeOut = mkt.outcomes.find((o) => o.name === event.home_team);
    const awayOut = mkt.outcomes.find((o) => o.name === event.away_team);
    if (!homeOut || !awayOut) continue;
    const [hp] = devig([homeOut.price, awayOut.price]);
    sumHome += hp;
    count++;
  }
  if (count < 2) return [];
  const cHome = sumHome / count;
  const cAway = 1 - cHome;
  const bets: AllMarketBet[] = [];
  for (const bk of event.bookmakers) {
    const mkt = bk.markets.find((m) => m.key === "h2h");
    if (!mkt) continue;
    const bookmaker = BOOKMAKER_DISPLAY[bk.key] ?? bk.title;
    for (const out of mkt.outcomes) {
      const cProb = out.name === event.home_team ? cHome : cAway;
      const impl = americanToImplied(out.price);
      const edge = (cProb - impl) * 100;
      if (edge >= minEdge) {
        bets.push({
          id: uid(event.id, "h2h", bk.key, out.name),
          gameId: event.id, sport, homeTeam: event.home_team, awayTeam: event.away_team,
          startTime: event.commence_time, status,
          marketKey: "h2h", marketLabel: "Moneyline", selection: out.name, bookmaker,
          odds: out.price,
          impliedProb: parseFloat((impl * 100).toFixed(2)),
          consensusProb: parseFloat((cProb * 100).toFixed(2)),
          edge: parseFloat(edge.toFixed(2)),
          kellyStake: kellyFraction(cProb, out.price),
        });
      }
    }
  }
  return bets;
}

function calcH2H3Way(
  event: OddsEvent,
  sport: string,
  status: "live" | "upcoming",
  minEdge: number,
): AllMarketBet[] {
  let sumH = 0, sumD = 0, sumA = 0, count = 0;
  for (const bk of event.bookmakers) {
    const mkt = bk.markets.find((m) => m.key === "h2h");
    if (!mkt || mkt.outcomes.length < 3) continue;
    const ho = mkt.outcomes.find((o) => o.name === event.home_team);
    const dr = mkt.outcomes.find((o) => o.name === "Draw");
    const ao = mkt.outcomes.find((o) => o.name === event.away_team);
    if (!ho || !dr || !ao) continue;
    const [hp, dp, ap] = devig([ho.price, dr.price, ao.price]);
    sumH += hp; sumD += dp; sumA += ap;
    count++;
  }
  if (count < 2) return [];
  const consMap: Record<string, number> = {
    [event.home_team]: sumH / count,
    Draw: sumD / count,
    [event.away_team]: sumA / count,
  };
  const bets: AllMarketBet[] = [];
  for (const bk of event.bookmakers) {
    const mkt = bk.markets.find((m) => m.key === "h2h");
    if (!mkt) continue;
    const bookmaker = BOOKMAKER_DISPLAY[bk.key] ?? bk.title;
    for (const out of mkt.outcomes) {
      const cProb = consMap[out.name];
      if (cProb == null) continue;
      const impl = americanToImplied(out.price);
      const edge = (cProb - impl) * 100;
      if (edge >= minEdge) {
        bets.push({
          id: uid(event.id, "1x2", bk.key, out.name),
          gameId: event.id, sport, homeTeam: event.home_team, awayTeam: event.away_team,
          startTime: event.commence_time, status,
          marketKey: "h2h", marketLabel: "1X2", selection: out.name, bookmaker,
          odds: out.price,
          impliedProb: parseFloat((impl * 100).toFixed(2)),
          consensusProb: parseFloat((cProb * 100).toFixed(2)),
          edge: parseFloat(edge.toFixed(2)),
          kellyStake: kellyFraction(cProb, out.price),
        });
      }
    }
  }
  return bets;
}

// ─── Spreads ──────────────────────────────────────────────────────────────────

function calcSpreadsEdges(
  event: OddsEvent,
  sport: string,
  status: "live" | "upcoming",
  minEdge: number,
): AllMarketBet[] {
  // Cross-book consensus per (team, line) — handles line shopping
  type Entry = { team: string; line: number; prices: Map<string, number> };
  const byTeamLine = new Map<string, Entry>();
  for (const bk of event.bookmakers) {
    const mkt = bk.markets.find((m) => m.key === "spreads");
    if (!mkt) continue;
    const bookmaker = BOOKMAKER_DISPLAY[bk.key] ?? bk.title;
    for (const out of mkt.outcomes) {
      if (out.point == null) continue;
      const key = `${out.name}\u0000${out.point}`;
      if (!byTeamLine.has(key)) byTeamLine.set(key, { team: out.name, line: out.point, prices: new Map() });
      byTeamLine.get(key)!.prices.set(bookmaker, out.price);
    }
  }
  const bets: AllMarketBet[] = [];
  for (const { team, line, prices } of byTeamLine.values()) {
    if (prices.size < 2) continue;
    let sumImpl = 0;
    for (const odds of prices.values()) sumImpl += americanToImplied(odds);
    const cProb = sumImpl / prices.size;
    for (const [bookmaker, odds] of prices) {
      const impl = americanToImplied(odds);
      const edge = (cProb - impl) * 100;
      if (edge >= minEdge) {
        bets.push({
          id: uid(event.id, "spreads", bookmaker, team, line),
          gameId: event.id, sport, homeTeam: event.home_team, awayTeam: event.away_team,
          startTime: event.commence_time, status,
          marketKey: "spreads", marketLabel: "Spread",
          selection: `${team} ${line > 0 ? "+" : ""}${line}`,
          bookmaker, odds,
          impliedProb: parseFloat((impl * 100).toFixed(2)),
          consensusProb: parseFloat((cProb * 100).toFixed(2)),
          edge: parseFloat(edge.toFixed(2)),
          kellyStake: kellyFraction(cProb, odds),
        });
      }
    }
  }
  return bets;
}

// ─── Totals ───────────────────────────────────────────────────────────────────

function calcTotalsEdges(
  event: OddsEvent,
  sport: string,
  status: "live" | "upcoming",
  minEdge: number,
): AllMarketBet[] {
  let sumOver = 0, count = 0;
  for (const bk of event.bookmakers) {
    const mkt = bk.markets.find((m) => m.key === "totals");
    if (!mkt) continue;
    const overOut = mkt.outcomes.find((o) => o.name === "Over");
    const underOut = mkt.outcomes.find((o) => o.name === "Under");
    if (!overOut || !underOut) continue;
    const [op] = devig([overOut.price, underOut.price]);
    sumOver += op;
    count++;
  }
  if (count < 2) return [];
  const cOver = sumOver / count;
  const cUnder = 1 - cOver;
  const bets: AllMarketBet[] = [];
  for (const bk of event.bookmakers) {
    const mkt = bk.markets.find((m) => m.key === "totals");
    if (!mkt) continue;
    const bookmaker = BOOKMAKER_DISPLAY[bk.key] ?? bk.title;
    const overOut = mkt.outcomes.find((o) => o.name === "Over");
    const underOut = mkt.outcomes.find((o) => o.name === "Under");
    if (!overOut || !underOut) continue;
    const implOver = americanToImplied(overOut.price);
    const implUnder = americanToImplied(underOut.price);
    const overEdge = (cOver - implOver) * 100;
    const underEdge = (cUnder - implUnder) * 100;
    if (overEdge >= minEdge) {
      bets.push({
        id: uid(event.id, "totals", bk.key, "over"),
        gameId: event.id, sport, homeTeam: event.home_team, awayTeam: event.away_team,
        startTime: event.commence_time, status,
        marketKey: "totals", marketLabel: "Total",
        selection: `Over ${overOut.point ?? ""}`.trim(),
        bookmaker, odds: overOut.price,
        impliedProb: parseFloat((implOver * 100).toFixed(2)),
        consensusProb: parseFloat((cOver * 100).toFixed(2)),
        edge: parseFloat(overEdge.toFixed(2)),
        kellyStake: kellyFraction(cOver, overOut.price),
      });
    }
    if (underEdge >= minEdge) {
      bets.push({
        id: uid(event.id, "totals", bk.key, "under"),
        gameId: event.id, sport, homeTeam: event.home_team, awayTeam: event.away_team,
        startTime: event.commence_time, status,
        marketKey: "totals", marketLabel: "Total",
        selection: `Under ${underOut.point ?? ""}`.trim(),
        bookmaker, odds: underOut.price,
        impliedProb: parseFloat((implUnder * 100).toFixed(2)),
        consensusProb: parseFloat((cUnder * 100).toFixed(2)),
        edge: parseFloat(underEdge.toFixed(2)),
        kellyStake: kellyFraction(cUnder, underOut.price),
      });
    }
  }
  return bets;
}

// ─── Alt spreads / alt totals / team totals (cross-book per side+line) ───────

function calcOneSidedEdges(
  event: OddsEvent,
  sport: string,
  status: "live" | "upcoming",
  minEdge: number,
  marketKey: string,
  marketLabel: string,
): AllMarketBet[] {
  type SideEntry = { selection: string; prices: Map<string, number> };
  const bySide = new Map<string, SideEntry>();

  for (const bk of event.bookmakers) {
    const mkt = bk.markets.find((m) => m.key === marketKey);
    if (!mkt) continue;
    const bookmaker = BOOKMAKER_DISPLAY[bk.key] ?? bk.title;
    for (const out of mkt.outcomes) {
      if (out.point == null) continue;
      // team_totals: description = team name; alt spreads: name = team or Over/Under
      const desc = (out as unknown as Record<string, unknown>).description as string | undefined;
      const selLabel = desc
        ? `${desc} ${out.name} ${out.point}`
        : `${out.name} ${out.point > 0 && !marketKey.includes("total") ? "+" : ""}${out.point}`;
      const key = `${out.name}\u0000${desc ?? ""}\u0000${out.point}`;
      if (!bySide.has(key)) bySide.set(key, { selection: selLabel, prices: new Map() });
      bySide.get(key)!.prices.set(bookmaker, out.price);
    }
  }

  const bets: AllMarketBet[] = [];
  for (const { selection, prices } of bySide.values()) {
    if (prices.size < 2) continue;
    let sumImpl = 0;
    for (const odds of prices.values()) sumImpl += americanToImplied(odds);
    const cProb = sumImpl / prices.size;
    for (const [bookmaker, odds] of prices) {
      const impl = americanToImplied(odds);
      const edge = (cProb - impl) * 100;
      if (edge >= minEdge) {
        bets.push({
          id: uid(event.id, marketKey, bookmaker, selection),
          gameId: event.id, sport, homeTeam: event.home_team, awayTeam: event.away_team,
          startTime: event.commence_time, status,
          marketKey, marketLabel, selection, bookmaker, odds,
          impliedProb: parseFloat((impl * 100).toFixed(2)),
          consensusProb: parseFloat((cProb * 100).toFixed(2)),
          edge: parseFloat(edge.toFixed(2)),
          kellyStake: kellyFraction(cProb, odds),
        });
      }
    }
  }
  return bets;
}

// ─── BTTS ────────────────────────────────────────────────────────────────────

function calcBttsEdges(
  event: OddsEvent,
  sport: string,
  status: "live" | "upcoming",
  minEdge: number,
): AllMarketBet[] {
  const bySide = new Map<string, Map<string, number>>();
  for (const bk of event.bookmakers) {
    const mkt = bk.markets.find((m) => m.key === "btts");
    if (!mkt) continue;
    const bookmaker = BOOKMAKER_DISPLAY[bk.key] ?? bk.title;
    for (const out of mkt.outcomes) {
      if (!bySide.has(out.name)) bySide.set(out.name, new Map());
      bySide.get(out.name)!.set(bookmaker, out.price);
    }
  }
  const bets: AllMarketBet[] = [];
  for (const [side, prices] of bySide) {
    if (prices.size < 2) continue;
    let sumImpl = 0;
    for (const odds of prices.values()) sumImpl += americanToImplied(odds);
    const cProb = sumImpl / prices.size;
    for (const [bookmaker, odds] of prices) {
      const impl = americanToImplied(odds);
      const edge = (cProb - impl) * 100;
      if (edge >= minEdge) {
        bets.push({
          id: uid(event.id, "btts", bookmaker, side),
          gameId: event.id, sport, homeTeam: event.home_team, awayTeam: event.away_team,
          startTime: event.commence_time, status,
          marketKey: "btts", marketLabel: "BTTS",
          selection: `BTTS ${side}`, bookmaker, odds,
          impliedProb: parseFloat((impl * 100).toFixed(2)),
          consensusProb: parseFloat((cProb * 100).toFixed(2)),
          edge: parseFloat(edge.toFixed(2)),
          kellyStake: kellyFraction(cProb, odds),
        });
      }
    }
  }
  return bets;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

const MARKET_HANDLERS: Record<
  string,
  (event: OddsEvent, sport: string, status: "live" | "upcoming", minEdge: number) => AllMarketBet[]
> = {
  h2h: calcH2HEdges,
  spreads: calcSpreadsEdges,
  totals: calcTotalsEdges,
  alternate_spreads: (e, s, st, me) => calcOneSidedEdges(e, s, st, me, "alternate_spreads", "Alt Spread"),
  alternate_totals: (e, s, st, me) => calcOneSidedEdges(e, s, st, me, "alternate_totals", "Alt Total"),
  team_totals: (e, s, st, me) => calcOneSidedEdges(e, s, st, me, "team_totals", "Team Total"),
  btts: calcBttsEdges,
};

export function findAllMarketBets(
  event: OddsEvent,
  sport: string,
  status: "live" | "upcoming",
  minEdge = 0.5,
): AllMarketBet[] {
  const allMarketKeys = new Set(event.bookmakers.flatMap((bk) => bk.markets.map((m) => m.key)));
  const bets: AllMarketBet[] = [];
  for (const marketKey of allMarketKeys) {
    const handler = MARKET_HANDLERS[marketKey];
    if (handler) bets.push(...handler(event, sport, status, minEdge));
  }
  return bets.sort((a, b) => b.edge - a.edge);
}

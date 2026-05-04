import type { PropEvent } from "./odds-api";
import { PROP_MARKETS, BOOKMAKER_DISPLAY } from "./odds-api";
import { americanToImplied, kellyFraction } from "./model";

export interface PropEdge {
  player: string;
  market: string;
  marketLabel: string;
  line: number;
  bookmaker: string;
  side: "Over" | "Under";
  odds: number;
  impliedProb: number;
  consensusProb: number;
  edge: number;
  kellyStake: number;
}

function getMarketLabel(sport: string, marketKey: string): string {
  const markets = PROP_MARKETS[sport] ?? [];
  return markets.find((m) => m.key === marketKey)?.label ?? marketKey;
}

// ─── Standard props: both sides per book, de-vig within book ─────────────────

function findStandardEdges(
  event: PropEvent,
  marketKey: string,
  marketLabel: string,
): PropEdge[] {
  type BookPrices = { over: number | null; under: number | null };
  type ComboEntry = {
    playerName: string;
    line: number;
    bookMap: Map<string, BookPrices>;
  };

  const byCombo = new Map<string, ComboEntry>();

  for (const bk of event.bookmakers) {
    const display = BOOKMAKER_DISPLAY[bk.key] ?? bk.title;
    const market = bk.markets.find((m) => m.key === marketKey);
    if (!market) continue;

    const playerLines = new Map<string, { over?: number; under?: number }>();
    for (const outcome of market.outcomes) {
      if (!outcome.description || outcome.point == null) continue;
      const plKey = `${outcome.description}\u0000${outcome.point}`;
      if (!playerLines.has(plKey)) playerLines.set(plKey, {});
      const entry = playerLines.get(plKey)!;
      if (outcome.name === "Over") entry.over = outcome.price;
      else entry.under = outcome.price;
    }

    for (const [plKey, prices] of playerLines) {
      if (prices.over == null || prices.under == null) continue;
      const [playerName, lineStr] = plKey.split("\u0000");
      const line = parseFloat(lineStr);
      if (!byCombo.has(plKey)) {
        byCombo.set(plKey, { playerName, line, bookMap: new Map() });
      }
      byCombo.get(plKey)!.bookMap.set(display, { over: prices.over, under: prices.under });
    }
  }

  const edges: PropEdge[] = [];

  for (const { playerName, line, bookMap } of byCombo.values()) {
    let sumOverProb = 0;
    let count = 0;
    for (const { over, under } of bookMap.values()) {
      if (over == null || under == null) continue;
      const implOver = americanToImplied(over);
      const implUnder = americanToImplied(under);
      const total = implOver + implUnder;
      sumOverProb += implOver / total;
      count++;
    }
    if (count === 0) continue;

    const consensusOverProb = count > 1 ? sumOverProb / count : sumOverProb;
    const consensusUnderProb = 1 - consensusOverProb;

    for (const [bookmaker, { over, under }] of bookMap) {
      if (over == null || under == null) continue;

      const implOver = americanToImplied(over);
      const overEdge = count > 1 ? (consensusOverProb - implOver) * 100 : 0;
      edges.push({
        player: playerName,
        market: marketKey,
        marketLabel,
        line,
        bookmaker,
        side: "Over",
        odds: over,
        impliedProb: parseFloat((implOver * 100).toFixed(2)),
        consensusProb: parseFloat((consensusOverProb * 100).toFixed(2)),
        edge: parseFloat(overEdge.toFixed(2)),
        kellyStake: count > 1 ? kellyFraction(consensusOverProb, over) : 0,
      });

      const implUnder = americanToImplied(under);
      const underEdge = count > 1 ? (consensusUnderProb - implUnder) * 100 : 0;
      edges.push({
        player: playerName,
        market: marketKey,
        marketLabel,
        line,
        bookmaker,
        side: "Under",
        odds: under,
        impliedProb: parseFloat((implUnder * 100).toFixed(2)),
        consensusProb: parseFloat((consensusUnderProb * 100).toFixed(2)),
        edge: parseFloat(underEdge.toFixed(2)),
        kellyStake: count > 1 ? kellyFraction(consensusUnderProb, under) : 0,
      });
    }
  }

  return edges;
}

// ─── Alt lines: one side per line per book, cross-book consensus per side ────

function findAltEdges(
  event: PropEvent,
  marketKey: string,
  marketLabel: string,
): PropEdge[] {
  type SideEntry = {
    playerName: string;
    line: number;
    side: "Over" | "Under";
    prices: Map<string, number>;
  };

  const bySide = new Map<string, SideEntry>();

  for (const bk of event.bookmakers) {
    const display = BOOKMAKER_DISPLAY[bk.key] ?? bk.title;
    const market = bk.markets.find((m) => m.key === marketKey);
    if (!market) continue;

    for (const outcome of market.outcomes) {
      if (!outcome.description || outcome.point == null) continue;
      const side = outcome.name;
      const key = `${outcome.description}\u0000${outcome.point}\u0000${side}`;
      if (!bySide.has(key)) {
        bySide.set(key, {
          playerName: outcome.description,
          line: outcome.point,
          side,
          prices: new Map(),
        });
      }
      bySide.get(key)!.prices.set(display, outcome.price);
    }
  }

  const edges: PropEdge[] = [];

  for (const { playerName, line, side, prices } of bySide.values()) {
    let sumImplied = 0;
    for (const odds of prices.values()) {
      sumImplied += americanToImplied(odds);
    }
    const consensusProb = sumImplied / prices.size;

    for (const [bookmaker, odds] of prices) {
      const impliedProb = americanToImplied(odds);
      const edge = prices.size > 1 ? (consensusProb - impliedProb) * 100 : 0;
      edges.push({
        player: playerName,
        market: marketKey,
        marketLabel,
        line,
        bookmaker,
        side,
        odds,
        impliedProb: parseFloat((impliedProb * 100).toFixed(2)),
        consensusProb: parseFloat((consensusProb * 100).toFixed(2)),
        edge: parseFloat(edge.toFixed(2)),
        kellyStake: prices.size > 1 ? kellyFraction(consensusProb, odds) : 0,
      });
    }
  }

  return edges;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export function findPropEdges(
  event: PropEvent,
  sport: string,
): PropEdge[] {
  const requestedMarkets = event.bookmakers
    .flatMap((bk) => bk.markets.map((m) => m.key))
    .filter((v, i, a) => a.indexOf(v) === i);

  const edges: PropEdge[] = [];

  for (const marketKey of requestedMarkets) {
    const marketLabel = getMarketLabel(sport, marketKey);
    const isAlt = marketKey.endsWith("_alternate");

    if (isAlt) {
      edges.push(...findAltEdges(event, marketKey, marketLabel));
    } else {
      edges.push(...findStandardEdges(event, marketKey, marketLabel));
    }
  }

  return edges.sort((a, b) => b.edge - a.edge);
}

import type { PropEvent } from "./odds-api";
import { PROP_MARKETS, BOOKMAKER_DISPLAY } from "./odds-api";
import { americanToImplied, kellyFraction } from "./model";

export interface PropEdge {
  player: string;
  market: string;       // e.g. "player_points"
  marketLabel: string;  // e.g. "Points"
  line: number;         // e.g. 25.5
  bookmaker: string;
  side: "Over" | "Under";
  odds: number;
  impliedProb: number;  // book's raw implied %
  consensusProb: number; // de-vigged consensus %
  edge: number;          // consensusProb - impliedProb (percentage points)
  kellyStake: number;    // fraction of bankroll (quarter-Kelly)
}

function getMarketLabel(sport: string, marketKey: string): string {
  const markets = PROP_MARKETS[sport] ?? [];
  return markets.find((m) => m.key === marketKey)?.label ?? marketKey;
}

export function findPropEdges(
  event: PropEvent,
  sport: string,
  minEdgePct = 0.5,
): PropEdge[] {
  type BookPrices = { over: number | null; under: number | null };

  // Use a structured Map value so we never need to parse a composite key
  type ComboEntry = {
    playerName: string;
    marketKey: string;
    line: number;
    bookMap: Map<string, BookPrices>;
  };

  // comboKey: unique string per (player, market, line) — used only as Map key
  const byCombo = new Map<string, ComboEntry>();

  for (const bk of event.bookmakers) {
    const display = BOOKMAKER_DISPLAY[bk.key] ?? bk.title;

    for (const market of bk.markets) {
      // Group by player name + line within this market
      const playerLines = new Map<string, { over?: number; under?: number }>();

      for (const outcome of market.outcomes) {
        // Props format: name="Over"|"Under", description=playerName, point=line
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

        const comboKey = `${market.key}\u0000${plKey}`;
        if (!byCombo.has(comboKey)) {
          byCombo.set(comboKey, {
            playerName,
            marketKey: market.key,
            line,
            bookMap: new Map(),
          });
        }
        byCombo.get(comboKey)!.bookMap.set(display, {
          over: prices.over,
          under: prices.under,
        });
      }
    }
  }

  const edges: PropEdge[] = [];

  for (const { playerName, marketKey, line, bookMap } of byCombo.values()) {
    if (bookMap.size < 2) continue; // need ≥2 books for consensus

    const marketLabel = getMarketLabel(sport, marketKey);

    // Consensus: average de-vigged over probability across all books
    let sumOverProb = 0;
    let count = 0;

    for (const { over, under } of bookMap.values()) {
      if (over == null || under == null) continue;
      const implOver = americanToImplied(over);
      const implUnder = americanToImplied(under);
      const total = implOver + implUnder;
      sumOverProb += implOver / total; // de-vigged
      count++;
    }

    if (count === 0) continue;
    const consensusOverProb = sumOverProb / count;
    const consensusUnderProb = 1 - consensusOverProb;

    // Find edges per book per side
    for (const [bookmaker, { over, under }] of bookMap) {
      if (over == null || under == null) continue;

      const implOver = americanToImplied(over);
      const overEdge = (consensusOverProb - implOver) * 100;
      if (overEdge >= minEdgePct) {
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
          kellyStake: kellyFraction(consensusOverProb, over),
        });
      }

      const implUnder = americanToImplied(under);
      const underEdge = (consensusUnderProb - implUnder) * 100;
      if (underEdge >= minEdgePct) {
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
          kellyStake: kellyFraction(consensusUnderProb, under),
        });
      }
    }
  }

  return edges.sort((a, b) => b.edge - a.edge);
}

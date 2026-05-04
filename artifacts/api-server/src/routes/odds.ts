import { Router } from "express";
import { GetOddsQueryParams } from "@workspace/api-zod";
import { fetchAllSportOdds, hasApiKey, BOOKMAKER_DISPLAY } from "../lib/odds-api";
import { bestMoneylineForGame, bestSpreadForGame, bestTotals } from "../lib/model";

const router = Router();

const BOOKMAKERS = ["DraftKings", "FanDuel", "BetMGM", "Caesars", "PointsBet"];

router.get("/odds", async (req, res) => {
  const parsed = GetOddsQueryParams.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Invalid query params" });
  const { gameId, sport, bookmaker } = parsed.data;

  if (hasApiKey()) {
    const allOdds = await fetchAllSportOdds();
    const odds: unknown[] = [];

    for (const { sport: s, events } of allOdds) {
      if (sport && sport !== "all" && s !== sport) continue;

      for (const ev of events) {
        if (gameId && ev.id !== gameId) continue;

        for (const bk of ev.bookmakers) {
          const displayName = BOOKMAKER_DISPLAY[bk.key] ?? bk.title;
          if (bookmaker && displayName !== bookmaker) continue;

          const h2h = bk.markets.find((m) => m.key === "h2h");
          const spreads = bk.markets.find((m) => m.key === "spreads");
          const totals = bk.markets.find((m) => m.key === "totals");

          const homeML = h2h?.outcomes.find((o) => o.name === ev.home_team)?.price ?? null;
          const awayML = h2h?.outcomes.find((o) => o.name === ev.away_team)?.price ?? null;
          const homeSpread = spreads?.outcomes.find((o) => o.name === ev.home_team);
          const awaySpread = spreads?.outcomes.find((o) => o.name === ev.away_team);
          const over = totals?.outcomes.find((o) => o.name === "Over");
          const under = totals?.outcomes.find((o) => o.name === "Under");

          odds.push({
            id: `${ev.id}-${bk.key}`,
            gameId: ev.id,
            sport: s,
            bookmaker: displayName,
            homeMoneyline: homeML,
            awayMoneyline: awayML,
            homeSpread: homeSpread?.point ?? null,
            awaySpread: awaySpread?.point ?? null,
            homeSpreadOdds: homeSpread?.price ?? null,
            awaySpreadOdds: awaySpread?.price ?? null,
            overUnder: over?.point ?? null,
            overOdds: over?.price ?? null,
            underOdds: under?.price ?? null,
            updatedAt: bk.last_update,
          });
        }
      }
    }

    if (odds.length > 0) return res.json(odds);
  }

  // Mock fallback
  const gameIds = gameId ? [gameId] : ["nfl-1", "nfl-2", "nba-1", "nba-2", "mlb-1", "nhl-1"];
  const bookmakers = bookmaker ? [bookmaker] : BOOKMAKERS;

  const odds = [];
  for (const gId of gameIds) {
    for (let i = 0; i < bookmakers.length; i++) {
      const bkm = bookmakers[i];
      const spread = (Math.random() * 0.5 - 0.25).toFixed(1);
      const mlHome = Math.round(-110 + (i * 5 - 10) + (Math.random() * 10 - 5));
      const mlAway = Math.round(100 + (i * 5 - 10) + (Math.random() * 10 - 5));
      odds.push({
        id: `${gId}-${bkm.toLowerCase().replace(/\s/g, "")}`,
        gameId: gId,
        bookmaker: bkm,
        homeMoneyline: mlHome,
        awayMoneyline: mlAway,
        homeSpread: -3.5 + parseFloat(spread),
        awaySpread: 3.5 - parseFloat(spread),
        homeSpreadOdds: -110,
        awaySpreadOdds: -110,
        overUnder: 47.5,
        overOdds: -110,
        underOdds: -110,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  if (sport && sport !== "all") {
    const sportPrefix = sport.toLowerCase().slice(0, 3);
    return res.json(odds.filter((o) => o.gameId.startsWith(sportPrefix)));
  }

  return res.json(odds);
});

export default router;

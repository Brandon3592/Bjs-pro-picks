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

  return res.json([]);
});

export default router;

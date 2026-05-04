import { Router } from "express";
import { SPORT_CATALOG, fetchOddsForSportAllMarkets } from "../lib/odds-api";
import { findAllMarketBets } from "../lib/all-markets-model";
import { gameStatus } from "../lib/model";

const router = Router();

// Static sport catalog — no API calls
router.get("/all-markets/catalog", (_req, res) => {
  const groups = ["US Sports", "Soccer", "Combat", "More"] as const;
  const catalog = groups.map((group) => ({
    group,
    sports: SPORT_CATALOG.filter((s) => s.group === group).map(({ key, title, markets }) => ({
      key,
      title,
      markets,
    })),
  }));
  return res.json(catalog);
});

// On-demand market edges for a specific sport
router.get("/all-markets", async (req, res) => {
  const sport = req.query.sport as string | undefined;
  const minEdge = parseFloat((req.query.minEdge as string) || "0.5");

  if (!sport) return res.status(400).json({ error: "sport query param is required" });

  const entry = SPORT_CATALOG.find((s) => s.key === sport);
  if (!entry) return res.status(400).json({ error: `Unknown sport key: ${sport}` });

  try {
    const events = await fetchOddsForSportAllMarkets(sport, entry.markets);
    if (!events) return res.json([]);

    const bets = events.flatMap((event) => {
      const status = gameStatus(event);
      if (status === "final") return [];
      return findAllMarketBets(event, entry.title, status, minEdge);
    });

    return res.json(bets.sort((a, b) => b.edge - a.edge));
  } catch (err) {
    req.log.error({ err }, "Error in /api/all-markets");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

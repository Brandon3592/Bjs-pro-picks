import { Router } from "express";
import { GetOddsQueryParams } from "@workspace/api-zod";

const router = Router();

const BOOKMAKERS = ["DraftKings", "FanDuel", "BetMGM", "Caesars", "PointsBet"];

router.get("/odds", (req, res) => {
  const parsed = GetOddsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query params" });
  }
  const { gameId, sport, bookmaker } = parsed.data;

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

  let result = odds;
  if (sport && sport !== "all") {
    const sportPrefix = sport.toLowerCase().slice(0, 3);
    result = odds.filter((o) => o.gameId.startsWith(sportPrefix));
  }

  return res.json(result);
});

export default router;

import { Router } from "express";
import {
  fetchOddsForSport,
  fetchPlayerPropsForEvent,
  SPORT_KEYS,
  PROP_MARKETS,
  BOOKMAKER_DISPLAY,
} from "../lib/odds-api";
import { findPropEdges } from "../lib/props";
import { gameStatus } from "../lib/model";

const router = Router();

// List upcoming games available for props, filtered by sport
router.get("/props/games", async (req, res) => {
  const sport = (req.query.sport as string | undefined)?.toUpperCase() ?? "NBA";
  const sportKey = SPORT_KEYS[sport];
  if (!sportKey) return res.status(400).json({ error: `Unknown sport: ${sport}` });

  try {
    const events = await fetchOddsForSport(sportKey);
    if (!events) return res.json([]);

    const games = events
      .filter((ev) => {
        const s = gameStatus(ev);
        return s === "upcoming";
      })
      .slice(0, 10) // cap at 10 games per sport
      .map((ev) => ({
        id: ev.id,
        sport,
        homeTeam: ev.home_team,
        awayTeam: ev.away_team,
        startTime: ev.commence_time,
        status: gameStatus(ev),
      }));

    return res.json(games);
  } catch (err) {
    req.log.error({ err }, "Error fetching prop games");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Fetch prop edges for a specific game
router.get("/props", async (req, res) => {
  const gameId = req.query.gameId as string | undefined;
  const sport = (req.query.sport as string | undefined)?.toUpperCase() ?? "NBA";

  if (!gameId) return res.status(400).json({ error: "gameId is required" });

  const sportKey = SPORT_KEYS[sport];
  if (!sportKey) return res.status(400).json({ error: `Unknown sport: ${sport}` });

  const availableMarkets = (PROP_MARKETS[sport] ?? []).map((m) => m.key);
  const requestedRaw = req.query.markets as string | undefined;
  const marketKeys = requestedRaw
    ? requestedRaw.split(",").filter((m) => availableMarkets.includes(m))
    : availableMarkets;

  if (marketKeys.length === 0) return res.json([]);

  try {
    const event = await fetchPlayerPropsForEvent(sportKey, gameId, marketKeys);
    if (!event) return res.json([]);

    const edges = findPropEdges(event, sport);
    return res.json(edges);
  } catch (err) {
    req.log.error({ err }, "Error fetching props");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

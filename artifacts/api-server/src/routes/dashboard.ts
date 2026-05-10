import { Router } from "express";
import { hasApiKey, fetchAllSportOdds } from "../lib/odds-api";
import { gameStatus } from "../lib/model";
import { fetchWeather } from "../lib/weather";

const router = Router();

router.get("/dashboard/summary", async (_req, res) => {
  if (!hasApiKey()) {
    return res.json({
      liveGamesCount: 0,
      upcomingGamesCount: 0,
      totalGames: 0,
      topGames: [],
      sportBreakdown: [],
      bookmakerBreakdown: [],
      lastRefreshed: new Date().toISOString(),
      isLiveData: false,
    });
  }

  const allOdds = await fetchAllSportOdds();

  let liveGamesCount = 0;
  let upcomingGamesCount = 0;

  const sportStats: Record<string, { games: number }> = {};
  const bookStats: Record<string, { games: Set<string> }> = {};

  type TopGame = {
    id: string; sport: string; homeTeam: string; awayTeam: string;
    startTime: string; bookCount: number;
    weather?: { temp: number; windSpeed: number; condition: string } | null;
  };
  const topGamesPool: TopGame[] = [];

  for (const { sport, events } of allOdds) {
    if (!sportStats[sport]) sportStats[sport] = { games: 0 };

    for (const ev of events) {
      const status = gameStatus(ev);
      if (status === "final") continue;
      if (status === "live") liveGamesCount++;
      if (status === "upcoming") upcomingGamesCount++;
      sportStats[sport].games++;

      for (const bk of ev.bookmakers) {
        if (!bookStats[bk.key]) bookStats[bk.key] = { games: new Set() };
        bookStats[bk.key].games.add(ev.id);
      }

      if (status === "upcoming") {
        topGamesPool.push({
          id: ev.id,
          sport,
          homeTeam: ev.home_team,
          awayTeam: ev.away_team,
          startTime: ev.commence_time,
          bookCount: ev.bookmakers.length,
        });
      }
    }
  }

  const topGamesSorted = topGamesPool
    .sort((a, b) => b.bookCount - a.bookCount || new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
    .slice(0, 6);

  // Fetch weather in parallel for outdoor NFL/MLB games
  const topGames = await Promise.all(
    topGamesSorted.map(async (g) => {
      if (g.sport === "NFL" || g.sport === "MLB") {
        try {
          const w = await fetchWeather(g.homeTeam);
          return { ...g, weather: w ? { temp: w.temp, windSpeed: w.windSpeed, condition: w.condition } : null };
        } catch {
          return { ...g, weather: null };
        }
      }
      return { ...g, weather: null };
    })
  );

  const sportBreakdown = Object.entries(sportStats)
    .filter(([, s]) => s.games > 0)
    .map(([sport, s]) => ({ sport, games: s.games }))
    .sort((a, b) => b.games - a.games);

  const bookmakerBreakdown = Object.entries(bookStats)
    .map(([bookmaker, s]) => ({ bookmaker, games: s.games.size }))
    .sort((a, b) => b.games - a.games)
    .slice(0, 8);

  return res.json({
    liveGamesCount,
    upcomingGamesCount,
    totalGames: liveGamesCount + upcomingGamesCount,
    topGames,
    sportBreakdown,
    bookmakerBreakdown,
    lastRefreshed: new Date().toISOString(),
    isLiveData: true,
  });
});

export default router;

import { Router } from "express";
import { hasApiKey, fetchAllSportOdds } from "../lib/odds-api";
import { gameStatus, findValueBets, MIN_EDGE } from "../lib/model";

const router = Router();

router.get("/dashboard/summary", async (_req, res) => {
  if (!hasApiKey()) {
    return res.json({
      liveGamesCount: 3,
      upcomingGamesCount: 4,
      totalValueBets: 8,
      avgEdge: 4.6,
      topValueBets: [],
      sportBreakdown: [
        { sport: "NFL", valueBets: 3, avgEdge: 4.4, games: 3 },
        { sport: "NBA", valueBets: 2, avgEdge: 5.0, games: 2 },
        { sport: "MLB", valueBets: 2, avgEdge: 4.9, games: 2 },
        { sport: "NHL", valueBets: 1, avgEdge: 3.9, games: 1 },
      ],
      bookmakerBreakdown: [
        { bookmaker: "DraftKings", valueBets: 2, avgEdge: 5.1 },
        { bookmaker: "FanDuel", valueBets: 2, avgEdge: 4.6 },
        { bookmaker: "BetMGM", valueBets: 2, avgEdge: 4.2 },
        { bookmaker: "Caesars", valueBets: 1, avgEdge: 5.5 },
        { bookmaker: "PointsBet", valueBets: 1, avgEdge: 3.7 },
      ],
      lastRefreshed: new Date().toISOString(),
      isLiveData: false,
    });
  }

  const allOdds = await fetchAllSportOdds();

  const allValueBets: ReturnType<typeof findValueBets> = [];
  let liveGamesCount = 0;
  let upcomingGamesCount = 0;

  const sportStats: Record<string, { valueBets: number; totalEdge: number; games: number }> = {};
  const bookStats: Record<string, { valueBets: number; totalEdge: number }> = {};

  for (const { sport, events } of allOdds) {
    if (!sportStats[sport]) sportStats[sport] = { valueBets: 0, totalEdge: 0, games: 0 };

    for (const ev of events) {
      const status = gameStatus(ev);
      if (status === "final") continue;
      if (status === "live") liveGamesCount++;
      if (status === "upcoming") upcomingGamesCount++;
      sportStats[sport].games++;

      const bets = findValueBets(ev, sport, status, MIN_EDGE);
      allValueBets.push(...bets);
      sportStats[sport].valueBets += bets.length;
      sportStats[sport].totalEdge += bets.reduce((s, b) => s + b.edge, 0);

      for (const bet of bets) {
        if (!bookStats[bet.bookmaker]) bookStats[bet.bookmaker] = { valueBets: 0, totalEdge: 0 };
        bookStats[bet.bookmaker].valueBets++;
        bookStats[bet.bookmaker].totalEdge += bet.edge;
      }
    }
  }

  const topValueBets = [...allValueBets].sort((a, b) => b.edge - a.edge).slice(0, 5);
  const avgEdge = allValueBets.length > 0
    ? parseFloat((allValueBets.reduce((s, b) => s + b.edge, 0) / allValueBets.length).toFixed(2))
    : 0;

  const sportBreakdown = Object.entries(sportStats)
    .filter(([, s]) => s.games > 0)
    .map(([sport, s]) => ({
      sport,
      valueBets: s.valueBets,
      avgEdge: s.valueBets > 0 ? parseFloat((s.totalEdge / s.valueBets).toFixed(2)) : 0,
      games: s.games,
    }));

  const bookmakerBreakdown = Object.entries(bookStats)
    .sort((a, b) => b[1].valueBets - a[1].valueBets)
    .slice(0, 8)
    .map(([bookmaker, s]) => ({
      bookmaker,
      valueBets: s.valueBets,
      avgEdge: parseFloat((s.totalEdge / s.valueBets).toFixed(2)),
    }));

  return res.json({
    liveGamesCount,
    upcomingGamesCount,
    totalValueBets: allValueBets.length,
    avgEdge,
    topValueBets,
    sportBreakdown,
    bookmakerBreakdown,
    lastRefreshed: new Date().toISOString(),
    isLiveData: true,
  });
});

export default router;

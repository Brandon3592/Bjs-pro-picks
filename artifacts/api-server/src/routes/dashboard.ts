import { Router } from "express";

const router = Router();

function americanOddsToImplied(odds: number): number {
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

function kellyStake(modelProb: number, odds: number): number {
  const decimalOdds = odds > 0 ? odds / 100 + 1 : 100 / Math.abs(odds) + 1;
  const b = decimalOdds - 1;
  const q = 1 - modelProb;
  const kelly = (modelProb * b - q) / b;
  return Math.max(0, Math.min(kelly * 0.25, 0.1));
}

const topValueBets = [
  {
    id: "vb-2",
    gameId: "nba-1",
    sport: "NBA",
    homeTeam: "Boston Celtics",
    awayTeam: "Golden State Warriors",
    startTime: new Date(Date.now() - 1.5 * 60 * 60 * 1000).toISOString(),
    team: "Boston Celtics",
    betType: "spread",
    bookmaker: "DraftKings",
    odds: -108,
    impliedProb: americanOddsToImplied(-108),
    modelProb: 0.585,
    edge: 6.2,
    kellyStake: kellyStake(0.585, -108),
    status: "live",
  },
  {
    id: "vb-4",
    gameId: "mlb-2",
    sport: "MLB",
    homeTeam: "Los Angeles Dodgers",
    awayTeam: "Atlanta Braves",
    startTime: new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString(),
    team: "Los Angeles Dodgers",
    betType: "moneyline",
    bookmaker: "Caesars",
    odds: -130,
    impliedProb: americanOddsToImplied(-130),
    modelProb: 0.698,
    edge: 5.5,
    kellyStake: kellyStake(0.698, -130),
    status: "upcoming",
  },
  {
    id: "vb-3",
    gameId: "nfl-2",
    sport: "NFL",
    homeTeam: "Dallas Cowboys",
    awayTeam: "Philadelphia Eagles",
    startTime: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
    team: "Dallas Cowboys",
    betType: "moneyline",
    bookmaker: "BetMGM",
    odds: -120,
    impliedProb: americanOddsToImplied(-120),
    modelProb: 0.653,
    edge: 5.1,
    kellyStake: kellyStake(0.653, -120),
    status: "upcoming",
  },
  {
    id: "vb-1",
    gameId: "nfl-1",
    sport: "NFL",
    homeTeam: "Kansas City Chiefs",
    awayTeam: "Baltimore Ravens",
    startTime: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    team: "Kansas City Chiefs",
    betType: "moneyline",
    bookmaker: "FanDuel",
    odds: -115,
    impliedProb: americanOddsToImplied(-115),
    modelProb: 0.62,
    edge: 4.8,
    kellyStake: kellyStake(0.62, -115),
    status: "live",
  },
  {
    id: "vb-7",
    gameId: "mlb-1",
    sport: "MLB",
    homeTeam: "New York Yankees",
    awayTeam: "Houston Astros",
    startTime: new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString(),
    team: "New York Yankees",
    betType: "over",
    bookmaker: "FanDuel",
    odds: -112,
    impliedProb: americanOddsToImplied(-112),
    modelProb: 0.553,
    edge: 4.3,
    kellyStake: kellyStake(0.553, -112),
    status: "upcoming",
  },
];

router.get("/dashboard/summary", (_req, res) => {
  res.json({
    liveGamesCount: 3,
    upcomingGamesCount: 4,
    totalValueBets: 8,
    avgEdge: 4.6,
    topValueBets,
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
  });
});

export default router;

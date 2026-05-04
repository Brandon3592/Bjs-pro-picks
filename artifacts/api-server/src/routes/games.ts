import { Router } from "express";
import { GetGamesQueryParams } from "@workspace/api-zod";

const router = Router();

const SPORTS = ["NFL", "NBA", "MLB", "NHL"] as const;
const BOOKMAKERS = ["DraftKings", "FanDuel", "BetMGM", "Caesars", "PointsBet"];

function generateMockGames() {
  const now = new Date();
  const games = [
    {
      id: "nfl-1",
      sport: "NFL",
      homeTeam: "Kansas City Chiefs",
      awayTeam: "Baltimore Ravens",
      homeScore: 21,
      awayScore: 17,
      startTime: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
      status: "live",
      quarter: "Q3",
      timeRemaining: "8:42",
      venue: "Arrowhead Stadium",
      weather: { temp: 58, condition: "Partly Cloudy", windSpeed: 12, precipitation: 0 },
      topEdge: 4.8,
    },
    {
      id: "nba-1",
      sport: "NBA",
      homeTeam: "Boston Celtics",
      awayTeam: "Golden State Warriors",
      homeScore: 88,
      awayScore: 82,
      startTime: new Date(now.getTime() - 1.5 * 60 * 60 * 1000).toISOString(),
      status: "live",
      quarter: "Q3",
      timeRemaining: "5:21",
      venue: "TD Garden",
      weather: null,
      topEdge: 6.2,
    },
    {
      id: "nfl-2",
      sport: "NFL",
      homeTeam: "Dallas Cowboys",
      awayTeam: "Philadelphia Eagles",
      homeScore: null,
      awayScore: null,
      startTime: new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString(),
      status: "upcoming",
      quarter: null,
      timeRemaining: null,
      venue: "AT&T Stadium",
      weather: { temp: 72, condition: "Clear", windSpeed: 8, precipitation: 0 },
      topEdge: 5.1,
    },
    {
      id: "nba-2",
      sport: "NBA",
      homeTeam: "Los Angeles Lakers",
      awayTeam: "Denver Nuggets",
      homeScore: null,
      awayScore: null,
      startTime: new Date(now.getTime() + 5 * 60 * 60 * 1000).toISOString(),
      status: "upcoming",
      quarter: null,
      timeRemaining: null,
      venue: "Crypto.com Arena",
      weather: null,
      topEdge: 3.7,
    },
    {
      id: "mlb-1",
      sport: "MLB",
      homeTeam: "New York Yankees",
      awayTeam: "Houston Astros",
      homeScore: null,
      awayScore: null,
      startTime: new Date(now.getTime() + 7 * 60 * 60 * 1000).toISOString(),
      status: "upcoming",
      quarter: null,
      timeRemaining: null,
      venue: "Yankee Stadium",
      weather: { temp: 65, condition: "Overcast", windSpeed: 15, precipitation: 20 },
      topEdge: 4.3,
    },
    {
      id: "nhl-1",
      sport: "NHL",
      homeTeam: "Colorado Avalanche",
      awayTeam: "Tampa Bay Lightning",
      homeScore: 2,
      awayScore: 1,
      startTime: new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString(),
      status: "live",
      quarter: "P2",
      timeRemaining: "12:33",
      venue: "Ball Arena",
      weather: null,
      topEdge: 3.9,
    },
    {
      id: "nfl-3",
      sport: "NFL",
      homeTeam: "San Francisco 49ers",
      awayTeam: "Seattle Seahawks",
      homeScore: 28,
      awayScore: 14,
      startTime: new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString(),
      status: "final",
      quarter: "Final",
      timeRemaining: null,
      venue: "Levi's Stadium",
      weather: { temp: 62, condition: "Foggy", windSpeed: 7, precipitation: 5 },
      topEdge: null,
    },
    {
      id: "mlb-2",
      sport: "MLB",
      homeTeam: "Los Angeles Dodgers",
      awayTeam: "Atlanta Braves",
      homeScore: null,
      awayScore: null,
      startTime: new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString(),
      status: "upcoming",
      quarter: null,
      timeRemaining: null,
      venue: "Dodger Stadium",
      weather: { temp: 78, condition: "Sunny", windSpeed: 5, precipitation: 0 },
      topEdge: 5.5,
    },
  ];
  return games;
}

router.get("/games", (req, res) => {
  const parsed = GetGamesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query params" });
  }
  const { sport, status } = parsed.data;
  let games = generateMockGames();
  if (sport !== "all") games = games.filter((g) => g.sport === sport);
  if (status !== "all") games = games.filter((g) => g.status === status);
  return res.json(games);
});

router.get("/games/:gameId", (req, res) => {
  const games = generateMockGames();
  const game = games.find((g) => g.id === req.params.gameId);
  if (!game) return res.status(404).json({ error: "Game not found" });

  const odds = BOOKMAKERS.map((bookmaker, i) => {
    const baseHome = -110 + (i * 5 - 10);
    const baseAway = 100 + (i * 5 - 10);
    return {
      id: `${game.id}-${bookmaker.toLowerCase().replace(/\s/g, "")}`,
      gameId: game.id,
      bookmaker,
      homeMoneyline: baseHome,
      awayMoneyline: baseAway,
      homeSpread: -3.5,
      awaySpread: 3.5,
      homeSpreadOdds: -110,
      awaySpreadOdds: -110,
      overUnder: 47.5,
      overOdds: -110,
      underOdds: -110,
      updatedAt: new Date().toISOString(),
    };
  });

  const prediction = {
    gameId: game.id,
    sport: game.sport,
    homeWinProb: 0.62,
    awayWinProb: 0.38,
    drawProb: null,
    edgeHome: game.topEdge ?? 0,
    edgeAway: -2.1,
    recommendedBet: `${game.homeTeam} ML`,
    recommendedBookmaker: "DraftKings",
    confidence: "high" as const,
    modelFactors: ["Home field advantage", "Recent form (6-2 last 8)", "Opponent injury: starting QB questionable", "Historical matchup: 7-3 ATS"],
    updatedAt: new Date().toISOString(),
  };

  const injuries = [
    { player: "Patrick Mahomes", team: game.homeTeam, status: "Active", position: "QB", impact: "low" as const },
    { player: "Travis Kelce", team: game.homeTeam, status: "Questionable", position: "TE", impact: "medium" as const },
    { player: "Lamar Jackson", team: game.awayTeam, status: "Active", position: "QB", impact: "low" as const },
    { player: "Mark Andrews", team: game.awayTeam, status: "Out", position: "TE", impact: "high" as const },
  ];

  return res.json({ game, odds, prediction, injuries });
});

export default router;

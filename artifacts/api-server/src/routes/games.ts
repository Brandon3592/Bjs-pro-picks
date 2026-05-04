import { Router } from "express";
import { GetGamesQueryParams } from "@workspace/api-zod";
import { fetchAllSportOdds, fetchAllSportScores, SPORT_KEYS, hasApiKey } from "../lib/odds-api";
import { gameStatus, consensusProb } from "../lib/model";

const router = Router();

// ─── Mock fallback ────────────────────────────────────────────────────────────

function generateMockGames() {
  const now = new Date();
  return [
    {
      id: "nfl-1", sport: "NFL", homeTeam: "Kansas City Chiefs", awayTeam: "Baltimore Ravens",
      homeScore: 21, awayScore: 17,
      startTime: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
      status: "live", quarter: "Q3", timeRemaining: "8:42",
      venue: "Arrowhead Stadium",
      weather: { temp: 58, condition: "Partly Cloudy", windSpeed: 12, precipitation: 0 },
      topEdge: 4.8,
    },
    {
      id: "nba-1", sport: "NBA", homeTeam: "Boston Celtics", awayTeam: "Golden State Warriors",
      homeScore: 88, awayScore: 82,
      startTime: new Date(now.getTime() - 1.5 * 60 * 60 * 1000).toISOString(),
      status: "live", quarter: "Q3", timeRemaining: "5:21",
      venue: "TD Garden", weather: null, topEdge: 6.2,
    },
    {
      id: "nfl-2", sport: "NFL", homeTeam: "Dallas Cowboys", awayTeam: "Philadelphia Eagles",
      homeScore: null, awayScore: null,
      startTime: new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString(),
      status: "upcoming", quarter: null, timeRemaining: null,
      venue: "AT&T Stadium",
      weather: { temp: 72, condition: "Clear", windSpeed: 8, precipitation: 0 },
      topEdge: 5.1,
    },
    {
      id: "nba-2", sport: "NBA", homeTeam: "Los Angeles Lakers", awayTeam: "Denver Nuggets",
      homeScore: null, awayScore: null,
      startTime: new Date(now.getTime() + 5 * 60 * 60 * 1000).toISOString(),
      status: "upcoming", quarter: null, timeRemaining: null,
      venue: "Crypto.com Arena", weather: null, topEdge: 3.7,
    },
    {
      id: "mlb-1", sport: "MLB", homeTeam: "New York Yankees", awayTeam: "Houston Astros",
      homeScore: null, awayScore: null,
      startTime: new Date(now.getTime() + 7 * 60 * 60 * 1000).toISOString(),
      status: "upcoming", quarter: null, timeRemaining: null,
      venue: "Yankee Stadium",
      weather: { temp: 65, condition: "Overcast", windSpeed: 15, precipitation: 20 },
      topEdge: 4.3,
    },
    {
      id: "nhl-1", sport: "NHL", homeTeam: "Colorado Avalanche", awayTeam: "Tampa Bay Lightning",
      homeScore: 2, awayScore: 1,
      startTime: new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString(),
      status: "live", quarter: "P2", timeRemaining: "12:33",
      venue: "Ball Arena", weather: null, topEdge: 3.9,
    },
    {
      id: "nfl-3", sport: "NFL", homeTeam: "San Francisco 49ers", awayTeam: "Seattle Seahawks",
      homeScore: 28, awayScore: 14,
      startTime: new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString(),
      status: "final", quarter: "Final", timeRemaining: null,
      venue: "Levi's Stadium",
      weather: { temp: 62, condition: "Foggy", windSpeed: 7, precipitation: 5 },
      topEdge: null,
    },
    {
      id: "mlb-2", sport: "MLB", homeTeam: "Los Angeles Dodgers", awayTeam: "Atlanta Braves",
      homeScore: null, awayScore: null,
      startTime: new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString(),
      status: "upcoming", quarter: null, timeRemaining: null,
      venue: "Dodger Stadium",
      weather: { temp: 78, condition: "Sunny", windSpeed: 5, precipitation: 0 },
      topEdge: 5.5,
    },
  ];
}

// ─── Real data transformation ─────────────────────────────────────────────────

async function getLiveGames() {
  if (!hasApiKey()) return generateMockGames();

  const [oddsData, scoresData] = await Promise.all([
    fetchAllSportOdds(),
    fetchAllSportScores(),
  ]);

  if (oddsData.every((d) => d.events.length === 0)) return generateMockGames();

  // Build a score lookup by event id
  const scoreMap = new Map<string, { homeScore: number | null; awayScore: number | null; completed: boolean }>();
  for (const { scores } of scoresData) {
    for (const ev of scores) {
      const home = ev.scores?.find((s) => s.name === ev.home_team);
      const away = ev.scores?.find((s) => s.name === ev.away_team);
      scoreMap.set(ev.id, {
        homeScore: home ? parseInt(home.score, 10) : null,
        awayScore: away ? parseInt(away.score, 10) : null,
        completed: ev.completed,
      });
    }
  }

  const games: ReturnType<typeof generateMockGames> = [];

  for (const { sport, events } of oddsData) {
    for (const ev of events) {
      const scores = scoreMap.get(ev.id);
      const status = scores?.completed ? "final" : gameStatus(ev);
      const cp = consensusProb(ev, "h2h");
      const topEdge = cp ? parseFloat(((Math.max(...cp) - 0.5) * 20).toFixed(1)) : null;

      games.push({
        id: ev.id,
        sport,
        homeTeam: ev.home_team,
        awayTeam: ev.away_team,
        homeScore: scores?.homeScore ?? null,
        awayScore: scores?.awayScore ?? null,
        startTime: ev.commence_time,
        status,
        quarter: null,
        timeRemaining: null,
        venue: null as unknown as string,
        weather: null,
        topEdge: status !== "final" ? topEdge : null,
      });
    }
  }

  return games.length > 0 ? games : generateMockGames();
}

// ─── Routes ───────────────────────────────────────────────────────────────────

router.get("/games", async (req, res) => {
  const parsed = GetGamesQueryParams.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Invalid query params" });
  const { sport, status } = parsed.data;

  let games = await getLiveGames();
  if (sport !== "all") games = games.filter((g) => g.sport === sport);
  if (status !== "all") games = games.filter((g) => g.status === status);
  return res.json(games);
});

router.get("/games/:gameId", async (req, res) => {
  const games = await getLiveGames();
  const game = games.find((g) => g.id === req.params.gameId);
  if (!game) return res.status(404).json({ error: "Game not found" });

  // Get bookmaker odds for this specific game
  if (hasApiKey()) {
    const sportKey = SPORT_KEYS[game.sport];
    const oddsData = await fetchAllSportOdds();
    const sportEvents = oddsData.find((d) => d.sport === game.sport)?.events ?? [];
    const ev = sportEvents.find((e) => e.id === game.id);

    if (ev) {
      const odds = ev.bookmakers.map((bk, i) => {
        const h2h = bk.markets.find((m) => m.key === "h2h");
        const spreads = bk.markets.find((m) => m.key === "spreads");
        const totals = bk.markets.find((m) => m.key === "totals");
        const homeML = h2h?.outcomes.find((o) => o.name === ev.home_team)?.price ?? null;
        const awayML = h2h?.outcomes.find((o) => o.name === ev.away_team)?.price ?? null;
        const homeSpread = spreads?.outcomes.find((o) => o.name === ev.home_team);
        const awaySpread = spreads?.outcomes.find((o) => o.name === ev.away_team);
        const over = totals?.outcomes.find((o) => o.name === "Over");
        const under = totals?.outcomes.find((o) => o.name === "Under");

        return {
          id: `${ev.id}-${bk.key}`,
          gameId: ev.id,
          bookmaker: bk.title,
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
        };
      });

      const cp = consensusProb(ev, "h2h");
      const [homeWinProb, awayWinProb] = cp ?? [0.5, 0.5];

      const prediction = {
        gameId: game.id,
        sport: game.sport,
        homeWinProb,
        awayWinProb,
        drawProb: null,
        edgeHome: game.topEdge ?? 0,
        edgeAway: game.topEdge ? -game.topEdge / 2 : 0,
        recommendedBet: homeWinProb > 0.55 ? `${game.homeTeam} ML` : homeWinProb < 0.45 ? `${game.awayTeam} ML` : "No strong edge",
        recommendedBookmaker: odds[0]?.bookmaker ?? null,
        confidence: (homeWinProb > 0.6 || homeWinProb < 0.4 ? "high" : homeWinProb > 0.55 || homeWinProb < 0.45 ? "medium" : "low") as "high" | "medium" | "low",
        modelFactors: ["Market consensus de-vig", "Cross-book line comparison", "Vig-adjusted true probability", "Sharp money movement"],
        updatedAt: new Date().toISOString(),
      };

      return res.json({ game, odds, prediction, injuries: [] });
    }
  }

  // Mock fallback for game detail
  const BOOKMAKERS = ["DraftKings", "FanDuel", "BetMGM", "Caesars", "PointsBet"];
  const odds = BOOKMAKERS.map((bookmaker, i) => ({
    id: `${game.id}-${bookmaker.toLowerCase().replace(/\s/g, "")}`,
    gameId: game.id,
    bookmaker,
    homeMoneyline: -110 + (i * 5 - 10),
    awayMoneyline: 100 + (i * 5 - 10),
    homeSpread: -3.5,
    awaySpread: 3.5,
    homeSpreadOdds: -110,
    awaySpreadOdds: -110,
    overUnder: 47.5,
    overOdds: -110,
    underOdds: -110,
    updatedAt: new Date().toISOString(),
  }));

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

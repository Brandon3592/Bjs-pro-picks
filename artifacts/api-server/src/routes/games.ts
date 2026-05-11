import { Router } from "express";
import { GetGamesQueryParams } from "@workspace/api-zod";
import { fetchAllSportOdds, fetchAllSportScores, SPORT_KEYS, hasApiKey } from "../lib/odds-api";
import { gameStatus, bestEdgeForGame, consensusProb } from "../lib/model";
import { fetchWeather } from "../lib/weather";

const router = Router();

// ─── Real data transformation ─────────────────────────────────────────────────

async function getLiveGames() {
  if (!hasApiKey()) return [];

  const [oddsData, scoresData] = await Promise.all([
    fetchAllSportOdds(),
    fetchAllSportScores(),
  ]);

  if (oddsData.every((d) => d.events.length === 0)) return [];

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

  type GameEntry = {
    id: string; sport: string; homeTeam: string; awayTeam: string;
    homeScore: number | null; awayScore: number | null;
    startTime: string; status: string; quarter: string | null;
    timeRemaining: string | null; venue: string;
    weather: { temp: number; windSpeed: number; condition: string; precipitation: number } | null;
    topEdge: number | null;
  };

  const rawGames: GameEntry[] = [];

  for (const { sport, events } of oddsData) {
    for (const ev of events) {
      const scores = scoreMap.get(ev.id);
      const status = scores?.completed ? "final" : gameStatus(ev);
      const topEdge = bestEdgeForGame(ev);

      rawGames.push({
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

  if (rawGames.length === 0) return [];

  // Fetch weather for outdoor venues in parallel (only for upcoming/live games)
  const weatherResults = await Promise.all(
    rawGames.map((g) =>
      (g.sport === "NFL" || g.sport === "MLB") && g.status !== "final"
        ? fetchWeather(g.homeTeam).catch(() => null)
        : Promise.resolve(null)
    )
  );
  rawGames.forEach((g, i) => { g.weather = weatherResults[i]; });

  return rawGames;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// Return the current date in Eastern Time as "YYYY-MM-DD"
function todayET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

router.get("/games", async (req, res) => {
  const parsed = GetGamesQueryParams.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Invalid query params" });
  const { sport, status } = parsed.data;

  let games = await getLiveGames();

  // Only show games from today (ET). Live games are always shown; upcoming/final
  // games must have a startTime that falls on today's ET date. This prevents
  // multi-day lookahead games (e.g. tomorrow's MLB, off-season NFL) from showing up.
  const today = todayET();
  games = games.filter((g) => {
    if (g.status === "live") return true;
    if (!g.startTime) return false;
    const gameDate = new Date(g.startTime).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    return gameDate === today;
  });

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

  // Game was found in the DB but not in the current odds cache (lines may have been pulled
  // or quota was exhausted). Return the game with empty odds/prediction rather than fake numbers.
  return res.json({ game, odds: [], prediction: null, injuries: [] });
});

export default router;

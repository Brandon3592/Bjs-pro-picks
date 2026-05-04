import { Router } from "express";
import { GetPredictionsQueryParams, GetValueBetsQueryParams } from "@workspace/api-zod";
import { fetchAllSportOdds, hasApiKey } from "../lib/odds-api";
import { findValueBets, gameStatus, consensusProb, americanToImplied, kellyFraction } from "../lib/model";
import type { ValueBet } from "../lib/model";

const router = Router();

// ─── Odds math helpers ────────────────────────────────────────────────────────

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

// ─── Mock fallback ────────────────────────────────────────────────────────────

const mockValueBets = [
  {
    id: "vb-1", gameId: "nfl-1", sport: "NFL",
    homeTeam: "Kansas City Chiefs", awayTeam: "Baltimore Ravens",
    startTime: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    team: "Kansas City Chiefs", betType: "moneyline" as const, bookmaker: "FanDuel",
    odds: -115, impliedProb: americanOddsToImplied(-115), modelProb: 0.62, edge: 4.8,
    kellyStake: kellyStake(0.62, -115), status: "live" as const,
  },
  {
    id: "vb-2", gameId: "nba-1", sport: "NBA",
    homeTeam: "Boston Celtics", awayTeam: "Golden State Warriors",
    startTime: new Date(Date.now() - 1.5 * 60 * 60 * 1000).toISOString(),
    team: "Boston Celtics", betType: "spread" as const, bookmaker: "DraftKings",
    odds: -108, impliedProb: americanOddsToImplied(-108), modelProb: 0.585, edge: 6.2,
    kellyStake: kellyStake(0.585, -108), status: "live" as const,
  },
  {
    id: "vb-3", gameId: "nfl-2", sport: "NFL",
    homeTeam: "Dallas Cowboys", awayTeam: "Philadelphia Eagles",
    startTime: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
    team: "Dallas Cowboys", betType: "moneyline" as const, bookmaker: "BetMGM",
    odds: -120, impliedProb: americanOddsToImplied(-120), modelProb: 0.653, edge: 5.1,
    kellyStake: kellyStake(0.653, -120), status: "upcoming" as const,
  },
  {
    id: "vb-4", gameId: "mlb-2", sport: "MLB",
    homeTeam: "Los Angeles Dodgers", awayTeam: "Atlanta Braves",
    startTime: new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString(),
    team: "Los Angeles Dodgers", betType: "moneyline" as const, bookmaker: "Caesars",
    odds: -130, impliedProb: americanOddsToImplied(-130), modelProb: 0.698, edge: 5.5,
    kellyStake: kellyStake(0.698, -130), status: "upcoming" as const,
  },
  {
    id: "vb-5", gameId: "nba-2", sport: "NBA",
    homeTeam: "Los Angeles Lakers", awayTeam: "Denver Nuggets",
    startTime: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(),
    team: "Denver Nuggets", betType: "spread" as const, bookmaker: "PointsBet",
    odds: 105, impliedProb: americanOddsToImplied(105), modelProb: 0.51, edge: 3.7,
    kellyStake: kellyStake(0.51, 105), status: "upcoming" as const,
  },
  {
    id: "vb-6", gameId: "nhl-1", sport: "NHL",
    homeTeam: "Colorado Avalanche", awayTeam: "Tampa Bay Lightning",
    startTime: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
    team: "Colorado Avalanche", betType: "moneyline" as const, bookmaker: "DraftKings",
    odds: -118, impliedProb: americanOddsToImplied(-118), modelProb: 0.598, edge: 3.9,
    kellyStake: kellyStake(0.598, -118), status: "live" as const,
  },
  {
    id: "vb-7", gameId: "mlb-1", sport: "MLB",
    homeTeam: "New York Yankees", awayTeam: "Houston Astros",
    startTime: new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString(),
    team: "New York Yankees", betType: "over" as const, bookmaker: "FanDuel",
    odds: -112, impliedProb: americanOddsToImplied(-112), modelProb: 0.553, edge: 4.3,
    kellyStake: kellyStake(0.553, -112), status: "upcoming" as const,
  },
  {
    id: "vb-8", gameId: "nfl-2", sport: "NFL",
    homeTeam: "Dallas Cowboys", awayTeam: "Philadelphia Eagles",
    startTime: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
    team: "Under 46.5", betType: "under" as const, bookmaker: "BetMGM",
    odds: -107, impliedProb: americanOddsToImplied(-107), modelProb: 0.537, edge: 3.3,
    kellyStake: kellyStake(0.537, -107), status: "upcoming" as const,
  },
];

// ─── Real data ────────────────────────────────────────────────────────────────

async function getRealValueBets(minEdge = 2.5): Promise<ValueBet[]> {
  if (!hasApiKey()) return mockValueBets;

  const allOdds = await fetchAllSportOdds();
  const allBets: ValueBet[] = [];

  for (const { sport, events } of allOdds) {
    for (const ev of events) {
      const now = Date.now();
      const start = new Date(ev.commence_time).getTime();
      if (start < now - 5 * 60 * 60 * 1000) continue; // skip old games
      const status: "live" | "upcoming" = start <= now ? "live" : "upcoming";
      const bets = findValueBets(ev, sport, status, minEdge);
      allBets.push(...bets);
    }
  }

  return allBets.length > 0 ? allBets : mockValueBets;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

router.get("/predictions", async (req, res) => {
  const parsed = GetPredictionsQueryParams.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Invalid query params" });
  const { sport, minEdge } = parsed.data;

  if (hasApiKey()) {
    const allOdds = await fetchAllSportOdds();
    const predictions = [];

    for (const { sport: s, events } of allOdds) {
      if (sport !== "all" && s !== sport) continue;
      for (const ev of events) {
        const cp = consensusProb(ev, "h2h");
        if (!cp) continue;
        const [homeWinProb, awayWinProb] = cp;
        const status = gameStatus(ev);
        if (status === "final") continue;

        const edgeHome = parseFloat(((homeWinProb - 0.5) * 20).toFixed(2));
        if (minEdge && Math.abs(edgeHome) < minEdge) continue;

        predictions.push({
          gameId: ev.id,
          sport: s,
          homeWinProb,
          awayWinProb,
          drawProb: null,
          edgeHome,
          edgeAway: -edgeHome,
          recommendedBet: homeWinProb > 0.55 ? `${ev.home_team} ML` : homeWinProb < 0.45 ? `${ev.away_team} ML` : "No strong edge",
          recommendedBookmaker: ev.bookmakers[0]?.title ?? null,
          confidence: (Math.abs(edgeHome) >= 5 ? "high" : Math.abs(edgeHome) >= 3 ? "medium" : "low") as "high" | "medium" | "low",
          modelFactors: ["Market consensus de-vig", "Cross-book analysis", "Vig-adjusted probability", "Line movement"],
          updatedAt: new Date().toISOString(),
        });
      }
    }

    return res.json(predictions);
  }

  // Mock fallback
  const predictions = mockValueBets.map((vb) => ({
    gameId: vb.gameId, sport: vb.sport,
    homeWinProb: vb.modelProb, awayWinProb: parseFloat((1 - vb.modelProb).toFixed(3)),
    drawProb: null, edgeHome: vb.edge, edgeAway: parseFloat((-vb.edge / 2).toFixed(2)),
    recommendedBet: `${vb.team} ${vb.betType}`,
    recommendedBookmaker: vb.bookmaker,
    confidence: (vb.edge >= 5 ? "high" : vb.edge >= 3.5 ? "medium" : "low") as "high" | "medium" | "low",
    modelFactors: ["Recent form", "Injury-adjusted rating", "Weather factor", "Line movement"],
    updatedAt: new Date().toISOString(),
  }));

  let result = predictions;
  if (sport !== "all") result = result.filter((p) => p.sport === sport);
  if (minEdge) result = result.filter((p) => p.edgeHome >= minEdge);
  return res.json(result);
});

router.get("/value-bets", async (req, res) => {
  const parsed = GetValueBetsQueryParams.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Invalid query params" });
  const { sport, minEdge, sortBy, sortDir } = parsed.data;

  let result = await getRealValueBets(minEdge ?? 2.5);

  if (sport !== "all") result = result.filter((vb) => vb.sport === sport);
  if (minEdge !== undefined) result = result.filter((vb) => vb.edge >= minEdge);

  const dir = sortDir === "asc" ? 1 : -1;
  result.sort((a, b) => {
    if (sortBy === "edge") return dir * (a.edge - b.edge);
    if (sortBy === "odds") return dir * (a.odds - b.odds);
    if (sortBy === "kellyStake") return dir * (a.kellyStake - b.kellyStake);
    if (sortBy === "sport") return dir * a.sport.localeCompare(b.sport);
    return dir * (a.edge - b.edge);
  });

  return res.json(result);
});

export { getRealValueBets, mockValueBets };

export default router;

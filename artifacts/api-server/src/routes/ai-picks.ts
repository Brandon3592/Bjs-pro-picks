import { Router } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import { fetchAllSportOdds, hasApiKey } from "../lib/odds-api";
import { getRealValueBets } from "./predictions";
import { consensusProb, americanToDecimal, decimalToAmerican } from "../lib/model";
import type { OddsEvent } from "../lib/odds-api";

const router = Router();

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AIPickLeg {
  gameId: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  pick: string;
  betType: string;
  bookmaker: string;
  odds: number;
}

export interface AIPick extends AIPickLeg {
  id: string;
  confidence: number;
  edge: number;
  reasoning: string;
  tags: string[];
}

export interface AIParlay {
  id: string;
  name: string;
  legs: AIPickLeg[];
  combinedOdds: number;
  confidence: number;
  reasoning: string;
}

export interface AIPicksResponse {
  picks: AIPick[];
  parlays: AIParlay[];
  summary: string;
  generatedAt: string;
  isAI: boolean;
}

// ─── Cache ────────────────────────────────────────────────────────────────────

let picksCache: { data: AIPicksResponse; expiresAt: number } | null = null;
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getBestOdds(event: OddsEvent, marketKey: string, outcomeName: string): { bookmaker: string; odds: number } | null {
  let best: { bookmaker: string; odds: number } | null = null;
  for (const bk of event.bookmakers) {
    const market = bk.markets.find((m) => m.key === marketKey);
    if (!market) continue;
    const outcome = market.outcomes.find((o) =>
      marketKey === "totals"
        ? o.name.toLowerCase() === outcomeName.toLowerCase()
        : o.name === outcomeName
    );
    if (!outcome) continue;
    if (!best || outcome.price > best.odds) {
      best = { bookmaker: bk.title, odds: outcome.price };
    }
  }
  return best;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours() % 12 || 12;
  const m = d.getMinutes().toString().padStart(2, "0");
  const ampm = d.getHours() >= 12 ? "PM" : "AM";
  return `${h}:${m} ${ampm} ET`;
}

function calcCombinedOdds(legs: AIPickLeg[]): number {
  const combined = legs.reduce((acc, leg) => acc * americanToDecimal(leg.odds), 1);
  return decimalToAmerican(combined);
}

function buildCompactGameData(events: { sport: string; events: OddsEvent[] }[]): object[] {
  const now = Date.now();
  const games: object[] = [];

  for (const { sport, events: evs } of events) {
    const upcoming = evs
      .filter((e) => new Date(e.commence_time).getTime() > now - 4 * 3600_000)
      .slice(0, 3); // max 3 per sport

    for (const ev of upcoming) {
      const mlHome = getBestOdds(ev, "h2h", ev.home_team);
      const mlAway = getBestOdds(ev, "h2h", ev.away_team);
      const over = getBestOdds(ev, "totals", "Over");
      const under = getBestOdds(ev, "totals", "Under");
      const cp = consensusProb(ev, "h2h");

      games.push({
        id: ev.id,
        sport,
        home: ev.home_team,
        away: ev.away_team,
        time: formatTime(ev.commence_time),
        homeWinProb: cp ? Math.round(cp[0] * 100) : null,
        awayWinProb: cp ? Math.round(cp[1] * 100) : null,
        ml: mlHome && mlAway ? { home: { odds: mlHome.odds, book: mlHome.bookmaker }, away: { odds: mlAway.odds } } : null,
        total: over && under ? { over: over.odds, under: under.odds, book: over.bookmaker } : null,
      });
    }
  }
  return games;
}

const SYSTEM_PROMPT = `You are an expert sports betting analyst. Given today's game data with consensus win probabilities and best available odds, identify top betting opportunities.

Return a JSON object (no markdown, no code blocks) with this exact structure:
{"picks":[{"id":"p1","gameId":"...","sport":"NBA","homeTeam":"...","awayTeam":"...","startTime":"ISO","pick":"Team ML","betType":"moneyline","bookmaker":"DraftKings","odds":-110,"confidence":72,"edge":3.2,"reasoning":"2 sentence reason","tags":["home_advantage"]}],"parlays":[{"id":"pl1","name":"name","legs":[{"gameId":"...","sport":"NBA","homeTeam":"...","awayTeam":"...","startTime":"ISO","pick":"...","betType":"moneyline","bookmaker":"DraftKings","odds":-110}],"combinedOdds":250,"confidence":55,"reasoning":"why these legs work together"}],"summary":"1 sentence overview"}

Rules: 5-7 picks, 2-3 parlays (2-3 legs each), parlays from different games, confidence 50-90, edge 0.5-8.0, betType one of moneyline/spread/over/under.`;

// ─── Fallback mock ────────────────────────────────────────────────────────────

function buildFallbackPicks(): AIPicksResponse {
  const picks: AIPick[] = [
    {
      id: "mock-1", gameId: "nba-mock-1", sport: "NBA",
      homeTeam: "New York Knicks", awayTeam: "Philadelphia 76ers",
      startTime: new Date(Date.now() + 4 * 3600_000).toISOString(),
      pick: "Knicks -4.5", betType: "spread", bookmaker: "DraftKings", odds: -108,
      confidence: 68, edge: 2.8,
      reasoning: "Knicks hold a strong home advantage at MSG and have covered the spread in 7 of their last 10 home games. 76ers are dealing with key rotation injuries.",
      tags: ["home_advantage", "line_value"],
    },
    {
      id: "mock-2", gameId: "mlb-mock-1", sport: "MLB",
      homeTeam: "Los Angeles Dodgers", awayTeam: "Atlanta Braves",
      startTime: new Date(Date.now() + 6 * 3600_000).toISOString(),
      pick: "Under 8.5", betType: "under", bookmaker: "FanDuel", odds: -112,
      confidence: 63, edge: 2.1,
      reasoning: "Both starting pitchers are elite with sub-3.00 ERA this season. Dodger Stadium plays large and suppresses run scoring in night games.",
      tags: ["total_value", "pitcher_matchup"],
    },
    {
      id: "mock-3", gameId: "nba-mock-2", sport: "NBA",
      homeTeam: "Oklahoma City Thunder", awayTeam: "Los Angeles Lakers",
      startTime: new Date(Date.now() + 7 * 3600_000).toISOString(),
      pick: "Thunder ML", betType: "moneyline", bookmaker: "BetMGM", odds: -140,
      confidence: 74, edge: 3.5,
      reasoning: "OKC is the top seed in the West and defensively elite at home. The Lakers are a heavy underdog and short on rest after back-to-back games.",
      tags: ["home_advantage", "consensus_pick"],
    },
    {
      id: "mock-4", gameId: "mlb-mock-2", sport: "MLB",
      homeTeam: "Colorado Rockies", awayTeam: "New York Mets",
      startTime: new Date(Date.now() + 2 * 3600_000).toISOString(),
      pick: "Mets ML", betType: "moneyline", bookmaker: "FanDuel", odds: +128,
      confidence: 58, edge: 3.2,
      reasoning: "Mets are getting underdog value at Coors Field. Their offense has excellent plate discipline and the Rockies bullpen ranks 28th in ERA over the last 14 days.",
      tags: ["underdog_value", "bullpen_edge"],
    },
    {
      id: "mock-5", gameId: "nba-mock-3", sport: "NBA",
      homeTeam: "Cleveland Cavaliers", awayTeam: "Detroit Pistons",
      startTime: new Date(Date.now() + 8 * 3600_000).toISOString(),
      pick: "Over 218.5", betType: "over", bookmaker: "DraftKings", odds: -105,
      confidence: 61, edge: 1.9,
      reasoning: "Both teams rank in the top 10 for pace of play this postseason. Cleveland's uptempo offense and Detroit's inability to contain pick-and-roll sets up a high-scoring game.",
      tags: ["total_value", "pace_edge"],
    },
  ];

  const parlays: AIParlay[] = [
    {
      id: "parlay-1",
      name: "Evening NBA Value Parlay",
      legs: [picks[0], picks[2]].map((p) => ({
        gameId: p.gameId, sport: p.sport, homeTeam: p.homeTeam, awayTeam: p.awayTeam,
        startTime: p.startTime, pick: p.pick, betType: p.betType, bookmaker: p.bookmaker, odds: p.odds,
      })),
      combinedOdds: calcCombinedOdds([picks[0], picks[2]]),
      confidence: 55,
      reasoning: "Two strong home favorites defending their home court. Both spreads show genuine value vs consensus win probability. A $100 bet returns ~$230.",
    },
    {
      id: "parlay-2",
      name: "3-Leg Cross-Sport Parlay",
      legs: [picks[2], picks[1], picks[4]].map((p) => ({
        gameId: p.gameId, sport: p.sport, homeTeam: p.homeTeam, awayTeam: p.awayTeam,
        startTime: p.startTime, pick: p.pick, betType: p.betType, bookmaker: p.bookmaker, odds: p.odds,
      })),
      combinedOdds: calcCombinedOdds([picks[2], picks[1], picks[4]]),
      confidence: 46,
      reasoning: "Combining OKC's dominant home win with an MLB under on a prime pitcher matchup and an NBA pace-driven over. All three legs have independent value.",
    },
  ];

  return {
    picks,
    parlays,
    summary: "Today features 20 games across NBA, MLB, and NHL. Strong home-court narratives in the NBA playoffs and quality pitcher matchups in MLB create solid single-bet value.",
    generatedAt: new Date().toISOString(),
    isAI: false,
  };
}

// ─── Route ────────────────────────────────────────────────────────────────────

router.get("/ai-picks", async (req, res) => {
  // Return cache if fresh
  if (picksCache && Date.now() < picksCache.expiresAt) {
    return res.json(picksCache.data);
  }

  try {
    // Gather today's data in parallel
    const [allOdds, valueBets] = await Promise.all([
      fetchAllSportOdds(),
      getRealValueBets(0),
    ]);

    const gameData = buildCompactGameData(allOdds);
    const valueBetData = valueBets.slice(0, 5).map((vb) => ({
      gameId: vb.gameId, sport: vb.sport, away: vb.awayTeam, home: vb.homeTeam,
      pick: vb.team, betType: vb.betType, book: vb.bookmaker, odds: vb.odds, edge: vb.edge,
    }));

    const userPrompt = `Date: ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
Games: ${JSON.stringify(gameData)}
Value bets detected: ${JSON.stringify(valueBetData)}
Generate picks and parlays.`;

    const response = await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    });

    const raw = response.choices[0]?.message?.content;
    req.log.info({ finish: response.choices[0]?.finish_reason, len: raw?.length }, "AI picks raw response");
    if (!raw) throw new Error("Empty AI response");

    // Strip markdown code fences if present
    const jsonStr = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    const parsed = JSON.parse(jsonStr) as { picks: AIPick[]; parlays: AIParlay[]; summary: string };

    // Recalculate combined odds to ensure accuracy
    for (const parlay of parsed.parlays ?? []) {
      if (parlay.legs?.length >= 2) {
        parlay.combinedOdds = calcCombinedOdds(parlay.legs);
      }
    }

    const result: AIPicksResponse = {
      picks: parsed.picks ?? [],
      parlays: parsed.parlays ?? [],
      summary: parsed.summary ?? "",
      generatedAt: new Date().toISOString(),
      isAI: true,
    };

    picksCache = { data: result, expiresAt: Date.now() + CACHE_TTL };
    return res.json(result);

  } catch (err) {
    req.log.error({ err }, "AI picks generation failed, using fallback");
    const fallback = buildFallbackPicks();
    picksCache = { data: fallback, expiresAt: Date.now() + 10 * 60_000 }; // shorter cache for fallback
    return res.json(fallback);
  }
});

// Force refresh (invalidates cache)
router.post("/ai-picks/refresh", (_req, res) => {
  picksCache = null;
  return res.json({ ok: true });
});

export default router;

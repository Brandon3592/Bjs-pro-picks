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
  player?: string | null;
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
  lockOfTheDay: AIPick | null;
  safeParlay: AIParlay | null;
  lottoParlay: AIParlay | null;
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
      .slice(0, 4); // max 4 per sport

    for (const ev of upcoming) {
      const mlHome = getBestOdds(ev, "h2h", ev.home_team);
      const mlAway = getBestOdds(ev, "h2h", ev.away_team);
      const over = getBestOdds(ev, "totals", "Over");
      const under = getBestOdds(ev, "totals", "Under");

      // Gather spreads
      let spreadHome: { odds: number; points: number } | null = null;
      let spreadAway: { odds: number; points: number } | null = null;
      for (const bk of ev.bookmakers) {
        const mkt = bk.markets.find((m) => m.key === "spreads");
        if (!mkt) continue;
        const ho = mkt.outcomes.find((o) => o.name === ev.home_team);
        const ao = mkt.outcomes.find((o) => o.name === ev.away_team);
        if (ho && ao && (!spreadHome || ho.price > (spreadHome?.odds ?? -999))) {
          spreadHome = { odds: ho.price, points: ho.point ?? 0 };
          spreadAway = { odds: ao.price, points: ao.point ?? 0 };
        }
      }

      const cp = consensusProb(ev, "h2h");
      games.push({
        id: ev.id,
        sport,
        home: ev.home_team,
        away: ev.away_team,
        time: formatTime(ev.commence_time),
        homeWinProb: cp ? Math.round(cp[0] * 100) : null,
        awayWinProb: cp ? Math.round(cp[1] * 100) : null,
        ml: mlHome && mlAway ? { home: { odds: mlHome.odds, book: mlHome.bookmaker }, away: { odds: mlAway.odds, book: mlAway.bookmaker } } : null,
        spread: spreadHome && spreadAway ? { home: spreadHome, away: spreadAway } : null,
        total: over && under ? { line: null, over: over.odds, under: under.odds, book: over.bookmaker } : null,
      });
    }
  }
  return games;
}

const SYSTEM_PROMPT = `You are an elite sports betting analyst. Given today's games with consensus win probabilities, best odds, and detected value bets, generate three distinct betting recommendations.

Return a JSON object (no markdown, no code blocks) with EXACTLY this structure:
{
  "lockOfTheDay": {
    "id": "lock-1",
    "gameId": "...",
    "sport": "NBA",
    "homeTeam": "...",
    "awayTeam": "...",
    "startTime": "ISO",
    "pick": "e.g. LeBron James Over 25.5 Points",
    "betType": "player_prop",
    "player": "LeBron James",
    "bookmaker": "FanDuel",
    "odds": -115,
    "confidence": 78,
    "edge": 4.2,
    "reasoning": "2-3 sentence deep analysis of why this is the single best bet today.",
    "tags": ["home_advantage", "line_value"]
  },
  "safeParlay": {
    "id": "safe-1",
    "name": "Safe 2-Leg Parlay",
    "legs": [
      { "gameId": "...", "sport": "NBA", "homeTeam": "...", "awayTeam": "...", "startTime": "ISO", "pick": "...", "betType": "moneyline", "bookmaker": "DraftKings", "odds": -130 },
      { "gameId": "...", "sport": "MLB", "homeTeam": "...", "awayTeam": "...", "startTime": "ISO", "pick": "...", "betType": "over", "bookmaker": "BetMGM", "odds": -110 }
    ],
    "combinedOdds": 220,
    "confidence": 62,
    "reasoning": "2 sentence explanation of why these legs complement each other well."
  },
  "lottoParlay": {
    "id": "lotto-1",
    "name": "Lotto 5-Leg Parlay",
    "legs": [5 legs from different games],
    "combinedOdds": 1800,
    "confidence": 28,
    "reasoning": "1-2 sentences on the upside and why each leg has merit."
  },
  "summary": "1 sentence overview of today's slate and best opportunities."
}

Rules:
- Lock of the Day: Your SINGLE highest-confidence pick. Can be moneyline, spread, total, OR player prop. Pick the absolute best opportunity.
- Safe Parlay: Exactly 2-3 legs from DIFFERENT games. Target combined odds of +175 to +500. All legs must be solid value.
- Lotto Parlay: Exactly 4-6 legs from DIFFERENT games. Target combined odds of +800 to +3000. Higher risk, big payout.
- Player props are welcome — use betType "player_prop" and include player name in "player" field and "pick" text.
- betType options: moneyline, spread, over, under, player_prop
- Confidence range: 25-90. Edge range: 0.5-9.0.
- Use real team/player names from the game data provided.
- ALL legs in a parlay must come from DIFFERENT games (never two legs from same game).`;

// ─── Fallback mock ────────────────────────────────────────────────────────────

function buildFallbackPicks(): AIPicksResponse {
  const now = Date.now();

  const lockOfTheDay: AIPick = {
    id: "lock-1",
    gameId: "nba-mock-1",
    sport: "NBA",
    homeTeam: "Oklahoma City Thunder",
    awayTeam: "Dallas Mavericks",
    startTime: new Date(now + 5 * 3600_000).toISOString(),
    pick: "Shai Gilgeous-Alexander Over 29.5 Points",
    betType: "player_prop",
    player: "Shai Gilgeous-Alexander",
    bookmaker: "FanDuel",
    odds: -115,
    confidence: 79,
    edge: 4.8,
    reasoning: "SGA has scored 30+ in 6 of his last 8 home games and is averaging 35.1 PPG over the last two weeks. The Mavericks allow the 5th-most points to opposing guards this season, and OKC's pace at home accelerates volume. This line is mispriced given his recent run.",
    tags: ["player_prop", "recent_form", "favorable_matchup"],
  };

  const safeParlayLeg1: AIPickLeg = {
    gameId: "nba-mock-1",
    sport: "NBA",
    homeTeam: "Oklahoma City Thunder",
    awayTeam: "Dallas Mavericks",
    startTime: new Date(now + 5 * 3600_000).toISOString(),
    pick: "Thunder ML",
    betType: "moneyline",
    bookmaker: "DraftKings",
    odds: -145,
  };

  const safeParlayLeg2: AIPickLeg = {
    gameId: "mlb-mock-1",
    sport: "MLB",
    homeTeam: "Los Angeles Dodgers",
    awayTeam: "Atlanta Braves",
    startTime: new Date(now + 3 * 3600_000).toISOString(),
    pick: "Under 8.5",
    betType: "under",
    bookmaker: "BetMGM",
    odds: -112,
  };

  const safeParlay: AIParlay = {
    id: "safe-1",
    name: "Lock & Under 2-Legger",
    legs: [safeParlayLeg1, safeParlayLeg2],
    combinedOdds: calcCombinedOdds([safeParlayLeg1, safeParlayLeg2]),
    confidence: 60,
    reasoning: "OKC is the league's best home team this season and should handle Dallas comfortably. The Dodgers-Braves matchup features two elite starters that suppress run scoring, making the under the smart play.",
  };

  const lottoLegs: AIPickLeg[] = [
    {
      gameId: "nba-mock-2",
      sport: "NBA",
      homeTeam: "Cleveland Cavaliers",
      awayTeam: "Miami Heat",
      startTime: new Date(now + 6 * 3600_000).toISOString(),
      pick: "Cavaliers -5.5",
      betType: "spread",
      bookmaker: "FanDuel",
      odds: -108,
    },
    {
      gameId: "mlb-mock-2",
      sport: "MLB",
      homeTeam: "New York Mets",
      awayTeam: "Colorado Rockies",
      startTime: new Date(now + 2 * 3600_000).toISOString(),
      pick: "Mets ML",
      betType: "moneyline",
      bookmaker: "FanDuel",
      odds: +128,
    },
    {
      gameId: "nhl-mock-1",
      sport: "NHL",
      homeTeam: "Florida Panthers",
      awayTeam: "Toronto Maple Leafs",
      startTime: new Date(now + 7 * 3600_000).toISOString(),
      pick: "Panthers ML",
      betType: "moneyline",
      bookmaker: "BetMGM",
      odds: -120,
    },
    {
      gameId: "nba-mock-3",
      sport: "NBA",
      homeTeam: "Boston Celtics",
      awayTeam: "New York Knicks",
      startTime: new Date(now + 8 * 3600_000).toISOString(),
      pick: "Over 215.5",
      betType: "over",
      bookmaker: "DraftKings",
      odds: -105,
    },
    {
      gameId: "mlb-mock-3",
      sport: "MLB",
      homeTeam: "Houston Astros",
      awayTeam: "Seattle Mariners",
      startTime: new Date(now + 4 * 3600_000).toISOString(),
      pick: "Astros ML",
      betType: "moneyline",
      bookmaker: "DraftKings",
      odds: -130,
    },
  ];

  const lottoParlay: AIParlay = {
    id: "lotto-1",
    name: "5-Leg Cross-Sport Lottery",
    legs: lottoLegs,
    combinedOdds: calcCombinedOdds(lottoLegs),
    confidence: 26,
    reasoning: "Five independent legs across NBA, MLB, and NHL with each carrying genuine standalone value. A $10 ticket wins big if all five hit — best for entertainment with upside.",
  };

  return {
    lockOfTheDay,
    safeParlay,
    lottoParlay,
    summary: "Today's slate features strong home-team narratives in the NBA playoffs, elite pitcher matchups in MLB, and a standout player prop opportunity on SGA.",
    generatedAt: new Date().toISOString(),
    isAI: false,
  };
}

// ─── Route ────────────────────────────────────────────────────────────────────

router.get("/ai-picks", async (req, res) => {
  if (picksCache && Date.now() < picksCache.expiresAt) {
    return res.json(picksCache.data);
  }

  try {
    const [allOdds, valueBets] = await Promise.all([
      fetchAllSportOdds(),
      getRealValueBets(0),
    ]);

    const gameData = buildCompactGameData(allOdds);
    const valueBetData = valueBets.slice(0, 8).map((vb) => ({
      gameId: vb.gameId, sport: vb.sport, away: vb.awayTeam, home: vb.homeTeam,
      pick: vb.team, betType: vb.betType, book: vb.bookmaker, odds: vb.odds, edge: vb.edge,
    }));

    const userPrompt = `Date: ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" })}
Games: ${JSON.stringify(gameData)}
Value bets detected by model: ${JSON.stringify(valueBetData)}
Generate the lockOfTheDay, safeParlay, and lottoParlay. Include at least one player prop pick if the data supports it.`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    });

    const raw = response.choices[0]?.message?.content;
    req.log.info({ finish: response.choices[0]?.finish_reason, len: raw?.length }, "AI picks raw response");
    if (!raw) throw new Error("Empty AI response");

    const jsonStr = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    const parsed = JSON.parse(jsonStr) as {
      lockOfTheDay: AIPick;
      safeParlay: AIParlay;
      lottoParlay: AIParlay;
      summary: string;
    };

    // Recalculate combined odds server-side for accuracy
    if (parsed.safeParlay?.legs?.length >= 2) {
      parsed.safeParlay.combinedOdds = calcCombinedOdds(parsed.safeParlay.legs);
    }
    if (parsed.lottoParlay?.legs?.length >= 2) {
      parsed.lottoParlay.combinedOdds = calcCombinedOdds(parsed.lottoParlay.legs);
    }

    // Ensure IDs
    if (parsed.lockOfTheDay && !parsed.lockOfTheDay.id) parsed.lockOfTheDay.id = "lock-1";
    if (parsed.safeParlay && !parsed.safeParlay.id) parsed.safeParlay.id = "safe-1";
    if (parsed.lottoParlay && !parsed.lottoParlay.id) parsed.lottoParlay.id = "lotto-1";

    const result: AIPicksResponse = {
      lockOfTheDay: parsed.lockOfTheDay ?? null,
      safeParlay: parsed.safeParlay ?? null,
      lottoParlay: parsed.lottoParlay ?? null,
      summary: parsed.summary ?? "",
      generatedAt: new Date().toISOString(),
      isAI: true,
    };

    picksCache = { data: result, expiresAt: Date.now() + CACHE_TTL };
    return res.json(result);

  } catch (err) {
    req.log.error({ err }, "AI picks generation failed, using fallback");
    const fallback = buildFallbackPicks();
    picksCache = { data: fallback, expiresAt: Date.now() + 10 * 60_000 };
    return res.json(fallback);
  }
});

// Force refresh
router.post("/ai-picks/refresh", (_req, res) => {
  picksCache = null;
  return res.json({ ok: true });
});

export default router;

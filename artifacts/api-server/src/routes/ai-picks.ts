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
  gameParlayOfTheDay: AIParlay | null;
  propParlayOfTheDay: AIParlay | null;
  mixParlayOfTheDay: AIParlay | null;
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

const SYSTEM_PROMPT = `You are an elite sports betting analyst. Given today's games with consensus win probabilities, best odds, and detected value bets, generate SIX distinct betting recommendations.

Return a JSON object (no markdown, no code blocks) with EXACTLY this structure:
{
  "lockOfTheDay": {
    "id": "lock-1",
    "gameId": "...", "sport": "NBA", "homeTeam": "...", "awayTeam": "...", "startTime": "ISO",
    "pick": "e.g. LeBron James Over 25.5 Points", "betType": "player_prop", "player": "LeBron James",
    "bookmaker": "FanDuel", "odds": -115, "confidence": 78, "edge": 4.2,
    "reasoning": "2-3 sentence deep analysis.", "tags": ["home_advantage"]
  },
  "safeParlay": {
    "id": "safe-1", "name": "Safe 2-Leg Parlay",
    "legs": [2-3 legs, NO player props, only moneyline/spread/over/under, all from DIFFERENT games],
    "combinedOdds": 220, "confidence": 62,
    "reasoning": "Why these legs work together."
  },
  "lottoParlay": {
    "id": "lotto-1", "name": "Lotto 5-Leg Parlay",
    "legs": [4-6 legs, mix of any bet type, all from DIFFERENT games],
    "combinedOdds": 1800, "confidence": 28,
    "reasoning": "Upside and why each leg has merit."
  },
  "gameParlayOfTheDay": {
    "id": "game-1", "name": "Game Picks 3-Leg Parlay",
    "legs": [3-4 legs, ONLY moneyline/spread/over/under — NO player props, all from DIFFERENT games],
    "combinedOdds": 450, "confidence": 48,
    "reasoning": "Why these game-line legs complement each other."
  },
  "propParlayOfTheDay": {
    "id": "prop-1", "name": "Player Props 3-Leg Parlay",
    "legs": [3-4 legs, ALL must be player_prop betType, include player name in leg, legs can be from same or different games],
    "combinedOdds": 600, "confidence": 42,
    "reasoning": "Why these player performance props make sense together."
  },
  "mixParlayOfTheDay": {
    "id": "mix-1", "name": "Mixed 4-Leg Parlay",
    "legs": [4-5 legs, at least 2 game bets AND at least 2 player props, all from DIFFERENT games],
    "combinedOdds": 900, "confidence": 38,
    "reasoning": "How the game bets and props complement each other."
  },
  "summary": "1 sentence overview of today's slate."
}

Rules:
- Lock of the Day: SINGLE best pick — can be any bet type including player_prop.
- safeParlay: 2-3 legs, ONLY moneyline/spread/over/under, target +175 to +500 combined.
- lottoParlay: 4-6 legs, any bet type, target +800 to +3000.
- gameParlayOfTheDay: 3-4 legs, STRICTLY no player props. Only moneyline, spread, over, under.
- propParlayOfTheDay: 3-4 legs, ALL must be player_prop. Include "player" field on each leg.
- mixParlayOfTheDay: 4-5 legs, at least 2 game bets + at least 2 player props mixed.
- betType options: moneyline, spread, over, under, player_prop
- For player_prop legs include "player" field with player name.
- Confidence range: 25-90. Edge range: 0.5-9.0.
- ALL legs in a parlay must use DIFFERENT games (no two legs from the same gameId) EXCEPT propParlayOfTheDay which can share games.
- Use real team/player names from the game data provided.`;

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

  const gameParlayLegs: AIPickLeg[] = [
    {
      gameId: "nba-mock-1",
      sport: "NBA",
      homeTeam: "Oklahoma City Thunder",
      awayTeam: "Dallas Mavericks",
      startTime: new Date(now + 5 * 3600_000).toISOString(),
      pick: "Thunder ML",
      betType: "moneyline",
      bookmaker: "DraftKings",
      odds: -145,
    },
    {
      gameId: "mlb-mock-1",
      sport: "MLB",
      homeTeam: "Los Angeles Dodgers",
      awayTeam: "Atlanta Braves",
      startTime: new Date(now + 3 * 3600_000).toISOString(),
      pick: "Under 8.5",
      betType: "under",
      bookmaker: "BetMGM",
      odds: -112,
    },
    {
      gameId: "nhl-mock-1",
      sport: "NHL",
      homeTeam: "Florida Panthers",
      awayTeam: "Toronto Maple Leafs",
      startTime: new Date(now + 7 * 3600_000).toISOString(),
      pick: "Panthers -1.5",
      betType: "spread",
      bookmaker: "FanDuel",
      odds: +120,
    },
  ];

  const gameParlayOfTheDay: AIParlay = {
    id: "game-1",
    name: "Game Picks 3-Legger",
    legs: gameParlayLegs,
    combinedOdds: calcCombinedOdds(gameParlayLegs),
    confidence: 49,
    reasoning: "Three game-line bets with clear value: OKC's dominant home record, a pitcher-duel under, and Panthers puck-line at plus money. All legs are moneyline/spread/total — no props.",
  };

  const propParlayLegs: AIPickLeg[] = [
    {
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
    },
    {
      gameId: "nba-mock-2",
      sport: "NBA",
      homeTeam: "Cleveland Cavaliers",
      awayTeam: "Miami Heat",
      startTime: new Date(now + 6 * 3600_000).toISOString(),
      pick: "Darius Garland Over 7.5 Assists",
      betType: "player_prop",
      player: "Darius Garland",
      bookmaker: "DraftKings",
      odds: -118,
    },
    {
      gameId: "mlb-mock-2",
      sport: "MLB",
      homeTeam: "New York Mets",
      awayTeam: "Colorado Rockies",
      startTime: new Date(now + 2 * 3600_000).toISOString(),
      pick: "Pete Alonso Over 0.5 RBIs",
      betType: "player_prop",
      player: "Pete Alonso",
      bookmaker: "BetMGM",
      odds: -130,
    },
  ];

  const propParlayOfTheDay: AIParlay = {
    id: "prop-1",
    name: "Player Props 3-Legger",
    legs: propParlayLegs,
    combinedOdds: calcCombinedOdds(propParlayLegs),
    confidence: 43,
    reasoning: "Three player performance props with favorable matchup angles: SGA vs a weak perimeter defense, Garland in a pace-up spot, and Alonso at hitter-friendly Coors.",
  };

  const mixParlayLegs: AIPickLeg[] = [
    {
      gameId: "nba-mock-1",
      sport: "NBA",
      homeTeam: "Oklahoma City Thunder",
      awayTeam: "Dallas Mavericks",
      startTime: new Date(now + 5 * 3600_000).toISOString(),
      pick: "Thunder ML",
      betType: "moneyline",
      bookmaker: "DraftKings",
      odds: -145,
    },
    {
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
    },
    {
      gameId: "mlb-mock-1",
      sport: "MLB",
      homeTeam: "Los Angeles Dodgers",
      awayTeam: "Atlanta Braves",
      startTime: new Date(now + 3 * 3600_000).toISOString(),
      pick: "Under 8.5",
      betType: "under",
      bookmaker: "BetMGM",
      odds: -112,
    },
    {
      gameId: "mlb-mock-2",
      sport: "MLB",
      homeTeam: "New York Mets",
      awayTeam: "Colorado Rockies",
      startTime: new Date(now + 2 * 3600_000).toISOString(),
      pick: "Pete Alonso Over 0.5 RBIs",
      betType: "player_prop",
      player: "Pete Alonso",
      bookmaker: "BetMGM",
      odds: -130,
    },
  ];

  const mixParlayOfTheDay: AIParlay = {
    id: "mix-1",
    name: "Mixed 4-Legger",
    legs: mixParlayLegs,
    combinedOdds: calcCombinedOdds(mixParlayLegs),
    confidence: 39,
    reasoning: "Blends the Thunder ML and under with targeted player props on SGA and Alonso. The game picks and props reinforce the same narrative — OKC dominating at home and an Alonso hitting spot.",
  };

  return {
    lockOfTheDay,
    safeParlay,
    lottoParlay,
    gameParlayOfTheDay,
    propParlayOfTheDay,
    mixParlayOfTheDay,
    summary: "Today's slate features strong home-team narratives in the NBA playoffs, elite pitcher matchups in MLB, and standout player prop opportunities.",
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
Generate all six picks: lockOfTheDay, safeParlay, lottoParlay, gameParlayOfTheDay, propParlayOfTheDay, mixParlayOfTheDay.`;

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
      gameParlayOfTheDay: AIParlay;
      propParlayOfTheDay: AIParlay;
      mixParlayOfTheDay: AIParlay;
      summary: string;
    };

    // Recalculate combined odds server-side for accuracy
    const parlayKeys = ["safeParlay", "lottoParlay", "gameParlayOfTheDay", "propParlayOfTheDay", "mixParlayOfTheDay"] as const;
    for (const key of parlayKeys) {
      const p = parsed[key];
      if (p?.legs?.length >= 2) p.combinedOdds = calcCombinedOdds(p.legs);
    }

    // Ensure IDs
    if (parsed.lockOfTheDay && !parsed.lockOfTheDay.id) parsed.lockOfTheDay.id = "lock-1";
    if (parsed.safeParlay && !parsed.safeParlay.id) parsed.safeParlay.id = "safe-1";
    if (parsed.lottoParlay && !parsed.lottoParlay.id) parsed.lottoParlay.id = "lotto-1";
    if (parsed.gameParlayOfTheDay && !parsed.gameParlayOfTheDay.id) parsed.gameParlayOfTheDay.id = "game-1";
    if (parsed.propParlayOfTheDay && !parsed.propParlayOfTheDay.id) parsed.propParlayOfTheDay.id = "prop-1";
    if (parsed.mixParlayOfTheDay && !parsed.mixParlayOfTheDay.id) parsed.mixParlayOfTheDay.id = "mix-1";

    const result: AIPicksResponse = {
      lockOfTheDay: parsed.lockOfTheDay ?? null,
      safeParlay: parsed.safeParlay ?? null,
      lottoParlay: parsed.lottoParlay ?? null,
      gameParlayOfTheDay: parsed.gameParlayOfTheDay ?? null,
      propParlayOfTheDay: parsed.propParlayOfTheDay ?? null,
      mixParlayOfTheDay: parsed.mixParlayOfTheDay ?? null,
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

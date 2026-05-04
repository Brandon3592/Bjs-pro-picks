import { Router } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import { fetchAllSportOdds, fetchPlayerPropsForEvent, SPORT_KEYS, hasApiKey } from "../lib/odds-api";
import { getRealValueBets } from "./predictions";
import { consensusProb, americanToDecimal, decimalToAmerican } from "../lib/model";
import type { OddsEvent, PropEvent } from "../lib/odds-api";

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

// ─── Props helper ─────────────────────────────────────────────────────────────

interface CompactProp {
  game: string;
  gameId: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  player: string;
  market: string;
  line: number;
  overOdds: number;
  underOdds: number;
  bestBook: string;
}

async function fetchRealPropsForAI(
  allOdds: { sport: string; events: OddsEvent[] }[],
): Promise<CompactProp[]> {
  const now = Date.now();

  // allOdds uses full API keys (e.g. "basketball_nba"); translate to label for market lookup
  // SPORT_KEYS is bidirectional: "basketball_nba" → "NBA"
  const SPORT_MARKETS: Record<string, string[]> = {
    basketball_nba: ["player_points", "player_rebounds", "player_assists", "player_threes"],
    baseball_mlb:   ["pitcher_strikeouts", "batter_hits", "batter_total_bases", "batter_home_runs"],
    icehockey_nhl:  ["player_shots_on_goal", "player_points"],
  };

  // Use ALL upcoming games per sport — no cap
  const targets: { sport: string; sportLabel: string; event: OddsEvent }[] = [];
  for (const { sport, events } of allOdds) {
    if (!SPORT_MARKETS[sport]) continue;
    const sportLabel = SPORT_KEYS[sport] ?? sport; // e.g. "NBA"
    const upcoming = events.filter((e) => new Date(e.commence_time).getTime() > now);
    for (const ev of upcoming) targets.push({ sport, sportLabel, event: ev });
  }

  const results = await Promise.allSettled(
    targets.map(async ({ sport, sportLabel, event }) => {
      const markets = SPORT_MARKETS[sport] ?? [];
      const propEvent = await fetchPlayerPropsForEvent(sport, event.id, markets);
      if (!propEvent) return [];
      return parsePropEvent(propEvent, sportLabel, event);
    })
  );

  const props: CompactProp[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") props.push(...r.value);
  }
  return props;
}

function parsePropEvent(
  propEvent: PropEvent,
  sport: string,
  event: OddsEvent,
): CompactProp[] {
  // Collect best over/under per player+market+line combo
  type Entry = { overOdds: number; underOdds: number; book: string };
  const byKey = new Map<string, Entry>();

  for (const bk of propEvent.bookmakers) {
    for (const market of bk.markets) {
      const marketLabel = market.key.replace(/^(player_|batter_|pitcher_)/, "").replace(/_/g, " ");
      // Group outcomes by player+line
      const pairMap = new Map<string, { over?: number; under?: number }>();
      for (const o of market.outcomes) {
        if (!o.description || o.point == null) continue;
        const key = `${o.description}|${market.key}|${o.point}`;
        if (!pairMap.has(key)) pairMap.set(key, {});
        if (o.name === "Over") pairMap.get(key)!.over = o.price;
        else pairMap.get(key)!.under = o.price;
      }
      for (const [key, pair] of pairMap) {
        if (pair.over == null || pair.under == null) continue;
        const existing = byKey.get(key);
        // Keep the book with the best over odds (most value for AI to pick from)
        if (!existing || pair.over > existing.overOdds) {
          byKey.set(key, { overOdds: pair.over, underOdds: pair.under, book: bk.title });
        }
      }
    }
  }

  const props: CompactProp[] = [];
  for (const [key, entry] of byKey) {
    const [player, marketKey, lineStr] = key.split("|");
    const line = parseFloat(lineStr);
    if (isNaN(line)) continue;
    const marketLabel = marketKey.replace(/^(player_|batter_|pitcher_)/, "").replace(/_/g, " ");
    props.push({
      game: `${event.away_team} @ ${event.home_team}`,
      gameId: event.id,
      sport,
      homeTeam: event.home_team,
      awayTeam: event.away_team,
      startTime: event.commence_time,
      player,
      market: marketLabel,
      line,
      overOdds: entry.overOdds,
      underOdds: entry.underOdds,
      bestBook: entry.book,
    });
  }

  // Sort by liquidity (odds closest to -110) — no cap, return all props
  return props
    .sort((a, b) => Math.abs(Math.abs(a.overOdds) - 110) - Math.abs(Math.abs(b.overOdds) - 110));
}

// ─── Cache ────────────────────────────────────────────────────────────────────

const picksCacheMap = new Map<string, { data: AIPicksResponse; expiresAt: number }>();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

const SPORT_LABEL: Record<string, string> = {
  NBA: "basketball_nba",
  MLB: "baseball_mlb",
  NHL: "icehockey_nhl",
  NFL: "americanfootball_nfl",
};

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
  const sport = (typeof req.query.sport === "string" ? req.query.sport : "all").toUpperCase();
  const cacheKey = sport === "ALL" ? "all" : sport;

  const cached = picksCacheMap.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return res.json(cached.data);
  }

  try {
    const [allOddsRaw, valueBetsRaw] = await Promise.all([
      fetchAllSportOdds(),
      getRealValueBets(0),
    ]);

    // Filter to requested sport if not "all"
    const sportApiKey = cacheKey !== "all" ? SPORT_LABEL[cacheKey] : null;
    const allOdds = sportApiKey
      ? allOddsRaw.filter((s) => s.sport === sportApiKey)
      : allOddsRaw;

    const valueBets = sportApiKey
      ? valueBetsRaw.filter((vb) => vb.sport.toUpperCase() === cacheKey || SPORT_LABEL[vb.sport.toUpperCase()] === sportApiKey)
      : valueBetsRaw;

    // Fetch real player props (cached 15 min, ~3 API requests)
    const realProps = await fetchRealPropsForAI(allOdds.length > 0 ? allOdds : allOddsRaw);
    const filteredProps = sportApiKey
      ? realProps.filter((p) => p.sport === sportApiKey)
      : realProps;

    const gameData = buildCompactGameData(allOdds);
    const valueBetData = valueBets.slice(0, 8).map((vb) => ({
      gameId: vb.gameId, sport: vb.sport, away: vb.awayTeam, home: vb.homeTeam,
      pick: vb.team, betType: vb.betType, book: vb.bookmaker, odds: vb.odds, edge: vb.edge,
    }));

    const sportLabel = cacheKey === "all" ? "all sports" : cacheKey;
    const propsSection = filteredProps.length > 0
      ? `\nReal player props available (use these for propParlayOfTheDay, mixParlayOfTheDay, lockOfTheDay):\n${JSON.stringify(filteredProps)}`
      : "\nNo live player prop data available — use your knowledge of today's players for prop picks.";

    // Build a whitelist of real player names from the props data for the prompt
    const realPlayerNames = [...new Set(filteredProps.map((p) => p.player))];
    const playerWhitelistNote = realPlayerNames.length > 0
      ? `\nALLOWED player names for player_prop legs (ONLY use names from this list): ${realPlayerNames.join(", ")}`
      : "";

    const userPrompt = `Date: ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" })}
Sport filter: ${sportLabel}
Games: ${JSON.stringify(gameData)}
Value bets detected by model: ${JSON.stringify(valueBetData)}${propsSection}${playerWhitelistNote}
Generate all six picks (${sportLabel} only): lockOfTheDay, safeParlay, lottoParlay, gameParlayOfTheDay, propParlayOfTheDay, mixParlayOfTheDay.
CRITICAL: For ALL player_prop legs you MUST only use player names and lines from the "Real player props" list above. DO NOT invent players. DO NOT use players not listed. If a player is not in the list, do not use them.${cacheKey !== "all" ? `\nAll picks MUST be from ${cacheKey} games only.` : ""}`;

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

    // Strip code fences, fix common AI JSON issues
    const jsonStr = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/, "")
      .trim()
      // "odds": +300  →  "odds": 300  (JSON doesn't allow leading +)
      .replace(/:\s*\+(\d+)/g, ": $1")
      // Remove bad control characters inside strings (keep \n \r \t)
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
    const parsed = JSON.parse(jsonStr) as {
      lockOfTheDay: AIPick;
      safeParlay: AIParlay;
      lottoParlay: AIParlay;
      gameParlayOfTheDay: AIParlay;
      propParlayOfTheDay: AIParlay;
      mixParlayOfTheDay: AIParlay;
      summary: string;
    };

    // Build gameId → event lookup for leg normalization
    const gameMap = new Map<string, OddsEvent & { sport: string }>();
    for (const { sport, events } of allOdds) {
      for (const ev of events) gameMap.set(ev.id, { ...ev, sport });
    }

    // Build a case-insensitive set of valid player names from real props
    const validPlayerSet = new Set(filteredProps.map((p) => p.player.toLowerCase()));

    // Normalize legs: fix `bet` → `pick`, fill missing fields from game map
    function normalizeLegs(legs: any[]): AIPickLeg[] {
      return (legs ?? [])
        .map((leg: any): AIPickLeg | null => {
          const pick = leg.pick ?? leg.bet ?? null;
          if (!pick) return null;
          const game = leg.gameId ? gameMap.get(leg.gameId) : null;
          const betType = leg.betType ?? inferBetType(pick);

          // Strip hallucinated player_prop legs — if we have real props and the
          // player isn't in the whitelist, reject this leg entirely
          if (betType === "player_prop" && validPlayerSet.size > 0) {
            const playerName = (leg.player ?? "").toLowerCase();
            // Also check if player name appears anywhere in the pick string
            const pickLower = pick.toLowerCase();
            const foundInWhitelist = validPlayerSet.has(playerName)
              || [...validPlayerSet].some((name) => pickLower.includes(name));
            if (!foundInWhitelist) {
              req.log.warn({ player: leg.player, pick }, "Stripped hallucinated player_prop leg");
              return null;
            }
          }

          return {
            gameId: leg.gameId ?? "",
            sport: leg.sport ?? game?.sport ?? "",
            homeTeam: leg.homeTeam ?? game?.home_team ?? "",
            awayTeam: leg.awayTeam ?? game?.away_team ?? "",
            startTime: leg.startTime ?? game?.commence_time ?? new Date().toISOString(),
            pick,
            betType,
            bookmaker: leg.bookmaker ?? "DraftKings",
            odds: typeof leg.odds === "number" ? leg.odds : -110,
            player: leg.player ?? null,
          };
        })
        .filter((l): l is AIPickLeg => l !== null);
    }

    function inferBetType(pick: string): string {
      const p = pick.toLowerCase();
      if (p.includes("over") || p.includes("under")) {
        if (p.match(/\b(points|rebounds|assists|strikeouts|hits|goals|shots|yards|receptions|tds|bases)\b/))
          return "player_prop";
        return p.includes("over") ? "over" : "under";
      }
      if (p.includes(" ml") || p.includes(" moneyline")) return "moneyline";
      if (p.match(/[+-]\d+\.?\d*\s*$/)) return "spread";
      return "moneyline";
    }

    // Apply normalization to all parlays
    const parlayKeys = ["safeParlay", "lottoParlay", "gameParlayOfTheDay", "propParlayOfTheDay", "mixParlayOfTheDay"] as const;
    for (const key of parlayKeys) {
      const p = parsed[key];
      if (!p) continue;
      p.legs = normalizeLegs(p.legs);
      if (p.legs.length >= 2) p.combinedOdds = calcCombinedOdds(p.legs);
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

    picksCacheMap.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL });
    return res.json(result);

  } catch (err) {
    req.log.error({ err }, "AI picks generation failed, using fallback");
    const fallback = buildFallbackPicks();
    picksCacheMap.set(cacheKey, { data: fallback, expiresAt: Date.now() + 10 * 60_000 });
    return res.json(fallback);
  }
});

// Force refresh — clears all sport caches or just one if ?sport= provided
router.post("/ai-picks/refresh", (req, res) => {
  const sport = typeof req.query.sport === "string" ? req.query.sport.toUpperCase() : null;
  if (sport && sport !== "ALL") {
    picksCacheMap.delete(sport);
  } else {
    picksCacheMap.clear();
  }
  return res.json({ ok: true });
});

export default router;

import { Router } from "express";
import { fetchAllSportOdds, fetchPlayerPropsForEvent, SPORT_KEYS, SPORT_FROM_KEY, hasApiKey } from "../lib/odds-api";
import { getRealValueBets } from "./predictions";
import { americanToDecimal, decimalToAmerican } from "../lib/model";
import type { OddsEvent, PropEvent } from "../lib/odds-api";
import type { ValueBet } from "../lib/model";

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

  // allOdds.sport is now the label key ("NBA", "MLB", etc.)
  // We translate to the Odds API key (e.g. "baseball_mlb") before fetching props.
  const SPORT_MARKETS: Record<string, string[]> = {
    basketball_nba:      ["player_points", "player_rebounds", "player_assists", "player_threes"],
    baseball_mlb:        ["pitcher_strikeouts", "batter_hits", "batter_total_bases", "batter_home_runs"],
    icehockey_nhl:       ["player_shots_on_goal", "player_points"],
    americanfootball_nfl: ["player_pass_yds", "player_rush_yds", "player_reception_yds", "player_anytime_td"],
  };

  // Use all games starting within the next 36 hours (today's slate only)
  const cutoff = now + 36 * 3600_000;
  const targets: { sport: string; sportLabel: string; event: OddsEvent }[] = [];
  for (const { sport, events } of allOdds) {
    // allOdds.sport is now the label key ("NBA", "MLB") — translate to API key for props fetch
    const sportApiKey = SPORT_KEYS[sport] ?? sport; // "MLB" → "baseball_mlb"
    if (!SPORT_MARKETS[sportApiKey]) continue;
    const todaySlate = events.filter((e) => {
      const t = new Date(e.commence_time).getTime();
      return t > now && t < cutoff;
    });
    for (const ev of todaySlate) targets.push({ sport: sportApiKey, sportLabel: sport, event: ev });
  }

  const results = await Promise.allSettled(
    targets.map(async ({ sport, sportLabel, event }) => {
      const markets = SPORT_MARKETS[sport] ?? [];
      const propEvent = await fetchPlayerPropsForEvent(sport, event.id, markets);
      if (!propEvent) return [];
      // Pass the API key (sport) so prop.sport matches the sportApiKey filter downstream
      return parsePropEvent(propEvent, sport, event);
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
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

const SPORT_LABEL: Record<string, string> = {
  NBA: "basketball_nba",
  MLB: "baseball_mlb",
  NHL: "icehockey_nhl",
  NFL: "americanfootball_nfl",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function calcCombinedOdds(legs: AIPickLeg[]): number {
  const combined = legs.reduce((acc, leg) => acc * americanToDecimal(leg.odds), 1);
  return decimalToAmerican(combined);
}

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
  const sportRaw = typeof req.query.sport === "string" ? req.query.sport.toLowerCase() : "all";
  // Convert API key ("basketball_nba") → label key ("NBA"); keep "all" as-is
  // allOddsRaw uses label keys ("NBA","MLB"…) so the cache key must also be a label key
  const cacheKey = sportRaw === "all" ? "all" : (SPORT_FROM_KEY[sportRaw] ?? sportRaw.toUpperCase());

  const cached = picksCacheMap.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return res.json(cached.data);
  }

  try {
    const [allOddsRaw, valueBetsRaw] = await Promise.all([
      fetchAllSportOdds(),
      getRealValueBets(0),
    ]);

    // cacheKey is now a label key ("NBA","MLB"…) matching allOddsRaw[i].sport
    const sportApiKey = cacheKey !== "all" ? SPORT_LABEL[cacheKey] : null;
    const allOdds = cacheKey !== "all"
      ? allOddsRaw.filter((s) => s.sport === cacheKey)
      : allOddsRaw;

    const valueBets = sportApiKey
      ? valueBetsRaw.filter((vb) => vb.sport.toUpperCase() === cacheKey || SPORT_LABEL[vb.sport.toUpperCase()] === sportApiKey)
      : valueBetsRaw;

    // Fetch real player props (cached 15 min, ~3 API requests)
    const realProps = await fetchRealPropsForAI(allOdds.length > 0 ? allOdds : allOddsRaw);
    const filteredProps = sportApiKey
      ? realProps.filter((p) => p.sport === sportApiKey)
      : realProps;

    // ─── Deterministic pick builder — no AI, 100% real data ──────────────────

    // Convert a value bet into a pick leg
    function vbToLeg(vb: ValueBet): AIPickLeg {
      return {
        gameId: vb.gameId,
        sport: vb.sport,
        homeTeam: vb.homeTeam,
        awayTeam: vb.awayTeam,
        startTime: vb.startTime,
        pick: vb.team,
        betType: vb.betType,
        bookmaker: vb.bookmaker,
        odds: vb.odds,
        player: null,
      };
    }

    // Convert a real prop into a pick leg (pick the better-priced direction)
    function propToLeg(prop: CompactProp): AIPickLeg {
      const direction = prop.overOdds >= prop.underOdds ? "Over" : "Under";
      const odds = direction === "Over" ? prop.overOdds : prop.underOdds;
      const rawMarket = prop.market
        .replace(/^(player_|batter_|pitcher_)/, "")
        .replace(/_/g, " ");
      const marketLabel = rawMarket.replace(/\b\w/g, (c) => c.toUpperCase());
      return {
        gameId: prop.gameId,
        sport: prop.sport,
        homeTeam: prop.homeTeam,
        awayTeam: prop.awayTeam,
        startTime: prop.startTime,
        pick: `${prop.player} ${direction} ${prop.line} ${marketLabel}`,
        betType: "player_prop",
        bookmaker: prop.bestBook,
        odds,
        player: prop.player,
      };
    }

    // Pick up to N legs from a pool, no two from the same game
    function pickUnique(
      pool: AIPickLeg[],
      n: number,
      excludeGameIds: Set<string> = new Set(),
    ): AIPickLeg[] {
      const seen = new Set(excludeGameIds);
      const result: AIPickLeg[] = [];
      for (const leg of pool) {
        if (result.length >= n) break;
        if (seen.has(leg.gameId)) continue;
        result.push(leg);
        seen.add(leg.gameId);
      }
      return result;
    }

    // Sort value bets by edge descending; drop games already started > 4 h ago
    const nowMs = Date.now();
    const gameBets = valueBets
      .filter((vb) => new Date(vb.startTime).getTime() > nowMs - 4 * 3600_000)
      .sort((a, b) => b.edge - a.edge);

    // Build one prop leg per player — deduplicate by player name
    const seenPropPlayers = new Set<string>();
    const propPool: AIPickLeg[] = filteredProps
      .filter((p) => Math.max(p.overOdds, p.underOdds) >= -160)
      .sort((a, b) => Math.max(b.overOdds, b.underOdds) - Math.max(a.overOdds, a.underOdds))
      .map(propToLeg)
      .filter((l) => {
        if (!l.player || seenPropPlayers.has(l.player)) return false;
        seenPropPlayers.add(l.player!);
        return true;
      });

    const gameLegPool = gameBets.map(vbToLeg);

    // If there are no real bets at all, fall back to mock data
    if (gameBets.length === 0 && propPool.length === 0) {
      const fallback = buildFallbackPicks();
      picksCacheMap.set(cacheKey, { data: fallback, expiresAt: Date.now() + 5 * 60_000 });
      return res.json(fallback);
    }

    // ── LOCK OF THE DAY: highest-edge bet ─────────────────────────────────────
    const lockVb = gameBets[0] ?? null;
    const lockLeg: AIPickLeg = lockVb ? vbToLeg(lockVb) : propPool[0];
    const lockEdge = parseFloat((lockVb?.edge ?? 2.0).toFixed(1));
    const lockModelPct = lockVb ? Math.round(lockVb.modelProb * 100) : 55;
    const lockImpliedPct = lockVb ? Math.round(lockVb.impliedProb * 100) : 48;

    const lockOfTheDay: AIPick = {
      id: "lock-1",
      gameId: lockLeg.gameId,
      sport: lockLeg.sport,
      homeTeam: lockLeg.homeTeam,
      awayTeam: lockLeg.awayTeam,
      startTime: lockLeg.startTime,
      pick: lockLeg.pick,
      betType: lockLeg.betType,
      player: lockLeg.player ?? null,
      bookmaker: lockLeg.bookmaker,
      odds: lockLeg.odds,
      confidence: Math.min(90, Math.round(50 + lockEdge * 4)),
      edge: lockEdge,
      reasoning: lockVb
        ? `Our de-vig consensus model gives this a ${lockModelPct}% true probability vs the market's implied ${lockImpliedPct}% — a ${lockEdge}% edge. Best line at ${lockVb.bookmaker}.`
        : `Best available player prop line identified across bookmakers at ${lockLeg.bookmaker}.`,
      tags: [lockLeg.betType, "value"],
    };

    // ── SAFE PARLAY: 2-3 highest-edge game bets, different games ─────────────
    // Include the lock game in the pool — it's valid to parlay the lock too
    const safeLegs = pickUnique(gameLegPool, 3);
    const avgSafeEdge = safeLegs.length > 0
      ? safeLegs.reduce((s, l) => {
          const vb = gameBets.find((v) => v.gameId === l.gameId && v.team === l.pick);
          return s + (vb?.edge ?? 2);
        }, 0) / safeLegs.length
      : 2;
    const safeParlay: AIParlay | null = safeLegs.length >= 2 ? {
      id: "safe-1",
      name: `${safeLegs.length}-Leg Value Parlay`,
      legs: safeLegs,
      combinedOdds: calcCombinedOdds(safeLegs),
      confidence: Math.min(72, Math.round(48 + avgSafeEdge * 2)),
      reasoning: `${safeLegs.length} independent game bets each carrying a positive edge per our model. Combined into a conservative parlay targeting modest upside.`,
    } : null;

    // ── GAME PARLAY: 3-4 game bets (no props) ────────────────────────────────
    const gameLegs = pickUnique(gameLegPool, 4);
    const gameParlayOfTheDay: AIParlay | null = gameLegs.length >= 2 ? {
      id: "game-1",
      name: `Game Picks ${gameLegs.length}-Legger`,
      legs: gameLegs,
      combinedOdds: calcCombinedOdds(gameLegs),
      confidence: Math.min(65, Math.round(40 + gameLegs.length * 3)),
      reasoning: `Pure game-line parlay — moneylines, spreads, and totals only. Each leg selected for the highest edge versus the de-vigged consensus probability across bookmakers.`,
    } : null;

    // ── LOTTO PARLAY: 5 legs biased toward underdogs / higher odds ───────────
    const lottoGamePool = [...gameBets]
      .sort((a, b) => b.odds - a.odds)
      .map(vbToLeg);
    const lottoLegs = pickUnique([...lottoGamePool, ...propPool], 5);
    const lottoParlay: AIParlay | null = lottoLegs.length >= 3 ? {
      id: "lotto-1",
      name: `${lottoLegs.length}-Leg Lotto Parlay`,
      legs: lottoLegs,
      combinedOdds: calcCombinedOdds(lottoLegs),
      confidence: Math.max(12, Math.round(38 - lottoLegs.length * 3)),
      reasoning: `High-upside parlay mixing value underdogs and player props. Each leg has standalone merit — small stake for a big payout potential.`,
    } : null;

    // ── PROPS PARLAY: 3-4 player props (can share game) ──────────────────────
    const propParlayLegs = propPool.slice(0, 4);
    const propParlayOfTheDay: AIParlay | null = propParlayLegs.length >= 2 ? {
      id: "prop-1",
      name: `Player Props ${propParlayLegs.length}-Legger`,
      legs: propParlayLegs,
      combinedOdds: calcCombinedOdds(propParlayLegs),
      confidence: Math.max(20, Math.round(44 - propParlayLegs.length * 2)),
      reasoning: `Real bookmaker lines for these player performance props, sourced directly from the best available odds across major sportsbooks.`,
    } : null;

    // ── MIX PARLAY: 2 game bets + 2 props from different games ───────────────
    const mixGameLegs = pickUnique(gameLegPool, 2);
    const mixGameIds = new Set(mixGameLegs.map((l) => l.gameId));
    const mixPropLegs = propPool.filter((l) => !mixGameIds.has(l.gameId)).slice(0, 2);
    const mixLegs = [...mixGameLegs, ...mixPropLegs];
    const mixParlayOfTheDay: AIParlay | null = mixLegs.length >= 3 ? {
      id: "mix-1",
      name: `Mixed ${mixLegs.length}-Legger`,
      legs: mixLegs,
      combinedOdds: calcCombinedOdds(mixLegs),
      confidence: Math.max(18, Math.round(40 - mixLegs.length * 2)),
      reasoning: `Blends the strongest game-line value bets with real player prop lines. Game legs for structure, props for upside.`,
    } : null;

    // Normalize sport labels (API keys like "baseball_mlb" → display label "MLB")
    const SPORT_KEY_TO_LABEL: Record<string, string> = {
      basketball_nba: "NBA", baseball_mlb: "MLB",
      icehockey_nhl: "NHL", americanfootball_nfl: "NFL",
    };
    function normSport(s: string): string {
      return SPORT_KEY_TO_LABEL[s] ?? SPORT_FROM_KEY[s] ?? s.toUpperCase();
    }

    const sportsInPlay = [...new Set([
      ...gameBets.slice(0, 6).map((v) => normSport(v.sport)),
      ...propPool.slice(0, 3).map((p) => normSport(p.sport)),
    ])];
    const topBet = gameBets[0];
    const summary = topBet
      ? `Model detected ${gameBets.length} value bet${gameBets.length !== 1 ? "s" : ""} across ${sportsInPlay.join("/")} today. Top edge: ${topBet.team} at ${topBet.odds > 0 ? "+" : ""}${topBet.odds} (${topBet.edge.toFixed(1)}% edge via ${topBet.bookmaker}).`
      : `Picks built from real bookmaker odds${filteredProps.length > 0 ? ` — ${filteredProps.length} active prop markets available` : ""}.`;

    const result: AIPicksResponse = {
      lockOfTheDay,
      safeParlay,
      lottoParlay,
      gameParlayOfTheDay,
      propParlayOfTheDay,
      mixParlayOfTheDay,
      summary,
      generatedAt: new Date().toISOString(),
      isAI: false,
    };

    picksCacheMap.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL });
    return res.json(result);

  } catch (err) {
    req.log.error({ err }, "Picks generation failed, using fallback");
    const fallback = buildFallbackPicks();
    picksCacheMap.set(cacheKey, { data: fallback, expiresAt: Date.now() + 5 * 60_000 });
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

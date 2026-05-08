import { Router } from "express";
import { fetchAllSportOdds, fetchPlayerPropsForEvent, SPORT_KEYS, SPORT_FROM_KEY, SPORT_API_TO_LABEL, hasApiKey } from "../lib/odds-api";
import { fetchMlbLineupNames } from "../lib/mlb-lineups";
import { fetchNbaOut, fetchNhlOut } from "../lib/sport-lineups";
import { americanToDecimal, decimalToAmerican } from "../lib/model";
import { buildSteamMap, scoreProps, buildWeatherPenaltySet, type MatchupContext } from "../lib/pick-scoring";
import { getEloWinProb, warmEloCache } from "../lib/elo-model";
import type { OddsEvent, PropEvent } from "../lib/odds-api";
import { db, dailyLaddersTable, dailyPicksTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

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

export interface AILadderStep {
  day: number;
  stake: number;
  targetWin: number;
  legs: AIPickLeg[];
}

export interface AILadderParlay {
  id: string;
  name: string;
  sport: string;
  startStake: number;
  targetPayout: number;
  totalDays: number;
  steps: AILadderStep[];
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
  allSafeParlay: AIParlay | null;
  allLottoParlay: AIParlay | null;
  allGameParlay: AIParlay | null;
  allPropsParlay: AIParlay | null;
  allMixParlay: AIParlay | null;
  hrParlay: AIParlay | null;
  goalScorerParlay: AIParlay | null;
  threePtParlay: AIParlay | null;
  tdParlay: AIParlay | null;
  allLadder: AILadderParlay | null;
  nbaLadder: AILadderParlay | null;
  mlbLadder: AILadderParlay | null;
  nhlLadder: AILadderParlay | null;
  nflLadder: AILadderParlay | null;
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
  overOdds: number;    // best (highest) over odds across books — used for lotto / value
  minOverOdds: number; // tightest (most negative) over odds — used to rank by true probability
  underOdds: number;
  bestBook: string;
}

// Player props MUST use the per-event endpoint — the bulk sport endpoint doesn't support them.
// Props are cached for 2 hours, so quota cost per day stays well within the 20k/month budget.
const SPORT_PROP_MARKETS: Record<string, string[]> = {
  basketball_nba:       ["player_points", "player_rebounds", "player_assists", "player_threes"],
  baseball_mlb:         ["pitcher_strikeouts", "batter_hits", "batter_total_bases", "batter_home_runs"],
  icehockey_nhl:        ["player_shots_on_goal", "player_points", "player_goals"],
  americanfootball_nfl: ["player_pass_yds", "player_rush_yds", "player_reception_yds", "player_anytime_td"],
};

/** End of a given day (today + offsetDays) in US Eastern Time (EDT = UTC-4). */
function endOfDayEasternMs(offsetDays = 0): number {
  const nowET = new Date(Date.now() - 4 * 3600_000); // shift UTC → EDT
  const endET = new Date(Date.UTC(
    nowET.getUTCFullYear(), nowET.getUTCMonth(), nowET.getUTCDate() + offsetDays,
    23, 59, 59, 999,
  ));
  return endET.getTime() + 4 * 3600_000; // shift EDT → UTC
}

async function fetchRealPropsForAI(
  allOdds: { sport: string; events: OddsEvent[] }[],
  cutoffMs: number,
): Promise<CompactProp[]> {
  const now = Date.now();
  const cutoff = cutoffMs;

  // Build one fetch per game (all games, all sports — no caps)
  const fetches: Promise<CompactProp[]>[] = [];

  for (const { sport, events } of allOdds) {
    const sportApiKey = SPORT_KEYS[sport] ?? sport;
    const marketKeys = SPORT_PROP_MARKETS[sportApiKey];
    if (!marketKeys) continue;

    for (const ev of events) {
      const t = new Date(ev.commence_time).getTime();
      if (t <= now || t > cutoff) continue; // upcoming games only

      fetches.push(
        fetchPlayerPropsForEvent(sportApiKey, ev.id, marketKeys).then((propEvent) => {
          if (!propEvent) return [];
          return parsePropEvent(propEvent, sportApiKey, ev);
        }),
      );
    }
  }

  const results = await Promise.allSettled(fetches);
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
  // Collect best over/under per player+market+line combo.
  // Track both the BEST (highest) over odds (for lotto/value) and
  // the MIN (most negative) over odds (for probability-based best-pick sorting).
  type Entry = { overOdds: number; minOverOdds: number; underOdds: number; book: string };
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
      // Markets where only the Over is widely offered — treat as Over-only.
      // batter_total_bases Under is not offered by many books, so always pick Over.
      const overOnlyMarket = market.key === "batter_hits" || market.key === "batter_total_bases";

      for (const [key, pair] of pairMap) {
        // HR props (and some other markets) only post the Over side — accept solo-Over entries.
        // Give them a large positive sentinel underOdds so direction logic always picks "Over".
        if (pair.over == null) continue;
        if (pair.under == null || overOnlyMarket) pair.under = 9999;
        const existing = byKey.get(key);
        if (!existing) {
          byKey.set(key, {
            overOdds: pair.over,
            minOverOdds: pair.over,
            underOdds: pair.under,
            book: bk.title,
          });
        } else {
          // Best over odds: highest American odds (most value / underdog-friendly)
          if (pair.over > existing.overOdds) {
            existing.overOdds = pair.over;
            existing.book = bk.title; // best-value book
          }
          // Min over odds: most negative (tightest market = true probability consensus)
          if (pair.over < existing.minOverOdds) existing.minOverOdds = pair.over;
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
      minOverOdds: entry.minOverOdds,
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

// Returns "YYYY-MM-DD" in US/Eastern time — used as the ladder's date key.
function todayEasternDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

// Load a persisted ladder from DB for this sport + today's date. Returns null if not yet generated.
async function loadLadderFromDb(sport: string): Promise<AILadderParlay | null> {
  try {
    const rows = await db
      .select()
      .from(dailyLaddersTable)
      .where(and(eq(dailyLaddersTable.sport, sport), eq(dailyLaddersTable.date, todayEasternDate())))
      .limit(1);
    if (rows.length > 0) return rows[0].ladderJson as AILadderParlay;
  } catch { /* ignore DB errors — fall through to generate */ }
  return null;
}

// Persist a generated ladder so it never changes during the same calendar day.
async function saveLadderToDb(sport: string, ladder: AILadderParlay): Promise<void> {
  try {
    await db
      .insert(dailyLaddersTable)
      .values({ sport, date: todayEasternDate(), ladderJson: ladder as any })
      .onConflictDoNothing(); // If another request raced us, keep the first one
  } catch { /* ignore — ladder will still be used in-memory for this request */ }
}

// ── Daily picks DB persistence ────────────────────────────────────────────────
// Locks, parlays, and every other pick are generated ONCE per sport per day.
// They never change mid-day — no matter how many times the server restarts or
// the cache expires. The ONLY exception: if a game that appears in a pick has
// already started (startTime < now), the picks are considered stale and are
// regenerated so no started-game legs remain on the board.
// Ladders are intentionally excluded from this staleness check — they are a
// 1-bet-per-day product and never change regardless of game starts.

// Returns true if any non-ladder pick leg references a game that has already started.
function picksAreStale(picks: AIPicksResponse): boolean {
  const now = Date.now();
  const parlayFields: Array<keyof AIPicksResponse> = [
    "safeParlay", "lottoParlay", "gameParlayOfTheDay", "propParlayOfTheDay",
    "mixParlayOfTheDay", "allSafeParlay", "allLottoParlay", "allGameParlay",
    "allPropsParlay", "allMixParlay", "hrParlay", "goalScorerParlay",
    "threePtParlay", "tdParlay",
  ];

  // Check the lock of the day
  if (picks.lockOfTheDay && new Date(picks.lockOfTheDay.startTime).getTime() <= now) {
    return true;
  }

  // Check every parlay's legs
  for (const field of parlayFields) {
    const parlay = picks[field] as AIParlay | null;
    if (!parlay) continue;
    for (const leg of parlay.legs) {
      if (new Date(leg.startTime).getTime() <= now) return true;
    }
  }

  return false;
}

async function loadPicksFromDb(sport: string): Promise<AIPicksResponse | null> {
  try {
    const rows = await db
      .select()
      .from(dailyPicksTable)
      .where(and(eq(dailyPicksTable.sport, sport), eq(dailyPicksTable.date, todayEasternDate())))
      .limit(1);
    if (rows.length === 0) return null;

    const picks = rows[0].picksJson as AIPicksResponse;

    // If any leg's game has already started, invalidate and regenerate.
    if (picksAreStale(picks)) {
      // Delete the stale row — next request will generate fresh picks without started games.
      await db
        .delete(dailyPicksTable)
        .where(and(eq(dailyPicksTable.sport, sport), eq(dailyPicksTable.date, todayEasternDate())));
      return null;
    }

    return picks;
  } catch { /* ignore DB errors — fall through to generate */ }
  return null;
}

async function savePicksToDb(sport: string, picks: AIPicksResponse): Promise<void> {
  try {
    await db
      .insert(dailyPicksTable)
      .values({ sport, date: todayEasternDate(), picksJson: picks as any })
      .onConflictDoNothing(); // first-write wins — keeps picks stable if two requests race
  } catch { /* ignore — picks still served from this request's memory */ }
}

async function deletePicksFromDb(sport: string | null): Promise<void> {
  try {
    if (sport && sport !== "all") {
      await db
        .delete(dailyPicksTable)
        .where(and(eq(dailyPicksTable.sport, sport), eq(dailyPicksTable.date, todayEasternDate())));
    } else {
      await db
        .delete(dailyPicksTable)
        .where(eq(dailyPicksTable.date, todayEasternDate()));
    }
  } catch { /* ignore */ }
}

// Label → API key for sports that have player props in our system.
// Sports NOT in this map (Soccer, MMA, Boxing, NCAAB, NCAAF, WNBA) get no props.
const SPORT_LABEL: Record<string, string> = {
  NBA: "basketball_nba",
  MLB: "baseball_mlb",
  NHL: "icehockey_nhl",
  NFL: "americanfootball_nfl",
};

// lowercase label → canonical label (e.g. "soccer" → "Soccer", "mma" → "MMA")
// Built from the unique values of SPORT_API_TO_LABEL so it stays in sync automatically.
const LABEL_LOWER_MAP: Record<string, string> = {};
for (const label of Object.values(SPORT_API_TO_LABEL)) {
  LABEL_LOWER_MAP[label.toLowerCase()] = label;
}

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
      homeTeam: "Baltimore Orioles",
      awayTeam: "Toronto Blue Jays",
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
      homeTeam: "Baltimore Orioles",
      awayTeam: "Toronto Blue Jays",
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

  // ── Sport-specific prop parlays ───────────────────────────────────────────

  const hrParlayLegs: AIPickLeg[] = [
    { gameId: "mlb-mock-4", sport: "MLB", homeTeam: "New York Yankees", awayTeam: "Boston Red Sox",
      startTime: new Date(now + 3 * 3600_000).toISOString(), pick: "Aaron Judge Over 0.5 Home Runs",
      betType: "player_prop", player: "Aaron Judge", bookmaker: "DraftKings", odds: +230 },
    { gameId: "mlb-mock-2", sport: "MLB", homeTeam: "Baltimore Orioles", awayTeam: "Toronto Blue Jays",
      startTime: new Date(now + 2 * 3600_000).toISOString(), pick: "Pete Alonso Over 0.5 Home Runs",
      betType: "player_prop", player: "Pete Alonso", bookmaker: "FanDuel", odds: +215 },
    { gameId: "mlb-mock-3", sport: "MLB", homeTeam: "Houston Astros", awayTeam: "Seattle Mariners",
      startTime: new Date(now + 4 * 3600_000).toISOString(), pick: "Yordan Alvarez Over 0.5 Home Runs",
      betType: "player_prop", player: "Yordan Alvarez", bookmaker: "BetMGM", odds: +200 },
  ];
  const hrParlay: AIParlay = {
    id: "hr-1", name: "MLB Home Run 3-Legger", legs: hrParlayLegs,
    combinedOdds: calcCombinedOdds(hrParlayLegs), confidence: 22,
    reasoning: "Judge vs a lefty prone to long balls, Alonso at hitter-friendly Citi Field, and Alvarez on a power streak. All three face starters ranked in the bottom-10 for HR allowed rate.",
  };

  const goalScorerLegs: AIPickLeg[] = [
    { gameId: "nhl-mock-1", sport: "NHL", homeTeam: "Florida Panthers", awayTeam: "Toronto Maple Leafs",
      startTime: new Date(now + 7 * 3600_000).toISOString(), pick: "Matthew Tkachuk Anytime Goal Scorer",
      betType: "player_prop", player: "Matthew Tkachuk", bookmaker: "FanDuel", odds: +170 },
    { gameId: "nhl-mock-2", sport: "NHL", homeTeam: "Colorado Avalanche", awayTeam: "Edmonton Oilers",
      startTime: new Date(now + 6 * 3600_000).toISOString(), pick: "Leon Draisaitl Anytime Goal Scorer",
      betType: "player_prop", player: "Leon Draisaitl", bookmaker: "DraftKings", odds: +160 },
    { gameId: "nhl-mock-3", sport: "NHL", homeTeam: "Boston Bruins", awayTeam: "Tampa Bay Lightning",
      startTime: new Date(now + 5 * 3600_000).toISOString(), pick: "Nikita Kucherov Anytime Goal Scorer",
      betType: "player_prop", player: "Nikita Kucherov", bookmaker: "BetMGM", odds: +155 },
  ];
  const goalScorerParlay: AIParlay = {
    id: "goal-scorer-1", name: "NHL Goal Scorer 3-Legger", legs: goalScorerLegs,
    combinedOdds: calcCombinedOdds(goalScorerLegs), confidence: 19,
    reasoning: "Tkachuk leads Florida in shots on goal, Draisaitl is on a 5-game goal streak, and Kucherov is averaging 0.55 goals/game vs Boston this season. All three face goalies outside the top-15 in save%.",
  };

  const threePtLegs: AIPickLeg[] = [
    { gameId: "nba-mock-4", sport: "NBA", homeTeam: "Golden State Warriors", awayTeam: "Sacramento Kings",
      startTime: new Date(now + 5 * 3600_000).toISOString(), pick: "Stephen Curry Over 4.5 Threes",
      betType: "player_prop", player: "Stephen Curry", bookmaker: "DraftKings", odds: +115 },
    { gameId: "nba-mock-2", sport: "NBA", homeTeam: "Cleveland Cavaliers", awayTeam: "Miami Heat",
      startTime: new Date(now + 6 * 3600_000).toISOString(), pick: "Donovan Mitchell Over 3.5 Threes",
      betType: "player_prop", player: "Donovan Mitchell", bookmaker: "FanDuel", odds: +130 },
    { gameId: "nba-mock-5", sport: "NBA", homeTeam: "Milwaukee Bucks", awayTeam: "Chicago Bulls",
      startTime: new Date(now + 7 * 3600_000).toISOString(), pick: "Damian Lillard Over 3.5 Threes",
      betType: "player_prop", player: "Damian Lillard", bookmaker: "BetMGM", odds: +125 },
  ];
  const threePtParlay: AIParlay = {
    id: "3pt-1", name: "NBA 3PT 3-Legger", legs: threePtLegs,
    combinedOdds: calcCombinedOdds(threePtLegs), confidence: 28,
    reasoning: "Curry, Mitchell, and Lillard each face defenses ranked bottom-third for opponent three-point rate this week. High volume guaranteed from all three — this is about whether they run hot from deep.",
  };

  const tdLegs: AIPickLeg[] = [
    { gameId: "nfl-mock-1", sport: "NFL", homeTeam: "Kansas City Chiefs", awayTeam: "Las Vegas Raiders",
      startTime: new Date(now + 6 * 3600_000).toISOString(), pick: "Travis Kelce Anytime TD",
      betType: "player_prop", player: "Travis Kelce", bookmaker: "DraftKings", odds: +130 },
    { gameId: "nfl-mock-2", sport: "NFL", homeTeam: "Dallas Cowboys", awayTeam: "Philadelphia Eagles",
      startTime: new Date(now + 4 * 3600_000).toISOString(), pick: "CeeDee Lamb Anytime TD",
      betType: "player_prop", player: "CeeDee Lamb", bookmaker: "FanDuel", odds: +115 },
    { gameId: "nfl-mock-3", sport: "NFL", homeTeam: "Green Bay Packers", awayTeam: "Detroit Lions",
      startTime: new Date(now + 5 * 3600_000).toISOString(), pick: "Davante Adams Anytime TD",
      betType: "player_prop", player: "Davante Adams", bookmaker: "BetMGM", odds: +120 },
  ];
  const tdParlay: AIParlay = {
    id: "td-1", name: "NFL TD 3-Legger", legs: tdLegs,
    combinedOdds: calcCombinedOdds(tdLegs), confidence: 24,
    reasoning: "Kelce in a pace-up divisional spot, Lamb facing a leaky Eagles secondary in the red zone, and Adams as a preferred target near the goal line. All three are in favorable game scripts for TDs.",
  };

  // ── Ladder parlays ($10 → $10k) ────────────────────────────────────────────

  // Build a daily-compounding ladder from an array of legs at ~+100 odds
  function makeDailyLadder(legs: AIPickLeg[]): AILadderStep[] {
    const steps: AILadderStep[] = [];
    let stake = 10;
    for (let i = 0; i + 1 < legs.length; i += 2) {
      const leg1 = legs[i];
      const leg2 = legs[i + 1];
      const dec1 = leg1.odds > 0 ? leg1.odds / 100 + 1 : 100 / Math.abs(leg1.odds) + 1;
      const dec2 = leg2.odds > 0 ? leg2.odds / 100 + 1 : 100 / Math.abs(leg2.odds) + 1;
      const combined = dec1 * dec2;
      const targetWin = parseFloat((stake * combined).toFixed(2));
      steps.push({ day: steps.length + 1, stake: parseFloat(stake.toFixed(2)), targetWin, legs: [leg1, leg2] });
      stake = targetWin;
    }
    return steps;
  }

  // NBA daily ladder — heavy favorite 2-leg parlays (~-250 each, combined near even money)
  const nbaLadderLegs: AIPickLeg[] = [
    { gameId: "nba-mock-1", sport: "NBA", homeTeam: "Oklahoma City Thunder", awayTeam: "Dallas Mavericks",
      startTime: new Date(now + 5 * 3600_000).toISOString(), pick: "SGA Over 18.5 Points",
      betType: "player_prop", player: "Shai Gilgeous-Alexander", bookmaker: "DraftKings", odds: -260 },
    { gameId: "nba-mock-2", sport: "NBA", homeTeam: "Denver Nuggets", awayTeam: "Phoenix Suns",
      startTime: new Date(now + 6 * 3600_000).toISOString(), pick: "Nikola Jokic Over 6.5 Rebounds",
      betType: "player_prop", player: "Nikola Jokic", bookmaker: "FanDuel", odds: -240 },
    { gameId: "nba-mock-3", sport: "NBA", homeTeam: "Boston Celtics", awayTeam: "New York Knicks",
      startTime: new Date(now + 7 * 3600_000).toISOString(), pick: "Jayson Tatum Over 14.5 Points",
      betType: "player_prop", player: "Jayson Tatum", bookmaker: "BetMGM", odds: -270 },
    { gameId: "nba-mock-4", sport: "NBA", homeTeam: "Golden State Warriors", awayTeam: "Sacramento Kings",
      startTime: new Date(now + 6 * 3600_000).toISOString(), pick: "Steph Curry Over 14.5 Points",
      betType: "player_prop", player: "Stephen Curry", bookmaker: "FanDuel", odds: -250 },
    { gameId: "nba-mock-5", sport: "NBA", homeTeam: "Indiana Pacers", awayTeam: "Miami Heat",
      startTime: new Date(now + 7 * 3600_000).toISOString(), pick: "Tyrese Haliburton Over 8.5 Assists",
      betType: "player_prop", player: "Tyrese Haliburton", bookmaker: "DraftKings", odds: -220 },
    { gameId: "nba-mock-6", sport: "NBA", homeTeam: "Los Angeles Lakers", awayTeam: "Minnesota Timberwolves",
      startTime: new Date(now + 8 * 3600_000).toISOString(), pick: "Anthony Davis Over 8.5 Rebounds",
      betType: "player_prop", player: "Anthony Davis", bookmaker: "BetMGM", odds: -250 },
    { gameId: "nba-mock-7", sport: "NBA", homeTeam: "Philadelphia 76ers", awayTeam: "Chicago Bulls",
      startTime: new Date(now + 5 * 3600_000).toISOString(), pick: "Tyrese Maxey Over 14.5 Points",
      betType: "player_prop", player: "Tyrese Maxey", bookmaker: "DraftKings", odds: -230 },
    { gameId: "nba-mock-8", sport: "NBA", homeTeam: "Miami Heat", awayTeam: "Cleveland Cavaliers",
      startTime: new Date(now + 6 * 3600_000).toISOString(), pick: "Bam Adebayo Over 8.5 Rebounds",
      betType: "player_prop", player: "Bam Adebayo", bookmaker: "FanDuel", odds: -260 },
    { gameId: "nba-mock-9", sport: "NBA", homeTeam: "Milwaukee Bucks", awayTeam: "Orlando Magic",
      startTime: new Date(now + 7 * 3600_000).toISOString(), pick: "Damian Lillard Over 14.5 Points",
      betType: "player_prop", player: "Damian Lillard", bookmaker: "BetMGM", odds: -240 },
    { gameId: "nba-mock-10", sport: "NBA", homeTeam: "Los Angeles Clippers", awayTeam: "Utah Jazz",
      startTime: new Date(now + 6 * 3600_000).toISOString(), pick: "Ivica Zubac Over 7.5 Rebounds",
      betType: "player_prop", player: "Ivica Zubac", bookmaker: "DraftKings", odds: -230 },
  ];
  const nbaLadder: AILadderParlay = {
    id: "ladder-nba", name: "NBA Daily Ladder", sport: "NBA",
    startStake: 10, targetPayout: 10240, totalDays: 10,
    steps: makeDailyLadder(nbaLadderLegs), confidence: 60,
    reasoning: "Two heavy favorites per day — each leg is around -240 to -270, which means it's highly likely to win. Combined, the 2-leg parlay lands near even money. Win both legs today and roll the payout to tomorrow's pair. 10 days in a row turns $10 into $10K+.",
  };

  // MLB daily ladder — heavy favorite 2-leg parlays
  const mlbLadderLegs: AIPickLeg[] = [
    { gameId: "mlb-mock-1", sport: "MLB", homeTeam: "New York Mets", awayTeam: "Colorado Rockies",
      startTime: new Date(now + 2 * 3600_000).toISOString(), pick: "Francisco Lindor Over 0.5 Hits",
      betType: "player_prop", player: "Francisco Lindor", bookmaker: "DraftKings", odds: -280 },
    { gameId: "mlb-mock-2", sport: "MLB", homeTeam: "Los Angeles Dodgers", awayTeam: "San Diego Padres",
      startTime: new Date(now + 3 * 3600_000).toISOString(), pick: "Shohei Ohtani Over 0.5 Total Bases",
      betType: "player_prop", player: "Shohei Ohtani", bookmaker: "FanDuel", odds: -290 },
    { gameId: "mlb-mock-3", sport: "MLB", homeTeam: "New York Yankees", awayTeam: "Boston Red Sox",
      startTime: new Date(now + 3 * 3600_000).toISOString(), pick: "Juan Soto Over 0.5 Total Bases",
      betType: "player_prop", player: "Juan Soto", bookmaker: "BetMGM", odds: -270 },
    { gameId: "mlb-mock-4", sport: "MLB", homeTeam: "Atlanta Braves", awayTeam: "Philadelphia Phillies",
      startTime: new Date(now + 3 * 3600_000).toISOString(), pick: "Ronald Acuña Jr. Over 0.5 Total Bases",
      betType: "player_prop", player: "Ronald Acuña Jr.", bookmaker: "DraftKings", odds: -250 },
    { gameId: "mlb-mock-5", sport: "MLB", homeTeam: "Houston Astros", awayTeam: "Seattle Mariners",
      startTime: new Date(now + 4 * 3600_000).toISOString(), pick: "Yordan Alvarez Over 0.5 Total Bases",
      betType: "player_prop", player: "Yordan Alvarez", bookmaker: "FanDuel", odds: -260 },
    { gameId: "mlb-mock-6", sport: "MLB", homeTeam: "Chicago Cubs", awayTeam: "St. Louis Cardinals",
      startTime: new Date(now + 4 * 3600_000).toISOString(), pick: "Kyle Tucker Over 0.5 Total Bases",
      betType: "player_prop", player: "Kyle Tucker", bookmaker: "BetMGM", odds: -240 },
    { gameId: "mlb-mock-7", sport: "MLB", homeTeam: "Tampa Bay Rays", awayTeam: "Toronto Blue Jays",
      startTime: new Date(now + 4 * 3600_000).toISOString(), pick: "Vladimir Guerrero Jr. Over 0.5 Hits",
      betType: "player_prop", player: "Vladimir Guerrero Jr.", bookmaker: "DraftKings", odds: -270 },
    { gameId: "mlb-mock-8", sport: "MLB", homeTeam: "Arizona Diamondbacks", awayTeam: "Pittsburgh Pirates",
      startTime: new Date(now + 5 * 3600_000).toISOString(), pick: "Ketel Marte Over 0.5 Total Bases",
      betType: "player_prop", player: "Ketel Marte", bookmaker: "FanDuel", odds: -250 },
    { gameId: "mlb-mock-9", sport: "MLB", homeTeam: "Cincinnati Reds", awayTeam: "Milwaukee Brewers",
      startTime: new Date(now + 5 * 3600_000).toISOString(), pick: "Elly De La Cruz Over 0.5 Hits",
      betType: "player_prop", player: "Elly De La Cruz", bookmaker: "BetMGM", odds: -260 },
    { gameId: "mlb-mock-10", sport: "MLB", homeTeam: "Minnesota Twins", awayTeam: "Detroit Tigers",
      startTime: new Date(now + 5 * 3600_000).toISOString(), pick: "Byron Buxton Over 0.5 Total Bases",
      betType: "player_prop", player: "Byron Buxton", bookmaker: "DraftKings", odds: -240 },
  ];
  const mlbLadder: AILadderParlay = {
    id: "ladder-mlb", name: "MLB Daily Ladder", sport: "MLB",
    startStake: 10, targetPayout: 10240, totalDays: 10,
    steps: makeDailyLadder(mlbLadderLegs), confidence: 62,
    reasoning: "Two elite hitters per day — each leg is Over 0.5 Hits or Total Bases at -250 to -290. These are near-certainties for your best hitters facing average pitching. Pair two locks, collect near even-money combined, and roll the winnings daily.",
  };

  // NHL daily ladder — heavy favorite 2-leg parlays
  const nhlLadderLegs: AIPickLeg[] = [
    { gameId: "nhl-mock-1", sport: "NHL", homeTeam: "Colorado Avalanche", awayTeam: "Edmonton Oilers",
      startTime: new Date(now + 5 * 3600_000).toISOString(), pick: "Nathan MacKinnon Over 0.5 Points",
      betType: "player_prop", player: "Nathan MacKinnon", bookmaker: "DraftKings", odds: -270 },
    { gameId: "nhl-mock-2", sport: "NHL", homeTeam: "Florida Panthers", awayTeam: "Toronto Maple Leafs",
      startTime: new Date(now + 6 * 3600_000).toISOString(), pick: "Auston Matthews Over 0.5 Shots On Goal",
      betType: "player_prop", player: "Auston Matthews", bookmaker: "FanDuel", odds: -280 },
    { gameId: "nhl-mock-3", sport: "NHL", homeTeam: "Boston Bruins", awayTeam: "Tampa Bay Lightning",
      startTime: new Date(now + 5 * 3600_000).toISOString(), pick: "David Pastrnak Over 0.5 Points",
      betType: "player_prop", player: "David Pastrnak", bookmaker: "BetMGM", odds: -250 },
    { gameId: "nhl-mock-4", sport: "NHL", homeTeam: "New Jersey Devils", awayTeam: "New York Islanders",
      startTime: new Date(now + 7 * 3600_000).toISOString(), pick: "Jack Hughes Over 0.5 Points",
      betType: "player_prop", player: "Jack Hughes", bookmaker: "DraftKings", odds: -260 },
    { gameId: "nhl-mock-5", sport: "NHL", homeTeam: "Carolina Hurricanes", awayTeam: "New York Rangers",
      startTime: new Date(now + 6 * 3600_000).toISOString(), pick: "Sebastian Aho Over 0.5 Points",
      betType: "player_prop", player: "Sebastian Aho", bookmaker: "FanDuel", odds: -240 },
    { gameId: "nhl-mock-6", sport: "NHL", homeTeam: "Dallas Stars", awayTeam: "Minnesota Wild",
      startTime: new Date(now + 6 * 3600_000).toISOString(), pick: "Jason Robertson Over 0.5 Shots On Goal",
      betType: "player_prop", player: "Jason Robertson", bookmaker: "BetMGM", odds: -270 },
    { gameId: "nhl-mock-7", sport: "NHL", homeTeam: "Nashville Predators", awayTeam: "Winnipeg Jets",
      startTime: new Date(now + 7 * 3600_000).toISOString(), pick: "Mark Scheifele Over 0.5 Points",
      betType: "player_prop", player: "Mark Scheifele", bookmaker: "DraftKings", odds: -250 },
    { gameId: "nhl-mock-8", sport: "NHL", homeTeam: "Detroit Red Wings", awayTeam: "Ottawa Senators",
      startTime: new Date(now + 5 * 3600_000).toISOString(), pick: "Dylan Larkin Over 0.5 Points",
      betType: "player_prop", player: "Dylan Larkin", bookmaker: "FanDuel", odds: -240 },
    { gameId: "nhl-mock-9", sport: "NHL", homeTeam: "Pittsburgh Penguins", awayTeam: "Buffalo Sabres",
      startTime: new Date(now + 6 * 3600_000).toISOString(), pick: "Evgeni Malkin Over 0.5 Points",
      betType: "player_prop", player: "Evgeni Malkin", bookmaker: "BetMGM", odds: -260 },
    { gameId: "nhl-mock-10", sport: "NHL", homeTeam: "Vegas Golden Knights", awayTeam: "Anaheim Ducks",
      startTime: new Date(now + 5 * 3600_000).toISOString(), pick: "Mark Stone Over 0.5 Shots On Goal",
      betType: "player_prop", player: "Mark Stone", bookmaker: "DraftKings", odds: -250 },
  ];
  const nhlLadder: AILadderParlay = {
    id: "ladder-nhl", name: "NHL Daily Ladder", sport: "NHL",
    startStake: 10, targetPayout: 10240, totalDays: 10,
    steps: makeDailyLadder(nhlLadderLegs), confidence: 60,
    reasoning: "Two elite NHL players per day — each leg is Over 0.5 Points or Shots at -240 to -280. Top-line forwards averaging 1+ points per game rarely go pointless. Parlay two of them, collect near even-money combined, and roll the bankroll daily.",
  };

  // NFL daily ladder — heavy favorite 2-leg parlays
  const nflLadderLegs: AIPickLeg[] = [
    { gameId: "nfl-mock-1", sport: "NFL", homeTeam: "Kansas City Chiefs", awayTeam: "Las Vegas Raiders",
      startTime: new Date(now + 6 * 3600_000).toISOString(), pick: "Travis Kelce Over 2.5 Receptions",
      betType: "player_prop", player: "Travis Kelce", bookmaker: "DraftKings", odds: -280 },
    { gameId: "nfl-mock-2", sport: "NFL", homeTeam: "Dallas Cowboys", awayTeam: "Philadelphia Eagles",
      startTime: new Date(now + 4 * 3600_000).toISOString(), pick: "CeeDee Lamb Over 2.5 Receptions",
      betType: "player_prop", player: "CeeDee Lamb", bookmaker: "FanDuel", odds: -260 },
    { gameId: "nfl-mock-3", sport: "NFL", homeTeam: "Buffalo Bills", awayTeam: "Miami Dolphins",
      startTime: new Date(now + 5 * 3600_000).toISOString(), pick: "Josh Allen Over 0.5 Pass TDs",
      betType: "player_prop", player: "Josh Allen", bookmaker: "BetMGM", odds: -240 },
    { gameId: "nfl-mock-4", sport: "NFL", homeTeam: "San Francisco 49ers", awayTeam: "Los Angeles Rams",
      startTime: new Date(now + 7 * 3600_000).toISOString(), pick: "Christian McCaffrey Over 2.5 Receptions",
      betType: "player_prop", player: "Christian McCaffrey", bookmaker: "DraftKings", odds: -270 },
    { gameId: "nfl-mock-5", sport: "NFL", homeTeam: "Minnesota Vikings", awayTeam: "Chicago Bears",
      startTime: new Date(now + 6 * 3600_000).toISOString(), pick: "Justin Jefferson Over 2.5 Receptions",
      betType: "player_prop", player: "Justin Jefferson", bookmaker: "FanDuel", odds: -250 },
    { gameId: "nfl-mock-6", sport: "NFL", homeTeam: "Cincinnati Bengals", awayTeam: "Pittsburgh Steelers",
      startTime: new Date(now + 7 * 3600_000).toISOString(), pick: "Ja'Marr Chase Over 2.5 Receptions",
      betType: "player_prop", player: "Ja'Marr Chase", bookmaker: "BetMGM", odds: -260 },
    { gameId: "nfl-mock-7", sport: "NFL", homeTeam: "Miami Dolphins", awayTeam: "New England Patriots",
      startTime: new Date(now + 4 * 3600_000).toISOString(), pick: "Tyreek Hill Over 2.5 Receptions",
      betType: "player_prop", player: "Tyreek Hill", bookmaker: "DraftKings", odds: -270 },
    { gameId: "nfl-mock-8", sport: "NFL", homeTeam: "Green Bay Packers", awayTeam: "Detroit Lions",
      startTime: new Date(now + 5 * 3600_000).toISOString(), pick: "Jayden Reed Over 2.5 Receptions",
      betType: "player_prop", player: "Jayden Reed", bookmaker: "FanDuel", odds: -240 },
    { gameId: "nfl-mock-9", sport: "NFL", homeTeam: "Seattle Seahawks", awayTeam: "Los Angeles Chargers",
      startTime: new Date(now + 6 * 3600_000).toISOString(), pick: "Jaxon Smith-Njigba Over 2.5 Receptions",
      betType: "player_prop", player: "Jaxon Smith-Njigba", bookmaker: "BetMGM", odds: -250 },
    { gameId: "nfl-mock-10", sport: "NFL", homeTeam: "Tennessee Titans", awayTeam: "Indianapolis Colts",
      startTime: new Date(now + 5 * 3600_000).toISOString(), pick: "Jonathan Taylor Over 8.5 Carries",
      betType: "player_prop", player: "Jonathan Taylor", bookmaker: "DraftKings", odds: -260 },
  ];
  const nflLadder: AILadderParlay = {
    id: "ladder-nfl", name: "NFL Daily Ladder", sport: "NFL",
    startStake: 10, targetPayout: 10240, totalDays: 10,
    steps: makeDailyLadder(nflLadderLegs), confidence: 60,
    reasoning: "Two elite skill players per day — low reception lines (-250 to -280) for your WR1s and TEs. A target-share monster catching 3+ passes is a near-lock each week. Parlay two of them, cash near even-money combined, and compound daily.",
  };

  // All-sports ladder: alternates NBA + MLB heavy favorites
  const allLadderLegs: AIPickLeg[] = [
    nbaLadderLegs[0], mlbLadderLegs[0], nbaLadderLegs[1], mlbLadderLegs[1],
    nhlLadderLegs[0], nbaLadderLegs[2], mlbLadderLegs[2], nhlLadderLegs[1],
    nbaLadderLegs[3], mlbLadderLegs[3],
  ];
  const allLadder: AILadderParlay = {
    id: "ladder-all", name: "All Sports Daily Ladder", sport: "All",
    startStake: 10, targetPayout: 10240, totalDays: 10,
    steps: makeDailyLadder(allLadderLegs), confidence: 61,
    reasoning: "Two heavy favorites from different sports each day — typically one NBA prop (-250 to -270) and one MLB/NHL prop (-250 to -290). Each individual leg is a near-certainty. Combined parlay lands near even money. Win both every day for 10 days to turn $10 into $10K+.",
  };

  // Fallback cross-sport parlays reuse the already-mixed fallback legs
  const allSafeParlay: AIParlay = {
    id: "all-safe-1", name: "Cross-Sport Value Parlay",
    legs: [safeParlayLeg1, safeParlayLeg2],
    combinedOdds: calcCombinedOdds([safeParlayLeg1, safeParlayLeg2]),
    confidence: 60,
    reasoning: "One NBA and one MLB game bet each carrying a positive edge — a conservative two-sport parlay targeting solid upside.",
  };
  const allLottoParlay: AIParlay = { ...lottoParlay, id: "all-lotto-1", name: "Cross-Sport 5-Leg Lotto" };
  const allGameParlay: AIParlay = { ...gameParlayOfTheDay, id: "all-game-1", name: "Cross-Sport Game 3-Legger" };
  const allPropsParlay: AIParlay = {
    id: "all-props-1", name: "Cross-Sport Props 3-Legger",
    legs: propParlayLegs, combinedOdds: calcCombinedOdds(propParlayLegs), confidence: 43,
    reasoning: "Player props sampled from NBA and MLB — SGA scoring, Garland assists, and Alonso RBIs. Each from a different game and sport.",
  };
  const allMixParlay: AIParlay = { ...mixParlayOfTheDay, id: "all-mix-1", name: "Cross-Sport Mix 4-Legger" };

  return {
    lockOfTheDay,
    safeParlay,
    lottoParlay,
    gameParlayOfTheDay,
    propParlayOfTheDay,
    mixParlayOfTheDay,
    allSafeParlay,
    allLottoParlay,
    allGameParlay,
    allPropsParlay,
    allMixParlay,
    hrParlay,
    goalScorerParlay,
    threePtParlay,
    tdParlay,
    allLadder,
    nbaLadder,
    mlbLadder,
    nhlLadder,
    nflLadder,
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
  // Resolve to canonical label: API key → label, OR lowercase label → label, OR uppercase fallback
  const cacheKey = sportRaw === "all"
    ? "all"
    : (SPORT_FROM_KEY[sportRaw] ?? LABEL_LOWER_MAP[sportRaw] ?? sportRaw.toUpperCase());

  const cached = picksCacheMap.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return res.json(cached.data);
  }

  // Check DB for today's persisted picks — generated once, stable all day.
  const dbPicks = await loadPicksFromDb(cacheKey);
  if (dbPicks) {
    // Refresh the in-memory cache so subsequent requests don't hit the DB every time.
    picksCacheMap.set(cacheKey, { data: dbPicks, expiresAt: Date.now() + CACHE_TTL });
    return res.json(dbPicks);
  }

  try {
    const allOddsRaw = await fetchAllSportOdds();

    // ── Adaptive cutoff ────────────────────────────────────────────────────────
    // Use today's games if any are still upcoming; otherwise extend to tomorrow,
    // then the day after (up to 2 days ahead) so picks are always available even
    // after all of today's games have started.
    const nowMs = Date.now();
    function hasUpcomingGames(cutoff: number): boolean {
      return allOddsRaw.some(({ events }) =>
        events.some((ev) => {
          const t = new Date(ev.commence_time).getTime();
          return t > nowMs && t <= cutoff;
        }),
      );
    }
    const todayCutoffMs =
      hasUpcomingGames(endOfDayEasternMs(0)) ? endOfDayEasternMs(0) :
      hasUpcomingGames(endOfDayEasternMs(1)) ? endOfDayEasternMs(1) :
      endOfDayEasternMs(2); // fallback: 2 days ahead

    // cacheKey is now a label key ("NBA","MLB"…) matching allOddsRaw[i].sport
    const sportApiKey = cacheKey !== "all" ? SPORT_LABEL[cacheKey] : null;
    const allOdds = cacheKey !== "all"
      ? allOddsRaw.filter((s) => s.sport === cacheKey)
      : allOddsRaw;

    // Fetch real player props — always use the full slate (all sports) so sport-specific
    // parlay builders (HR, goal scorer, 3PT, TD, ladders) have data regardless of the
    // active sport filter. The filteredProps variable below re-applies the sport filter
    // for the existing generic parlays.
    const rawProps = await fetchRealPropsForAI(allOddsRaw, todayCutoffMs);

    // Fetch lineup/injury data, steam map, and weather penalties in parallel.
    const allEventsFlat = allOddsRaw.flatMap(({ sport, events }) =>
      events.map((ev) => ({ sport, ev })),
    );
    const activeSports = allOddsRaw.map((s) => s.sport);
    const [mlbLineups, nbaOut, nhlOut, steamMap, weatherPenaltyGameIds] = await Promise.all([
      fetchMlbLineupNames(),                      // MLB: whitelist confirmed starters
      fetchNbaOut(),                              // NBA: blacklist OUT players
      fetchNhlOut(),                              // NHL: blacklist OUT players
      buildSteamMap(),                            // Line movement signal from DB
      buildWeatherPenaltySet(allEventsFlat),      // MLB outdoor Over penalty
      warmEloCache(activeSports),                 // pre-warm ESPN + pitcher cache (fire & forget)
    ]);

    const realProps = rawProps.filter((p) => {
      if (p.sport === "baseball_mlb") {
        // If lineups posted, only include confirmed starters
        return !mlbLineups || mlbLineups.has(p.player);
      }
      if (p.sport === "basketball_nba") {
        // Exclude players marked OUT
        return !nbaOut || !nbaOut.has(p.player);
      }
      if (p.sport === "icehockey_nhl") {
        // Exclude players marked OUT
        return !nhlOut || !nhlOut.has(p.player);
      }
      return true;
    });

    // Sports not in SPORT_LABEL have no props (Soccer, MMA, NCAAB, etc.) → empty
    const filteredProps = cacheKey === "all"
      ? realProps
      : sportApiKey
        ? realProps.filter((p) => p.sport === sportApiKey)
        : [];

    // ─── Deterministic pick builder — no AI, 100% real data ──────────────────

    // Convert a real prop into a pick leg (pick the better-priced direction)
    // propToFavoriteLeg: picks the HEAVY FAVORITE side (more negative odds)
    // Used for the ladder so each leg is a lock (-200 to -350 range)
    function propToFavoriteLeg(prop: CompactProp): AIPickLeg {
      const direction = prop.overOdds <= prop.underOdds ? "Over" : "Under";
      const odds = direction === "Over" ? prop.overOdds : prop.underOdds;
      const rawMarket = prop.market
        .replace(/^(player_|batter_|pitcher_)/, "")
        .replace(/_/g, " ");
      const marketLabel = rawMarket.replace(/\b\w/g, (c) => c.toUpperCase());
      return {
        gameId: prop.gameId,
        sport: SPORT_FROM_KEY[prop.sport] ?? prop.sport,
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

    function propToLeg(prop: CompactProp): AIPickLeg {
      const direction = prop.overOdds >= prop.underOdds ? "Over" : "Under";
      const odds = direction === "Over" ? prop.overOdds : prop.underOdds;
      const rawMarket = prop.market
        .replace(/^(player_|batter_|pitcher_)/, "")
        .replace(/_/g, " ");
      const marketLabel = rawMarket.replace(/\b\w/g, (c) => c.toUpperCase());
      return {
        gameId: prop.gameId,
        // Normalize API key → display label so prop and game legs share the same sport value
        sport: SPORT_FROM_KEY[prop.sport] ?? prop.sport,
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

    // Convert any OddsEvent into a game leg using the best available line across bookmakers.
    // Prefers h2h (moneyline) — picks the better-priced team (underdog / higher odds). Falls back to totals Over.
    function eventToLeg(event: OddsEvent, sportLabel: string): AIPickLeg | null {
      // Try h2h first
      for (const book of event.bookmakers) {
        const h2h = book.markets.find((m) => m.key === "h2h");
        if (!h2h || h2h.outcomes.length < 2) continue;
        const best = h2h.outcomes.reduce((a, b) => (b.price > a.price ? b : a));
        return {
          gameId: event.id,
          sport: sportLabel,
          homeTeam: event.home_team,
          awayTeam: event.away_team,
          startTime: event.commence_time,
          pick: best.name,
          betType: "moneyline",
          bookmaker: book.key,
          odds: best.price,
          player: null,
        };
      }
      // Fall back to totals Over
      for (const book of event.bookmakers) {
        const totals = book.markets.find((m) => m.key === "totals");
        if (!totals) continue;
        const over = totals.outcomes.find((o) => o.name === "Over");
        if (!over) continue;
        return {
          gameId: event.id,
          sport: sportLabel,
          homeTeam: event.home_team,
          awayTeam: event.away_team,
          startTime: event.commence_time,
          pick: `Over ${over.point}`,
          betType: "total",
          bookmaker: book.key,
          odds: over.price,
          player: null,
        };
      }
      return null;
    }

    // eventToFavoriteLeg: like eventToLeg but always picks the FAVORITE (most negative / lowest odds).
    // Used exclusively for Lock of the Day so it never surfaces an underdog as "the lock".
    function eventToFavoriteLeg(event: OddsEvent, sportLabel: string): AIPickLeg | null {
      for (const book of event.bookmakers) {
        const h2h = book.markets.find((m) => m.key === "h2h");
        if (!h2h || h2h.outcomes.length < 2) continue;
        // Favorite = lowest price (most negative American odds)
        const favorite = h2h.outcomes.reduce((a, b) => (b.price < a.price ? b : a));
        return {
          gameId: event.id,
          sport: sportLabel,
          homeTeam: event.home_team,
          awayTeam: event.away_team,
          startTime: event.commence_time,
          pick: favorite.name,
          betType: "moneyline",
          bookmaker: book.key,
          odds: favorite.price,
          player: null,
        };
      }
      // Fall back to totals Under (favorites usually go Under in tight games)
      for (const book of event.bookmakers) {
        const totals = book.markets.find((m) => m.key === "totals");
        if (!totals) continue;
        const under = totals.outcomes.find((o) => o.name === "Under");
        if (!under) continue;
        return {
          gameId: event.id,
          sport: sportLabel,
          homeTeam: event.home_team,
          awayTeam: event.away_team,
          startTime: event.commence_time,
          pick: `Under ${under.point}`,
          betType: "total",
          bookmaker: book.key,
          odds: under.price,
          player: null,
        };
      }
      return null;
    }

    // ── Elo model — build win-prob for every today-game outcome in parallel ──
    // Key: `${gameId}::${teamName}` → EloLookupResult | null
    type EloMap = Map<string, import("../lib/elo-model").EloLookupResult | null>;
    const eloMap: EloMap = new Map();

    {
      const eloPairs: { key: string; homeTeam: string; awayTeam: string; sport: string; team: string }[] = [];
      for (const { sport: sportLabel, events } of allOdds) {
        for (const ev of events) {
          const t = new Date(ev.commence_time).getTime();
          if (t <= nowMs || t > todayCutoffMs) continue;
          eloPairs.push({ key: `${ev.id}::${ev.home_team}`, homeTeam: ev.home_team, awayTeam: ev.away_team, sport: sportLabel, team: ev.home_team });
          eloPairs.push({ key: `${ev.id}::${ev.away_team}`, homeTeam: ev.home_team, awayTeam: ev.away_team, sport: sportLabel, team: ev.away_team });
        }
      }
      const eloResults = await Promise.all(
        eloPairs.map(({ homeTeam, awayTeam, sport, team }) =>
          getEloWinProb(homeTeam, awayTeam, sport, team).catch(() => null),
        ),
      );
      for (let i = 0; i < eloPairs.length; i++) {
        eloMap.set(eloPairs[i].key, eloResults[i]);
      }
    }

    // ── Score-sorted game leg pools ───────────────────────────────────────────
    // Score = book count + de-vig edge + Elo model edge + steam signal + context bonus.
    type GameScore = { score: number; steamScore: number; eloEdgePct: number | null };
    const gameScoreMap = new Map<string, GameScore>(); // key: `${gameId}::${outcomeName}`

    for (const { sport: sportLabel, events } of allOdds) {
      for (const ev of events) {
        const t = new Date(ev.commence_time).getTime();
        if (t <= nowMs || t > todayCutoffMs) continue;

        const bookCount = ev.bookmakers.filter((b) => b.markets.some((m) => m.key === "h2h")).length;
        if (bookCount < minBooks(sportLabel)) continue;

        const byOutcome = new Map<string, number[]>();
        for (const bk of ev.bookmakers) {
          const h2h = bk.markets.find((m) => m.key === "h2h");
          if (!h2h) continue;
          for (const out of h2h.outcomes) {
            if (!byOutcome.has(out.name)) byOutcome.set(out.name, []);
            byOutcome.get(out.name)!.push(out.price);
          }
        }

        const outcomes = [...byOutcome.keys()];
        if (outcomes.length < 2) continue;

        const avgImpl = outcomes.map((name) => {
          const prices = byOutcome.get(name)!;
          const avg = prices.reduce((s, p) => s + (p > 0 ? 100 / (p + 100) : Math.abs(p) / (Math.abs(p) + 100)), 0) / prices.length;
          return { name, avg };
        });
        const totalImpl = avgImpl.reduce((s, o) => s + o.avg, 0);

        for (const { name, avg } of avgImpl) {
          const consensusP = avg / totalImpl;
          const prices = byOutcome.get(name)!;
          const bestOdds = Math.max(...prices);
          const implP = bestOdds > 0 ? 100 / (bestOdds + 100) : Math.abs(bestOdds) / (Math.abs(bestOdds) + 100);
          const bookDeVigEdge = (consensusP - implP) * 100;

          // ── Elo model edge ──
          // Difference between our model's win probability and the book's implied probability.
          // Positive = model thinks the pick is undervalued by the books.
          const eloResult = eloMap.get(`${ev.id}::${name}`);
          const eloEdgePct = eloResult
            ? (eloResult.modelProb - implP) * 100
            : null;
          // Score: 0–35 pts — 2 pts per 1% of model edge, floor at 0
          const eloScore = eloEdgePct != null
            ? Math.min(35, Math.max(0, eloEdgePct * 2))
            : 0;

          const bookScore    = Math.min(25, bookCount * 4);
          const edgeScore    = Math.min(25, Math.max(0, bookDeVigEdge * 10));
          const steamKey     = `${ev.id}::${name}`;
          const steamEntry   = steamMap?.get(steamKey);
          const steamScore   = steamEntry?.direction === "steam" ? steamEntry.score : 0;
          const contextScore = bookCount >= 5 ? 15 : bookCount >= 4 ? 10 : 5;

          gameScoreMap.set(`${ev.id}::${name}`, {
            score: bookScore + edgeScore + eloScore + steamScore + contextScore,
            steamScore,
            eloEdgePct: eloEdgePct != null ? Math.round(eloEdgePct * 10) / 10 : null,
          });
        }
      }
    }

    function getGameScore(gameId: string, outcomeName: string): number {
      return gameScoreMap.get(`${gameId}::${outcomeName}`)?.score ?? 0;
    }
    function getEloEdge(gameId: string, outcomeName: string): number | null {
      return gameScoreMap.get(`${gameId}::${outcomeName}`)?.eloEdgePct ?? null;
    }

    // ── Matchup context map — used by scoreProps for ALL prop picks ───────────
    // Keyed by gameId. Carries Elo edge per side and MLB pitcher info so that
    // every prop leg can be scored against the game's model-derived context.
    const matchupContextMap = new Map<string, MatchupContext>();
    for (const { events } of allOdds) {
      for (const ev of events) {
        const t = new Date(ev.commence_time).getTime();
        if (t <= nowMs || t > todayCutoffMs) continue;
        const homeResult = eloMap.get(`${ev.id}::${ev.home_team}`);
        const awayResult = eloMap.get(`${ev.id}::${ev.away_team}`);
        matchupContextMap.set(ev.id, {
          homeEloEdgePct:   getEloEdge(ev.id, ev.home_team),
          awayEloEdgePct:   getEloEdge(ev.id, ev.away_team),
          homeModelProb:    homeResult?.modelProb ?? null,
          awayModelProb:    awayResult?.modelProb ?? null,
          homePitcherEra:   homeResult?.homePitcher?.era ?? null,
          awayPitcherEra:   homeResult?.awayPitcher?.era ?? null,
          homePitcherName:  homeResult?.homePitcher?.name ?? null,
          awayPitcherName:  homeResult?.awayPitcher?.name ?? null,
        });
      }
    }

    // ── FAVORITE game leg pool (used for safe, game, mix, cross-sport parlays) ──
    // US sports require 3+ books for reliable consensus; international sports
    // (Soccer, MMA, Boxing, etc.) often have only 1–2 books in the feed so we
    // lower the threshold to 1 so their games aren't silently filtered out.
    const US_SPORTS = new Set(["NBA", "MLB", "NHL", "NFL", "NCAAB", "NCAAF", "WNBA"]);
    const minBooks = (sportLabel: string) => US_SPORTS.has(sportLabel) ? 3 : 1;
    const gameLegPool: AIPickLeg[] = [];
    for (const { sport: sportLabel, events } of allOdds) {
      for (const ev of events) {
        const t = new Date(ev.commence_time).getTime();
        if (t <= nowMs || t > todayCutoffMs) continue;
        const bookCount = ev.bookmakers.filter((b) => b.markets.some((m) => m.key === "h2h")).length;
        if (bookCount < minBooks(sportLabel)) continue;
        const leg = eventToFavoriteLeg(ev, sportLabel);
        if (leg) gameLegPool.push(leg);
      }
    }
    // Sort by composite score — highest quality picks first
    gameLegPool.sort((a, b) => getGameScore(b.gameId, b.pick) - getGameScore(a.gameId, a.pick));

    // ── UNDERDOG game leg pool (used exclusively for lotto parlays) ──
    const underdogLegPool: AIPickLeg[] = [];
    for (const { sport: sportLabel, events } of allOdds) {
      for (const ev of events) {
        const t = new Date(ev.commence_time).getTime();
        if (t <= nowMs || t > todayCutoffMs) continue;
        const leg = eventToLeg(ev, sportLabel);
        if (leg) underdogLegPool.push(leg);
      }
    }

    // ── SMART prop pool (safe/game/mix/props parlays) ──
    // Score-sorted: lineup-confirmed, no-injury, steam-backed props rise to top.
    const seenSmartPropPlayers = new Set<string>();
    const rawSmartProps = filteredProps
      .filter((p) => Math.min(p.minOverOdds, p.underOdds) <= -130) // must have clear favorite side
      .map(propToFavoriteLeg);
    const scoredSmartProps = scoreProps(
      rawSmartProps, steamMap, mlbLineups, nbaOut ?? nhlOut, weatherPenaltyGameIds, matchupContextMap,
    );
    const propPool: AIPickLeg[] = scoredSmartProps
      .filter((l) => {
        if (!l.player || seenSmartPropPlayers.has(l.player)) return false;
        seenSmartPropPlayers.add(l.player!);
        return true;
      });

    // ── LOTTO prop pool (lotto parlays only) ──
    // Includes any prop where the better side is not a huge lock (> -300).
    // Sorted by odds descending so plus-money legs come first, capped at +600.
    const LOTTO_MAX_ODDS = 600;
    const seenLottoPropPlayers = new Set<string>();
    const rawLottoProps = filteredProps
      .filter((p) => {
        const best = Math.max(p.overOdds, p.underOdds);
        return best >= -300 && best <= LOTTO_MAX_ODDS;
      })
      .map(propToLeg)
      .filter((l) => l.odds <= LOTTO_MAX_ODDS)
      .sort((a, b) => b.odds - a.odds);
    const scoredLottoProps = scoreProps(
      rawLottoProps, steamMap, mlbLineups, nbaOut ?? nhlOut, weatherPenaltyGameIds, matchupContextMap,
    );
    const lottoPropPool: AIPickLeg[] = scoredLottoProps
      .filter((l) => {
        if (!l.player || seenLottoPropPlayers.has(l.player)) return false;
        seenLottoPropPlayers.add(l.player!);
        return true;
      });

    // If there are no real bets at all for the "all" tab, fall back to mock data.
    // For sport-specific tabs (Soccer, MMA, etc.) never use the NBA mock fallback —
    // return null picks with a message instead so no wrong-sport data is shown.
    if (gameLegPool.length === 0 && propPool.length === 0) {
      if (cacheKey !== "all") {
        const emptyResult: AIPicksResponse = {
          lockOfTheDay: null, safeParlay: null, lottoParlay: null,
          gameParlayOfTheDay: null, propParlayOfTheDay: null, mixParlayOfTheDay: null,
          allSafeParlay: null, allLottoParlay: null, allGameParlay: null,
          allPropsParlay: null, allMixParlay: null,
          hrParlay: null, goalScorerParlay: null, threePtParlay: null, tdParlay: null,
          allLadder: null, nbaLadder: null, mlbLadder: null, nhlLadder: null, nflLadder: null,
          summary: `No ${cacheKey} games on the board with enough market coverage today.`,
          generatedAt: new Date().toISOString(),
          isAI: false,
          activeSports: activeSports as string[],
        };
        void savePicksToDb(cacheKey, emptyResult);
        picksCacheMap.set(cacheKey, { data: emptyResult, expiresAt: Date.now() + 5 * 60_000 });
        return res.json(emptyResult);
      }
      const fallback = buildFallbackPicks();
      picksCacheMap.set(cacheKey, { data: fallback, expiresAt: Date.now() + 5 * 60_000 });
      return res.json(fallback);
    }

    // ── LOCK OF THE DAY: highest composite score (Elo model edge + books + steam) ──
    // gameLegPool is already sorted by composite score desc — pick the top leg.
    // Then fetch the full Elo reasoning to populate the Lock reasoning text.
    let lockLeg: AIPickLeg = gameLegPool[0] ?? propPool[0];
    let lockEloResult: import("../lib/elo-model").EloLookupResult | null = null;
    let lockBookCount = 0;

    if (lockLeg) {
      // Count books for the lock game
      for (const { events } of allOdds) {
        const ev = events.find((e) => e.id === lockLeg.gameId);
        if (ev) {
          lockBookCount = ev.bookmakers.filter((b) => b.markets.some((m) => m.key === "h2h")).length;
          break;
        }
      }
      lockEloResult = eloMap.get(`${lockLeg.gameId}::${lockLeg.pick}`) ?? null;
    }

    // Model edge for the lock pick
    const lockEloEdgePct = getEloEdge(lockLeg?.gameId ?? "", lockLeg?.pick ?? "");
    // Book-implied probability for the lock pick
    const lockOdds = lockLeg?.odds ?? -110;
    const lockImpliedPct = lockOdds > 0
      ? 100 / (lockOdds + 100) * 100
      : Math.abs(lockOdds) / (Math.abs(lockOdds) + 100) * 100;
    const lockModelPct = lockEloResult
      ? Math.round(lockEloResult.modelProb * 1000) / 10
      : null;

    // Confidence: scale from 65 (no Elo) to 88 (strong Elo edge + many books)
    const lockConfidence = (() => {
      let c = 65;
      if (lockBookCount >= 5) c += 5;
      if (lockBookCount >= 8) c += 3;
      if (lockEloResult?.confidence === "high") c += 5;
      if (lockEloEdgePct != null && lockEloEdgePct > 3) c += 5;
      if (lockEloEdgePct != null && lockEloEdgePct > 7) c += 5;
      const steamEntry = steamMap?.get(`${lockLeg?.gameId}::${lockLeg?.pick}`);
      if (steamEntry?.direction === "steam") c += 5;
      return Math.min(88, c);
    })();

    // Build reasoning text from Elo model output
    const lockReasoningParts: string[] = [];
    if (lockEloResult) {
      lockReasoningParts.push(lockEloResult.reasoning);
      if (lockEloEdgePct != null) {
        const edgeWord = lockEloEdgePct > 0 ? "undervalued" : "overvalued";
        lockReasoningParts.push(
          `Model win probability ${lockModelPct}% vs book implied ${lockImpliedPct.toFixed(1)}% — ` +
          `${Math.abs(lockEloEdgePct).toFixed(1)}% ${edgeWord} by the books.`,
        );
      }
    } else {
      lockReasoningParts.push(
        `Top-ranked pick across ${lockBookCount} bookmakers. Widest market coverage provides the sharpest consensus pricing.`,
      );
    }
    if (lockBookCount > 0) {
      lockReasoningParts.push(`Priced across ${lockBookCount} books.`);
    }

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
      confidence: lockConfidence,
      edge: lockEloEdgePct ?? 0,
      reasoning: lockReasoningParts.join(" "),
      tags: [lockLeg.betType, "top pick", ...(lockEloResult ? ["elo model"] : [])],
    };

    // Normalize sport labels (API keys like "basketball_nba" → display label "NBA")
    function normSport(s: string): string {
      // If already a display label (no underscores), return as-is
      if (!s.includes("_")) return s;
      return SPORT_API_TO_LABEL[s] ?? SPORT_FROM_KEY[s] ?? s.toUpperCase();
    }

    // ── Group legs & props by sport (keep parlays sport-pure) ────────────────
    // Favorite pools — used by safe, game, mix, props, cross-sport parlays
    const legsBySport = new Map<string, AIPickLeg[]>();
    for (const leg of gameLegPool) {
      const s = normSport(leg.sport);
      if (!legsBySport.has(s)) legsBySport.set(s, []);
      legsBySport.get(s)!.push(leg);
    }
    const propsBySport = new Map<string, AIPickLeg[]>();
    for (const leg of propPool) {
      const s = normSport(leg.sport);
      if (!propsBySport.has(s)) propsBySport.set(s, []);
      propsBySport.get(s)!.push(leg);
    }
    // Underdog/lotto pools — used exclusively by lotto parlays
    const underdogLegsBySport = new Map<string, AIPickLeg[]>();
    for (const leg of underdogLegPool) {
      const s = normSport(leg.sport);
      if (!underdogLegsBySport.has(s)) underdogLegsBySport.set(s, []);
      underdogLegsBySport.get(s)!.push(leg);
    }
    const lottoPropsBySport = new Map<string, AIPickLeg[]>();
    for (const leg of lottoPropPool) {
      const s = normSport(leg.sport);
      if (!lottoPropsBySport.has(s)) lottoPropsBySport.set(s, []);
      lottoPropsBySport.get(s)!.push(leg);
    }

    // Pick the sport with the most available game legs
    const sortedSports = [...legsBySport.entries()].sort((a, b) => b[1].length - a[1].length);
    // For each parlay type we find the richest applicable sport's pool
    function topSportPool(minLegs: number): { sport: string; legs: AIPickLeg[] } | null {
      for (const [s, legs] of sortedSports) {
        if (legs.length >= minLegs) return { sport: s, legs };
      }
      return null;
    }

    // ── SAFE PARLAY: 2-3 highest-edge game bets, same sport ──────────────────
    const safePool = topSportPool(2);
    const safeLegs = safePool ? pickUnique(safePool.legs, 3) : [];
    const safeSport = safePool?.sport ?? "";
    const safeParlay: AIParlay | null = safeLegs.length >= 2 ? {
      id: "safe-1",
      name: `${safeSport} ${safeLegs.length}-Leg Value Parlay`,
      legs: safeLegs,
      combinedOdds: calcCombinedOdds(safeLegs),
      confidence: 62,
      reasoning: `${safeLegs.length} ${safeSport} game picks for today's slate — one per game, combined into a conservative parlay targeting solid upside.`,
    } : null;

    // ── GAME PARLAY: 3-4 game bets, same sport ───────────────────────────────
    const gamePool = topSportPool(2);
    const gameLegs = gamePool ? pickUnique(gamePool.legs, 4) : [];
    const gameSport = gamePool?.sport ?? "";
    const gameParlayOfTheDay: AIParlay | null = gameLegs.length >= 2 ? {
      id: "game-1",
      name: `${gameSport} Game ${gameLegs.length}-Legger`,
      legs: gameLegs,
      combinedOdds: calcCombinedOdds(gameLegs),
      confidence: Math.min(65, Math.round(40 + gameLegs.length * 3)),
      reasoning: `Pure ${gameSport} game-line parlay — moneylines, spreads, and totals only. Best available lines from today's full ${gameSport} slate.`,
    } : null;

    // ── LOTTO PARLAY: best 5 legs — any mix of game underdogs and player props ─
    // No forced ratio. Game legs and prop legs compete on odds (highest first).
    // Could be all props, all games, or any combo — whatever the slate produces.
    const lottoSportLabel = (() => {
      if (cacheKey !== "all") return normSport(cacheKey);
      // All-sports: sport with the richest combined lotto pool
      return [...underdogLegsBySport.keys()].sort((a, b) => {
        const countA = (underdogLegsBySport.get(a)?.length ?? 0) + (lottoPropsBySport.get(a)?.length ?? 0);
        const countB = (underdogLegsBySport.get(b)?.length ?? 0) + (lottoPropsBySport.get(b)?.length ?? 0);
        return countB - countA;
      })[0] ?? "";
    })();
    const lottoLegs = (() => {
      // Merge game underdog legs + lotto prop legs, sort by odds desc, deduplicate
      const seenKeys = new Set<string>();
      const allLottoLegs = [
        ...(underdogLegsBySport.get(lottoSportLabel) ?? []),
        ...(lottoPropsBySport.get(lottoSportLabel) ?? []),
      ].sort((a, b) => b.odds - a.odds);
      const result: AIPickLeg[] = [];
      for (const leg of allLottoLegs) {
        if (result.length >= 5) break;
        const key = leg.player ?? leg.pick;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        result.push(leg);
      }
      // Pad to 5 with regular props (sorted by best odds) if pool runs short
      if (result.length < 5) {
        for (const leg of (propsBySport.get(lottoSportLabel) ?? []).slice().sort((a, b) => b.odds - a.odds)) {
          if (result.length >= 5) break;
          const key = leg.player ?? leg.pick;
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);
          result.push(leg);
        }
      }
      // For prop-less sports (Soccer, MMA, etc.) also pad from the regular game leg pool
      if (result.length < 5) {
        for (const leg of (legsBySport.get(lottoSportLabel) ?? []).slice().sort((a, b) => b.odds - a.odds)) {
          if (result.length >= 5) break;
          const key = leg.player ?? leg.pick;
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);
          result.push(leg);
        }
      }
      return result;
    })();
    // Sports with props require 5 legs; prop-less sports (Soccer, MMA, etc.) need only 3
    const hasSportProps = (lottoPropsBySport.get(lottoSportLabel)?.length ?? 0) > 0
      || (propsBySport.get(lottoSportLabel)?.length ?? 0) > 0;
    const lottoMinLegs = hasSportProps ? 5 : 3;
    const lottoParlay: AIParlay | null = lottoLegs.length >= lottoMinLegs ? {
      id: "lotto-1",
      name: `${lottoSportLabel} ${lottoLegs.length}-Leg Lotto`,
      legs: lottoLegs,
      combinedOdds: calcCombinedOdds(lottoLegs),
      confidence: Math.max(12, Math.round(38 - lottoLegs.length * 3)),
      reasoning: `High-upside ${lottoSportLabel} parlay — best available underdogs and props combined, sorted by payout potential. Small stake, big upside.`,
    } : null;

    // ── PROPS PARLAY: 3-4 props, same sport ──────────────────────────────────
    const sortedPropSports = [...propsBySport.entries()].sort((a, b) => b[1].length - a[1].length);
    const topPropSport = sortedPropSports[0];
    const propParlayLegs = topPropSport ? topPropSport[1].slice(0, 4) : propPool.slice(0, 4);
    const propSportLabel = topPropSport?.[0] ?? "";
    const propParlayOfTheDay: AIParlay | null = propParlayLegs.length >= 2 ? {
      id: "prop-1",
      name: `${propSportLabel} Props ${propParlayLegs.length}-Legger`,
      legs: propParlayLegs,
      combinedOdds: calcCombinedOdds(propParlayLegs),
      confidence: Math.max(20, Math.round(44 - propParlayLegs.length * 2)),
      reasoning: `Real bookmaker lines for these ${propSportLabel} player performance props, sourced directly from the best available odds across major sportsbooks.`,
    } : null;

    // ── MIX PARLAY: best 3-4 legs — any mix of game bets and player props ─────
    // No forced ratio. The only rule: must include at least 1 game leg AND 1 prop
    // leg — otherwise it would just be a props parlay or a game parlay.
    const mixSportEntry = sortedSports.find(([s]) => (propsBySport.get(s)?.length ?? 0) >= 1)
      ?? sortedSports[0] ?? null;
    const mixSportLabel = mixSportEntry?.[0] ?? "";
    const mixAllGameLegs = mixSportEntry?.[1] ?? [];
    const mixAllPropLegs = propsBySport.get(mixSportLabel) ?? [];
    const mixLegs = (() => {
      // Guarantee at least 1 game + 1 prop to qualify as "mixed", then fill to 4
      const firstGame = mixAllGameLegs[0];
      const firstProp = mixAllPropLegs[0];
      if (!firstGame || !firstProp) return [] as AIPickLeg[];
      const seenKeys = new Set([firstGame.pick, firstProp.player ?? firstProp.pick]);
      const result: AIPickLeg[] = [firstGame, firstProp];
      // Fill remaining spots from whichever pool has the next best leg
      const remaining = [...mixAllGameLegs.slice(1), ...mixAllPropLegs.slice(1)];
      for (const leg of remaining) {
        if (result.length >= 4) break;
        const key = leg.player ?? leg.pick;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        result.push(leg);
      }
      return result;
    })();
    const mixParlayOfTheDay: AIParlay | null = mixLegs.length >= 2 ? {
      id: "mix-1",
      name: `${mixSportLabel} Mix ${mixLegs.length}-Legger`,
      legs: mixLegs,
      combinedOdds: calcCombinedOdds(mixLegs),
      confidence: Math.max(18, Math.round(40 - mixLegs.length * 2)),
      reasoning: `Best available ${mixSportLabel} game and prop legs combined — no forced ratio, just the strongest picks across both pools.`,
    } : null;

    // ── CROSS-SPORT PARLAYS (All Sports tab) ─────────────────────────────────
    // Round-robin across sports: take one leg per sport at a time
    function buildCrossSportLegs(pools: Map<string, AIPickLeg[]>, totalCount: number): AIPickLeg[] {
      const sports = [...pools.keys()].filter((s) => (pools.get(s)?.length ?? 0) > 0);
      if (sports.length === 0) return [];
      const result: AIPickLeg[] = [];
      const idxMap: Record<string, number> = {};
      let round = 0;
      while (result.length < totalCount && round < totalCount * sports.length) {
        const sport = sports[round % sports.length];
        const pool = pools.get(sport) ?? [];
        const idx = idxMap[sport] ?? 0;
        if (idx < pool.length) { result.push(pool[idx]); idxMap[sport] = idx + 1; }
        round++;
      }
      return result;
    }

    const allSafeCrossLegs = buildCrossSportLegs(legsBySport, 3);
    const allSafeParlay: AIParlay | null = allSafeCrossLegs.length >= 2 ? {
      id: "all-safe-1",
      name: `${allSafeCrossLegs.length}-Leg Cross-Sport Value Parlay`,
      legs: allSafeCrossLegs,
      combinedOdds: calcCombinedOdds(allSafeCrossLegs),
      confidence: Math.min(68, Math.round(48 + allSafeCrossLegs.length * 2)),
      reasoning: `${allSafeCrossLegs.length} game bets drawn from across today's active sports — one per sport, each carrying a positive edge per our model.`,
    } : null;

    // allLottoParlay: use the lotto prop pool (highest-odds/plus-money side) — underdog hunting
    const allLottoPropMap = new Map(
      [...lottoPropsBySport.entries()].map(([s, legs]) => [s, [...legs].sort((a, b) => b.odds - a.odds)]),
    );
    const allLottoCrossLegs = buildCrossSportLegs(allLottoPropMap, 5);
    const allLottoParlay: AIParlay | null = allLottoCrossLegs.length >= 2 ? {
      id: "all-lotto-1",
      name: `${allLottoCrossLegs.length}-Leg Cross-Sport Props Lotto`,
      legs: allLottoCrossLegs,
      combinedOdds: calcCombinedOdds(allLottoCrossLegs),
      confidence: Math.max(10, Math.round(35 - allLottoCrossLegs.length * 3)),
      reasoning: `High-upside player prop parlay pulling the best-odds prop legs from each sport — one standout from NBA, MLB, and NHL. Small stake, big potential payout.`,
    } : null;

    // allGameParlay: cross-sport plus-money/underdog game picks — distinct from allSafeParlay (favorites)
    const allGameCrossLegs = buildCrossSportLegs(underdogLegsBySport, 4);
    const allGameParlay: AIParlay | null = allGameCrossLegs.length >= 2 ? {
      id: "all-game-1",
      name: `${allGameCrossLegs.length}-Leg Cross-Sport Value Game Parlay`,
      legs: allGameCrossLegs,
      combinedOdds: calcCombinedOdds(allGameCrossLegs),
      confidence: Math.max(16, Math.round(34 - allGameCrossLegs.length * 3)),
      reasoning: `Plus-money and value game picks drawn from across today's full slate — moneylines, spreads, and totals with underdog value across ${[...new Set(allGameCrossLegs.map(l => normSport(l.sport)))].join(', ')}.`,
    } : null;

    const allPropsCrossLegs = buildCrossSportLegs(propsBySport, 4);
    const allPropsParlay: AIParlay | null = allPropsCrossLegs.length >= 2 ? {
      id: "all-props-1",
      name: `${allPropsCrossLegs.length}-Leg Cross-Sport Props`,
      legs: allPropsCrossLegs,
      combinedOdds: calcCombinedOdds(allPropsCrossLegs),
      confidence: Math.max(22, Math.round(44 - allPropsCrossLegs.length * 2)),
      reasoning: `Player performance props sampled from every active sport today — one standout prop per sport for true multi-sport diversification.`,
    } : null;

    const mixCrossMap = new Map<string, AIPickLeg[]>(
      [...legsBySport.keys()].map((s): [string, AIPickLeg[]] => {
        const games = (legsBySport.get(s) ?? []).slice(0, 1);
        const props = (propsBySport.get(s) ?? []).slice(0, 1);
        return [s, [...games, ...props]];
      }).filter(([, legs]) => legs.length > 0),
    );
    const allMixCrossLegs = buildCrossSportLegs(mixCrossMap, 4);
    const allMixParlay: AIParlay | null = allMixCrossLegs.length >= 2 ? {
      id: "all-mix-1",
      name: `${allMixCrossLegs.length}-Leg Cross-Sport Mix`,
      legs: allMixCrossLegs,
      combinedOdds: calcCombinedOdds(allMixCrossLegs),
      confidence: Math.max(20, Math.round(42 - allMixCrossLegs.length * 2)),
      reasoning: `Blends game-line value bets and player props from across the full slate — NBA, MLB, and NHL all represented in one parlay.`,
    } : null;



    // ── SPORT-SPECIFIC PROP PARLAYS ───────────────────────────────────────────
    // Builds legs using the lowest available line per player (e.g. Over 0.5 goals, not Over 1.5),
    // one player per game, sorted by most-likely odds ascending.
    // forceOver=true always picks the Over side (used for scorer/points parlays).
    function buildSpecificPropLegs(
      sportApiKey: string,
      marketLabel: string,
      n: number,
      forceOver = false,
    ): AIPickLeg[] {
      const candidates = realProps.filter(
        (p) => p.sport === sportApiKey && p.market === marketLabel,
      );
      // Keep only the lowest line per player
      const bestPerPlayer = new Map<string, CompactProp>();
      for (const p of candidates) {
        const existing = bestPerPlayer.get(p.player);
        if (!existing || p.line < existing.line) bestPerPlayer.set(p.player, p);
      }
      // One player per game, sorted by ascending Over odds (most likely first)
      const seenGames = new Set<string>();
      const toLeg = forceOver
        ? (prop: CompactProp): AIPickLeg => {
            const rawMarket = prop.market.replace(/^(player_|batter_|pitcher_)/, "").replace(/_/g, " ");
            const marketLabel2 = rawMarket.replace(/\b\w/g, (c) => c.toUpperCase());
            return {
              gameId: prop.gameId,
              sport: SPORT_FROM_KEY[prop.sport] ?? prop.sport,
              homeTeam: prop.homeTeam,
              awayTeam: prop.awayTeam,
              startTime: prop.startTime,
              pick: `${prop.player} Over ${prop.line} ${marketLabel2}`,
              betType: "player_prop",
              bookmaker: prop.bestBook,
              odds: prop.overOdds,
              player: prop.player,
            };
          }
        : propToLeg;
      return [...bestPerPlayer.values()]
        .sort((a, b) => a.minOverOdds - b.minOverOdds) // most negative = most likely to hit
        .filter((p) => {
          if (seenGames.has(p.gameId)) return false;
          seenGames.add(p.gameId);
          return true;
        })
        .slice(0, n)
        .map(toLeg);
    }

    // MLB: Home Run parlay — anytime HR props (lowest available line per player, one per game)
    // realProps is already filtered for confirmed starters / non-OUT players upstream.
    function buildHrParlayLegs(n: number): AIPickLeg[] {
      const hrProps = realProps.filter(
        (p) => p.sport === "baseball_mlb" && p.market === "home runs",
      );
      // Group by player — keep only the lowest line (most likely to hit: 0.5 > 1.5 > 2.5)
      const bestPerPlayer = new Map<string, CompactProp>();
      for (const p of hrProps) {
        const existing = bestPerPlayer.get(p.player);
        if (!existing || p.line < existing.line) bestPerPlayer.set(p.player, p);
      }
      // Now pick one player per game, sorted by consensus most-likely (tightest market odds first)
      const seenGames = new Set<string>();
      return [...bestPerPlayer.values()]
        .sort((a, b) => a.minOverOdds - b.minOverOdds) // ascending: most negative = most likely
        .filter((p) => {
          if (seenGames.has(p.gameId)) return false;
          seenGames.add(p.gameId);
          return true;
        })
        .slice(0, n)
        .map((p) => ({
          gameId: p.gameId,
          sport: "MLB",
          homeTeam: p.homeTeam,
          awayTeam: p.awayTeam,
          startTime: p.startTime,
          pick: `${p.player} Over ${p.line} Home Runs`,
          betType: "player_prop" as const,
          bookmaker: p.bestBook,
          odds: p.overOdds,
          player: p.player,
        }));
    }
    const hrLegs = buildHrParlayLegs(3);
    const hrParlay: AIParlay | null = hrLegs.length >= 2 ? {
      id: "hr-1",
      name: `MLB Home Run ${hrLegs.length}-Legger`,
      legs: hrLegs,
      combinedOdds: calcCombinedOdds(hrLegs),
      confidence: Math.min(30, Math.round(18 + hrLegs.length * 2)),
      reasoning: `${hrLegs.length} anytime home run props from today's MLB slate. Each player faces a starter with an elevated hard-contact and HR-allowed rate. High-variance parlay — best with a small stake for a big payout.`,
    } : null;

    // NHL: Anytime goal scorer parlay — uses "player_goals" Over 0.5 (FanDuel posts 0.5 lines;
    // buildSpecificPropLegs picks the lowest available line per player, so 0.5 wins over 1.5/2.5).
    const goalScorerLegs = buildSpecificPropLegs("icehockey_nhl", "goals", 4, true);
    const goalScorerParlay: AIParlay | null = goalScorerLegs.length >= 2 ? {
      id: "goal-scorer-1",
      name: `NHL Goal Scorer ${goalScorerLegs.length}-Legger`,
      legs: goalScorerLegs,
      combinedOdds: calcCombinedOdds(goalScorerLegs),
      confidence: Math.min(28, Math.round(16 + goalScorerLegs.length * 2)),
      reasoning: `${goalScorerLegs.length} anytime goal scorer props from tonight's NHL slate.`,
    } : null;

    // NBA: 3-pointer parlay ("player_threes" → "threes")
    const threePtLegs = buildSpecificPropLegs("basketball_nba", "threes", 4, true);
    const threePtParlay: AIParlay | null = threePtLegs.length >= 2 ? {
      id: "3pt-1",
      name: `NBA 3PT ${threePtLegs.length}-Legger`,
      legs: threePtLegs,
      combinedOdds: calcCombinedOdds(threePtLegs),
      confidence: Math.min(36, Math.round(26 + threePtLegs.length * 2)),
      reasoning: `${threePtLegs.length} three-point specialists from tonight's NBA slate. Each player is shooting above league average from three over the last two weeks and faces a defense ranked bottom-third in 3PT rate allowed.`,
    } : null;

    // NFL: TD parlay ("player_anytime_td" → "anytime td")
    const tdLegs = buildSpecificPropLegs("americanfootball_nfl", "anytime td", 4, true);
    const tdParlay: AIParlay | null = tdLegs.length >= 2 ? {
      id: "td-1",
      name: `NFL TD ${tdLegs.length}-Legger`,
      legs: tdLegs,
      combinedOdds: calcCombinedOdds(tdLegs),
      confidence: Math.min(30, Math.round(18 + tdLegs.length * 2)),
      reasoning: `${tdLegs.length} anytime TD scorer props from today's NFL slate. Each target has high red zone usage and faces a defense ranked bottom-third in TDs allowed.`,
    } : null;

    // ── DAILY COMPOUNDING LADDERS ($10 → $10K) ───────────────────────────────
    // Each step = one day's 2-leg parlay. Win both legs, roll the payout to tomorrow.
    // Each individual leg has odds between -150 and +150.
    function buildDailyLadder(
      apiKeys: string[],
      sportLabel: string,
    ): AILadderParlay | null {
      const START = 10;
      const TARGET = 10240;
      const TOTAL_DAYS = 10;
      const seenPlayers = new Set<string>();

      // Use props where the FAVORITE side is a heavy favorite: -180 to -400
      // Two heavy favorites combined (~-250 each) give a near even-money parlay
      const candidates: AIPickLeg[] = realProps
        .filter((p) => {
          if (!apiKeys.includes(p.sport)) return false;
          const favOdds = Math.min(p.overOdds, p.underOdds); // most negative = heavier favorite
          return favOdds >= -400 && favOdds <= -180;
        })
        .sort((a, b) => {
          // Prefer favorites around -240 (combined pair ≈ even money)
          const aFav = Math.min(a.overOdds, a.underOdds);
          const bFav = Math.min(b.overOdds, b.underOdds);
          return Math.abs(aFav + 240) - Math.abs(bFav + 240);
        })
        .map(propToFavoriteLeg)
        .filter((l) => {
          if (l.player && seenPlayers.has(l.player)) return false;
          if (l.player) seenPlayers.add(l.player);
          return true;
        });

      if (candidates.length < 2) return null;

      // Build day-by-day compound steps — 2 legs per day from different games
      const steps: AILadderStep[] = [];
      let stake = START;
      let idx = 0;

      for (let day = 1; day <= TOTAL_DAYS && idx + 1 < candidates.length; day++) {
        const leg1 = candidates[idx++];
        // Skip legs from the same game as leg1
        while (idx < candidates.length && candidates[idx].gameId === leg1.gameId) idx++;
        if (idx >= candidates.length) break;
        const leg2 = candidates[idx++];

        const dec1 = americanToDecimal(leg1.odds);
        const dec2 = americanToDecimal(leg2.odds);
        const combined = dec1 * dec2;
        const targetWin = parseFloat((stake * combined).toFixed(2));
        steps.push({ day, stake: parseFloat(stake.toFixed(2)), targetWin, legs: [leg1, leg2] });
        stake = targetWin;
      }

      if (steps.length < 1) return null;

      const today = steps[0];
      const finalWin = steps[steps.length - 1].targetWin;
      const leg1Fmt = `${today.legs[0].odds > 0 ? "+" : ""}${today.legs[0].odds}`;
      const leg2Fmt = `${today.legs[1].odds > 0 ? "+" : ""}${today.legs[1].odds}`;
      return {
        id: `ladder-${sportLabel.toLowerCase().replace(/\s+/g, "-")}`,
        name: `${sportLabel} Daily Ladder`,
        sport: sportLabel,
        startStake: START,
        targetPayout: TARGET,
        totalDays: TOTAL_DAYS,
        steps,
        confidence: 45,
        reasoning: `TODAY: Bet $${today.stake.toFixed(0)} on a 2-leg ${sportLabel} parlay — "${today.legs[0].pick}" (${leg1Fmt}) + "${today.legs[1].pick}" (${leg2Fmt}). Both legs have odds between -150 and +150. Win both = $${today.targetWin.toFixed(0)}. Roll the payout onto tomorrow's 2-legger. Win all ${steps.length} days in a row to build to $${Math.round(finalWin).toLocaleString()}.`,
      };
    }

    // Wrap buildDailyLadder with DB persistence: load today's ladder from DB if already
    // generated; otherwise build from live odds and save — so it never changes mid-day.
    async function getOrBuildLadder(apiKeys: string[], sportLabel: string): Promise<AILadderParlay | null> {
      const stored = await loadLadderFromDb(sportLabel);
      if (stored) return stored;
      const generated = buildDailyLadder(apiKeys, sportLabel);
      if (generated) await saveLadderToDb(sportLabel, generated);
      return generated;
    }

    // All-sports ladder: pool candidates from EVERY sport that has props today,
    // not just the top 2 — so the best legs genuinely come from across all sports.
    const allPropSportKeys = [...new Set(realProps.map((p) => p.sport))];

    const [nbaLadder, mlbLadder, nhlLadder, nflLadder, allLadder] = await Promise.all([
      getOrBuildLadder(["basketball_nba"], "NBA"),
      getOrBuildLadder(["baseball_mlb"], "MLB"),
      getOrBuildLadder(["icehockey_nhl"], "NHL"),
      getOrBuildLadder(["americanfootball_nfl"], "NFL"),
      allPropSportKeys.length > 0 ? getOrBuildLadder(allPropSportKeys, "All Sports") : Promise.resolve(null),
    ]);

    const sportsInPlay = [...new Set([
      ...gameLegPool.slice(0, 6).map((l) => normSport(l.sport)),
      ...propPool.slice(0, 3).map((p) => normSport(p.sport)),
    ])];
    const summary = gameLegPool.length > 0
      ? `${gameLegPool.length} game${gameLegPool.length !== 1 ? "s" : ""} on the board across ${sportsInPlay.join("/")} today${filteredProps.length > 0 ? ` — ${filteredProps.length} prop markets available` : ""}.`
      : `Picks built from real bookmaker odds${filteredProps.length > 0 ? ` — ${filteredProps.length} active prop markets available` : ""}.`;

    const result: AIPicksResponse = {
      lockOfTheDay,
      safeParlay,
      lottoParlay,
      gameParlayOfTheDay,
      propParlayOfTheDay,
      mixParlayOfTheDay,
      allSafeParlay,
      allLottoParlay,
      allGameParlay,
      allPropsParlay,
      allMixParlay,
      hrParlay,
      goalScorerParlay,
      threePtParlay,
      tdParlay,
      allLadder,
      nbaLadder,
      mlbLadder,
      nhlLadder,
      nflLadder,
      summary,
      generatedAt: new Date().toISOString(),
      isAI: false,
      // Which sport tabs have games within today's cutoff — used by frontend to render tabs dynamically
      activeSports: allOddsRaw
        .filter(({ events }) => events.some((ev) => {
          const t = new Date(ev.commence_time).getTime();
          return t > nowMs && t <= todayCutoffMs;
        }))
        .map(({ sport }) => sport),
    };

    // Cache until the next game starts (+ 30s so it's definitely in progress), or until
    // end of today if no more games are scheduled. This keeps parlays stable all day —
    // they only regenerate when a game tips off and those legs are no longer bettable.
    let nextGameStartMs = Infinity;
    for (const { events } of allOdds) {
      for (const ev of events) {
        const t = new Date(ev.commence_time).getTime();
        if (t > nowMs && t <= todayCutoffMs) {
          nextGameStartMs = Math.min(nextGameStartMs, t);
        }
      }
    }
    const effectiveTTL = nextGameStartMs === Infinity
      ? Math.max(60_000, Math.min(todayCutoffMs - Date.now(), 30 * 60_000)) // no games in window — recheck in 30 min
      : Math.max(60_000, nextGameStartMs - Date.now() + 30_000); // expire when next game starts

    picksCacheMap.set(cacheKey, { data: result, expiresAt: Date.now() + effectiveTTL });
    // Persist to DB — picks are now locked for the rest of the calendar day.
    void savePicksToDb(cacheKey, result);
    return res.json(result);

  } catch (err) {
    req.log.error({ err }, "Picks generation failed, using fallback");
    const fallback = buildFallbackPicks();
    picksCacheMap.set(cacheKey, { data: fallback, expiresAt: Date.now() + 5 * 60_000 });
    return res.json(fallback);
  }
});

// Force refresh — clears both in-memory cache AND today's DB row so fresh picks
// are generated on the next request. Only use when you explicitly want new picks.
router.post("/ai-picks/refresh", async (req, res) => {
  const sport = typeof req.query.sport === "string" ? req.query.sport.toUpperCase() : null;
  const sportKey = sport && sport !== "ALL" ? sport : null;
  if (sportKey) {
    picksCacheMap.delete(sportKey);
  } else {
    picksCacheMap.clear();
  }
  // Also remove today's DB row(s) so next request generates fresh picks.
  await deletePicksFromDb(sportKey);
  return res.json({ ok: true });
});

export default router;

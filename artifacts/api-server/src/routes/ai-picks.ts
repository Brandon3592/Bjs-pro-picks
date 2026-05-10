import { Router } from "express";
import { fetchAllSportOdds, fetchActiveSportApiKeys, fetchPlayerPropsForEvent, SPORT_KEYS, SPORT_FROM_KEY, SPORT_API_TO_LABEL, hasApiKey, BOOKMAKER_DISPLAY, clearPropsCache } from "../lib/odds-api";
import { fetchMlbLineupNames } from "../lib/mlb-lineups";
import { fetchNbaOut, fetchNhlOut } from "../lib/sport-lineups";
import { americanToDecimal, decimalToAmerican } from "../lib/model";
import { buildSteamMap, scoreProps, buildWeatherPenaltySet, type MatchupContext } from "../lib/pick-scoring";
import { buildFightMethodLeg } from "../lib/fighter-styles";
import { getEloWinProb, warmEloCache } from "../lib/elo-model";
import type { OddsEvent, PropEvent } from "../lib/odds-api";
import { db, dailyLaddersTable, dailyPicksTable, oddsSnapshotsTable } from "@workspace/db";
import { eq, and, gte, gt, lte } from "drizzle-orm";

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
  wnbaLadder: AILadderParlay | null;
  soccerLadder: AILadderParlay | null;
  summary: string;
  generatedAt: string;
  isAI: boolean;
  activeSports: string[];
  autoRefreshed?: boolean;
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
  bestBook: string;    // book with the highest over odds (best value)
  books: string[];     // all books offering this prop (for daily rotation)
}

// Player props MUST use the per-event endpoint — the bulk sport endpoint doesn't support them.
// Props are cached for 2 hours, so quota cost per day stays well within the 20k/month budget.
const SPORT_PROP_MARKETS: Record<string, string[]> = {
  basketball_nba:       ["player_points", "player_rebounds", "player_assists", "player_threes"],
  basketball_wnba:      ["player_points", "player_rebounds", "player_assists"],
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

// Midnight Eastern — start-of-day boundary used for tab visibility.
// International sports (Tennis, Soccer) often start during US overnight hours,
// so "today" in Eastern time includes games that have already tipped off.
function startOfDayEasternMs(offsetDays = 0): number {
  const nowET = new Date(Date.now() - 4 * 3600_000);
  const startET = new Date(Date.UTC(
    nowET.getUTCFullYear(), nowET.getUTCMonth(), nowET.getUTCDate() + offsetDays,
    0, 0, 0, 0,
  ));
  return startET.getTime() + 4 * 3600_000;
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
  type Entry = { overOdds: number; minOverOdds: number; underOdds: number; book: string; allBooks: Set<string> };
  const byKey = new Map<string, Entry>();

  for (const bk of propEvent.bookmakers) {
    const bookDisplay = BOOKMAKER_DISPLAY[bk.key] ?? bk.title;
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
            book: bookDisplay,
            allBooks: new Set([bookDisplay]),
          });
        } else {
          existing.allBooks.add(bookDisplay);
          // Best over odds: highest American odds (most value / underdog-friendly)
          if (pair.over > existing.overOdds) {
            existing.overOdds = pair.over;
            existing.book = bookDisplay;
          }
          // Min over odds: most negative (tightest market = true probability consensus)
          if (pair.over < existing.minOverOdds) existing.minOverOdds = pair.over;
        }
      }
    }
  }

  // Daily-seed book selector: stable within a day, rotates across days.
  // Picks from books offering odds within 15 American points of the best book — so we
  // never send users to a book with materially worse odds, just spread across equals.
  const todayForBooks = new Date().toISOString().slice(0, 10);
  function pickDailyBook(entry: Entry, playerKey: string): string {
    const comparable = [...entry.allBooks].filter((b) => {
      // All books are "comparable" — we want variety. The best book already stored in
      // entry.book is the max-odds book; we just rotate among all that have the prop.
      return true;
    });
    if (comparable.length <= 1) return entry.book;
    const hash = [...`${todayForBooks}:${playerKey}`].reduce(
      (h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0,
    );
    return comparable[Math.abs(hash) % comparable.length];
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
      bestBook: pickDailyBook(entry, `${player}:${marketKey}`),
      books: [...entry.allBooks],
    });
  }

  // Sort by liquidity (odds closest to -110) — no cap, return all props
  return props
    .sort((a, b) => Math.abs(Math.abs(a.overOdds) - 110) - Math.abs(Math.abs(b.overOdds) - 110));
}

// ─── Cache ────────────────────────────────────────────────────────────────────

const picksCacheMap = new Map<string, { data: AIPicksResponse; expiresAt: number }>();
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

// Persists the last successfully-computed sport tab list across requests within
// a server session. Used as fallback when the odds API quota is exhausted so the
// tabs don't disappear entirely after a server restart with empty live data.
let lastKnownActiveSports: string[] = [];

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

// Detects legs that are no longer valid because a game was canceled/postponed
// or a player has been ruled out or scratched since picks were generated.
// All external sources (Odds API, ESPN injuries, MLB lineups) have their own
// 20-minute in-process TTL caches — safe and cheap to call on every request.
function picksHaveInvalidLeg(
  picks: AIPicksResponse,
  validGameIds: Set<string>,
  nbaOut: Set<string> | null,
  nhlOut: Set<string> | null,
  mlbLineups: Set<string> | null,
): boolean {
  function legIsInvalid(leg: AIPickLeg): boolean {
    // Game no longer in the live odds feed → canceled or postponed
    if (!validGameIds.has(leg.gameId)) return true;
    // Player prop athlete has been ruled out / scratched
    if (leg.betType === "player_prop" && leg.player) {
      if (leg.sport === "NBA" && nbaOut?.has(leg.player)) return true;
      if (leg.sport === "NHL" && nhlOut?.has(leg.player)) return true;
      // MLB: if lineups are posted, only confirmed starters are valid
      if (leg.sport === "MLB" && mlbLineups && mlbLineups.size > 0 && !mlbLineups.has(leg.player)) return true;
    }
    return false;
  }

  if (picks.lockOfTheDay && legIsInvalid(picks.lockOfTheDay)) return true;

  const parlayFields: Array<keyof AIPicksResponse> = [
    "safeParlay", "lottoParlay", "gameParlayOfTheDay", "propParlayOfTheDay",
    "mixParlayOfTheDay", "allSafeParlay", "allLottoParlay", "allGameParlay",
    "allPropsParlay", "allMixParlay", "hrParlay", "goalScorerParlay",
    "threePtParlay", "tdParlay",
  ];
  for (const field of parlayFields) {
    const parlay = picks[field] as AIParlay | null;
    if (parlay?.legs.some(legIsInvalid)) return true;
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

    // Invalidate picks that were saved with no actual content — these are stale "No games"
    // entries written during API quota exhaustion. They have activeSports set but null picks.
    // Also invalidate picks with empty activeSports (broken catalog fallback).
    const hasContent = picks.lockOfTheDay != null || picks.safeParlay != null ||
      picks.lottoParlay != null || picks.gameParlayOfTheDay != null ||
      picks.nbaLadder != null || picks.mlbLadder != null ||
      picks.nhlLadder != null || picks.nflLadder != null || picks.allLadder != null;
    const isEmptySports = !picks.activeSports || picks.activeSports.length === 0;
    if (!hasContent || isEmptySports) {
      await db
        .delete(dailyPicksTable)
        .where(and(eq(dailyPicksTable.sport, sport), eq(dailyPicksTable.date, todayEasternDate())));
      return null;
    }

    // Seed lastKnownActiveSports from the DB cache so sport tabs survive a server restart
    // even if the odds API is exhausted when the first new request comes in.
    if (picks.activeSports.length > 0 && lastKnownActiveSports.length === 0) {
      lastKnownActiveSports = picks.activeSports;
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

// ─── Empty result helper ───────────────────────────────────────────────────────

function buildEmptyResult(activeSportsList: string[], summary: string): AIPicksResponse {
  return {
    lockOfTheDay: null, safeParlay: null, lottoParlay: null,
    gameParlayOfTheDay: null, propParlayOfTheDay: null, mixParlayOfTheDay: null,
    allSafeParlay: null, allLottoParlay: null, allGameParlay: null,
    allPropsParlay: null, allMixParlay: null,
    hrParlay: null, goalScorerParlay: null, threePtParlay: null, tdParlay: null,
    allLadder: null, nbaLadder: null, mlbLadder: null, nhlLadder: null, nflLadder: null,
    wnbaLadder: null, soccerLadder: null,
    summary,
    generatedAt: new Date().toISOString(),
    isAI: false,
    activeSports: activeSportsList,
  };
}

// INTENTIONAL BREAK — force TypeScript to fail if buildFallbackPicks is re-introduced
// All data must come from real bookmaker odds. No hardcoded mock picks allowed.
function _placeholder_never_called(): never {
  throw new Error("buildFallbackPicks was removed — all data must be real");
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

  // ── Live validity gate — runs before serving any cached picks ───────────────
  // Checks: (1) game still in the odds feed (not canceled/postponed)
  //         (2) player prop athletes still available (not ruled out/scratched)
  // All three sources have 20-min in-process TTL caches — cheap on every request.
  const [liveOddsForValidation, nbaOutLive, nhlOutLive, mlbLineupsLive] = await Promise.all([
    fetchAllSportOdds().catch(() => null),
    fetchNbaOut().catch(() => null),
    fetchNhlOut().catch(() => null),
    fetchMlbLineupNames().catch(() => null),
  ]);

  const liveGameIds = new Set<string>();
  if (liveOddsForValidation) {
    const nowForValidation = Date.now();
    for (const { events } of liveOddsForValidation) {
      for (const ev of events) {
        if (new Date(ev.commence_time).getTime() > nowForValidation) {
          liveGameIds.add(ev.id);
        }
      }
    }
  }
  // If the Odds API is unreachable, skip validation and serve whatever we have
  const canValidate = liveGameIds.size > 0;
  let wasAutoRefreshed = false;

  const cached = picksCacheMap.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    if (!canValidate || !picksHaveInvalidLeg(cached.data, liveGameIds, nbaOutLive, nhlOutLive, mlbLineupsLive)) {
      return res.json(cached.data);
    }
    req.log.warn({ cacheKey }, "Picks invalidated (cache): game canceled or player scratched — regenerating");
    picksCacheMap.delete(cacheKey);
    await deletePicksFromDb(cacheKey);
    wasAutoRefreshed = true;
  }

  // Check DB for today's persisted picks — generated once, stable all day.
  const dbPicks = await loadPicksFromDb(cacheKey);
  if (dbPicks) {
    if (!canValidate || !picksHaveInvalidLeg(dbPicks, liveGameIds, nbaOutLive, nhlOutLive, mlbLineupsLive)) {
      picksCacheMap.set(cacheKey, { data: dbPicks, expiresAt: Date.now() + CACHE_TTL });
      return res.json(dbPicks);
    }
    req.log.warn({ cacheKey }, "Picks invalidated (DB): game canceled or player scratched — regenerating");
    await deletePicksFromDb(cacheKey);
    wasAutoRefreshed = true;
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

    // Combat sports (Boxing/MMA) run Saturday night US = early Sunday UTC.
    // Always look 36h ahead so fight cards are never cut off when other sports
    // anchor the main cutoff to "end of today".
    const combatCutoffMs = Math.max(todayCutoffMs, endOfDayEasternMs(1));

    // Sport tabs to show: only sports with at least 1 upcoming game with any h2h coverage.
    // Uses actual odds data (not the /sports catalog) so off-season sports never appear.
    // Falls back (in order) to: memory-cached "all" picks → lastKnownActiveSports →
    // DB snapshots (recent upcoming games) so tabs survive quota exhaustion.
    const catalogActiveSports = await (async () => {
      // For tab visibility, include sports with ANY event today in Eastern time — even if
      // matches have already started. International sports (Tennis, Soccer morning kick-offs)
      // often begin during US overnight hours and would disappear mid-day if we filtered
      // only by upcoming games. The actual picks still only use upcoming games.
      const todayStartMs = startOfDayEasternMs();
      const fromOdds = allOddsRaw
        .filter(({ sport, events }) => {
          const cutoff = (sport === "Boxing" || sport === "MMA") ? combatCutoffMs : todayCutoffMs;
          return events.some((ev) => {
            const t = new Date(ev.commence_time).getTime();
            if (t < todayStartMs || t > cutoff) return false;
            return ev.bookmakers.some((b) => b.markets.some((m) => m.key === "h2h"));
          });
        })
        .map(({ sport }) => sport);
      if (fromOdds.length > 0) {
        lastKnownActiveSports = fromOdds; // persist for quota-exhausted sessions
        return fromOdds;
      }
      // Quota exhausted — try memory-cached "all" picks first
      const allMem = picksCacheMap.get("all");
      if (allMem && allMem.expiresAt > Date.now() && allMem.data.activeSports.length > 0) {
        return allMem.data.activeSports;
      }
      // Try last known (from an earlier request this server session)
      if (lastKnownActiveSports.length > 0) return lastKnownActiveSports;
      // Last resort: query the DB snapshots for sports with upcoming games in the next 48h.
      // The snapshot job runs every 5 min and stores odds even when the API key is rate-limited,
      // so this gives us the correct sport list even after a fresh server restart with no quota.
      try {
        // Only count sports whose snapshots were taken in the last 24h AND whose games
        // haven't started yet. This prevents stale NFL/NCAAF data from leaking in during
        // their off-season since the snapshot pruning window is 48h.
        const recentCutoff = new Date(nowMs - 24 * 60 * 60 * 1000);
        const rows = await db
          .selectDistinct({ sport: oddsSnapshotsTable.sport })
          .from(oddsSnapshotsTable)
          .where(and(
            gt(oddsSnapshotsTable.commenceTime, new Date(nowMs)),
            lte(oddsSnapshotsTable.commenceTime, new Date(todayCutoffMs)),
            gte(oddsSnapshotsTable.snapshotAt, recentCutoff),
          ));
        const fromSnapshots = rows.map((r) => r.sport).filter(Boolean) as string[];
        if (fromSnapshots.length > 0) {
          lastKnownActiveSports = fromSnapshots;
          return fromSnapshots;
        }
      } catch { /* ignore DB errors */ }
      return []; // truly no data available
    })();

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
    // Shops ALL books — picks the outcome+book combo with the highest American odds (best payout).
    // Falls back to totals Over if no h2h market is available.
    function eventToLeg(event: OddsEvent, sportLabel: string): AIPickLeg | null {
      // Shop all books for h2h — find the outcome with the single best (highest) price
      let bestOutcome: { name: string; price: number; bookDisplay: string } | null = null;
      for (const book of event.bookmakers) {
        const h2h = book.markets.find((m) => m.key === "h2h");
        if (!h2h || h2h.outcomes.length < 2) continue;
        const bookDisplay = BOOKMAKER_DISPLAY[book.key] ?? book.title;
        for (const out of h2h.outcomes) {
          if (!bestOutcome || out.price > bestOutcome.price) {
            bestOutcome = { name: out.name, price: out.price, bookDisplay };
          }
        }
      }
      if (bestOutcome) {
        return {
          gameId: event.id,
          sport: sportLabel,
          homeTeam: event.home_team,
          awayTeam: event.away_team,
          startTime: event.commence_time,
          pick: bestOutcome.name,
          betType: "moneyline",
          bookmaker: bestOutcome.bookDisplay,
          odds: bestOutcome.price,
          player: null,
        };
      }
      // Fall back to totals Over — shop all books for best Over price
      let bestOver: { point: number; price: number; bookDisplay: string } | null = null;
      for (const book of event.bookmakers) {
        const totals = book.markets.find((m) => m.key === "totals");
        if (!totals) continue;
        const over = totals.outcomes.find((o) => o.name === "Over");
        if (!over) continue;
        const bookDisplay = BOOKMAKER_DISPLAY[book.key] ?? book.title;
        if (!bestOver || over.price > bestOver.price) {
          bestOver = { point: over.point ?? 0, price: over.price, bookDisplay };
        }
      }
      if (bestOver) {
        return {
          gameId: event.id,
          sport: sportLabel,
          homeTeam: event.home_team,
          awayTeam: event.away_team,
          startTime: event.commence_time,
          pick: `Over ${bestOver.point}`,
          betType: "total",
          bookmaker: bestOver.bookDisplay,
          odds: bestOver.price,
          player: null,
        };
      }
      return null;
    }

    // eventToFavoriteLeg: always picks the FAVORITE, shopping all books for best value on that side.
    // "Best value" for a favorite = highest (least negative) American odds across all books.
    function eventToFavoriteLeg(event: OddsEvent, sportLabel: string): AIPickLeg | null {
      // Identify the favorite name (most negative odds in consensus), then find the best price for
      // that team across all books. This separates "which team" from "which book has the best line".
      const allH2hBooks = event.bookmakers
        .map((bk) => ({ book: bk, h2h: bk.markets.find((m) => m.key === "h2h") }))
        .filter((x): x is { book: typeof x.book; h2h: NonNullable<typeof x.h2h> } => !!x.h2h && x.h2h.outcomes.length >= 2);

      if (allH2hBooks.length > 0) {
        // Find the favorite by averaging prices across books
        const teamPrices = new Map<string, number[]>();
        for (const { h2h } of allH2hBooks) {
          for (const out of h2h.outcomes) {
            if (!teamPrices.has(out.name)) teamPrices.set(out.name, []);
            teamPrices.get(out.name)!.push(out.price);
          }
        }
        const avgPrice = (name: string) => {
          const prices = teamPrices.get(name) ?? [];
          return prices.reduce((s, p) => s + p, 0) / (prices.length || 1);
        };
        const favoriteName = [...teamPrices.keys()].reduce((a, b) => avgPrice(a) < avgPrice(b) ? a : b);

        // Now shop all books for the best price on the favorite
        let bestPrice = -Infinity;
        let bestBookDisplay = "";
        for (const { book, h2h } of allH2hBooks) {
          const out = h2h.outcomes.find((o) => o.name === favoriteName);
          if (!out) continue;
          if (out.price > bestPrice) {
            bestPrice = out.price;
            bestBookDisplay = BOOKMAKER_DISPLAY[book.key] ?? book.title;
          }
        }
        return {
          gameId: event.id,
          sport: sportLabel,
          homeTeam: event.home_team,
          awayTeam: event.away_team,
          startTime: event.commence_time,
          pick: favoriteName,
          betType: "moneyline",
          bookmaker: bestBookDisplay,
          odds: bestPrice,
          player: null,
        };
      }

      // Fall back to totals Under — shop all books for best Under price
      let bestUnder: { point: number; price: number; bookDisplay: string } | null = null;
      for (const book of event.bookmakers) {
        const totals = book.markets.find((m) => m.key === "totals");
        if (!totals) continue;
        const under = totals.outcomes.find((o) => o.name === "Under");
        if (!under) continue;
        const bookDisplay = BOOKMAKER_DISPLAY[book.key] ?? book.title;
        if (!bestUnder || under.price > bestUnder.price) {
          bestUnder = { point: under.point ?? 0, price: under.price, bookDisplay };
        }
      }
      if (bestUnder) {
        return {
          gameId: event.id,
          sport: sportLabel,
          homeTeam: event.home_team,
          awayTeam: event.away_team,
          startTime: event.commence_time,
          pick: `Under ${bestUnder.point}`,
          betType: "total",
          bookmaker: bestUnder.bookDisplay,
          odds: bestUnder.price,
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
          const effectiveCutoff = (sportLabel === "Boxing" || sportLabel === "MMA") ? combatCutoffMs : todayCutoffMs;
          if (t <= nowMs || t > effectiveCutoff) continue;
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

    // ── Book-count threshold — US sports need 3+ books; international need only 1 ──
    const US_SPORTS = new Set(["NBA", "MLB", "NHL", "NFL", "NCAAB", "NCAAF", "WNBA"]);
    const minBooks = (sportLabel: string) => US_SPORTS.has(sportLabel) ? 3 : 1;

    // ── Score-sorted game leg pools ───────────────────────────────────────────
    // Score = book count + de-vig edge + Elo model edge + steam signal + context bonus.
    type GameScore = { score: number; steamScore: number; eloEdgePct: number | null };
    const gameScoreMap = new Map<string, GameScore>(); // key: `${gameId}::${outcomeName}`

    for (const { sport: sportLabel, events } of allOdds) {
      for (const ev of events) {
        const t = new Date(ev.commence_time).getTime();
        const effectiveCutoff = (sportLabel === "Boxing" || sportLabel === "MMA") ? combatCutoffMs : todayCutoffMs;
        if (t <= nowMs || t > effectiveCutoff) continue;

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
    const gameLegPool: AIPickLeg[] = [];
    for (const { sport: sportLabel, events } of allOdds) {
      for (const ev of events) {
        const t = new Date(ev.commence_time).getTime();
        const effectiveCutoff = (sportLabel === "Boxing" || sportLabel === "MMA") ? combatCutoffMs : todayCutoffMs;
        if (t <= nowMs || t > effectiveCutoff) continue;
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
        const effectiveCutoff = (sportLabel === "Boxing" || sportLabel === "MMA") ? combatCutoffMs : todayCutoffMs;
        if (t <= nowMs || t > effectiveCutoff) continue;
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
        // Before returning empty, check if the "all" picks cache has picks for this sport.
        // This avoids a blank tab when odds quota is exhausted — the "all" picks were built
        // when quota was available and already contain legs for every sport.
        const allCached = picksCacheMap.get("all");
        if (allCached && allCached.expiresAt > Date.now()) {
          const all = allCached.data;
          const filterParlay = (p: AIParlay | null): AIParlay | null => {
            if (!p) return null;
            const legs = p.legs.filter((l) => l.sport === cacheKey);
            return legs.length > 0 ? { ...p, legs } : null;
          };
          const sportResult: AIPicksResponse = {
            lockOfTheDay: all.lockOfTheDay?.sport === cacheKey ? all.lockOfTheDay : null,
            safeParlay: filterParlay(all.safeParlay),
            lottoParlay: filterParlay(all.lottoParlay),
            gameParlayOfTheDay: filterParlay(all.gameParlayOfTheDay),
            propParlayOfTheDay: filterParlay(all.propParlayOfTheDay),
            mixParlayOfTheDay: filterParlay(all.mixParlayOfTheDay),
            allSafeParlay: null, allLottoParlay: null, allGameParlay: null,
            allPropsParlay: null, allMixParlay: null,
            hrParlay:          cacheKey === "MLB" ? all.hrParlay : null,
            goalScorerParlay:  cacheKey === "NHL" ? all.goalScorerParlay : null,
            threePtParlay:     cacheKey === "NBA" ? all.threePtParlay : null,
            tdParlay:          cacheKey === "NFL" ? all.tdParlay : null,
            allLadder: null,
            nbaLadder:    cacheKey === "NBA"    ? all.nbaLadder    : null,
            mlbLadder:    cacheKey === "MLB"    ? all.mlbLadder    : null,
            nhlLadder:    cacheKey === "NHL"    ? all.nhlLadder    : null,
            nflLadder:    cacheKey === "NFL"    ? all.nflLadder    : null,
            wnbaLadder:   cacheKey === "WNBA"   ? all.wnbaLadder   : null,
            soccerLadder: cacheKey === "Soccer" ? all.soccerLadder : null,
            summary: all.summary,
            generatedAt: all.generatedAt,
            isAI: all.isAI,
            activeSports: all.activeSports,
          };
          const hasContent = sportResult.lockOfTheDay != null || [
            sportResult.safeParlay, sportResult.lottoParlay, sportResult.gameParlayOfTheDay,
            sportResult.propParlayOfTheDay, sportResult.nbaLadder, sportResult.mlbLadder,
            sportResult.nhlLadder, sportResult.nflLadder, sportResult.wnbaLadder,
            sportResult.soccerLadder, sportResult.hrParlay,
            sportResult.goalScorerParlay, sportResult.threePtParlay,
          ].some(Boolean);
          if (hasContent) {
            picksCacheMap.set(cacheKey, { data: sportResult, expiresAt: allCached.expiresAt });
            return res.json(sportResult);
          }
        }

        const emptyResult: AIPicksResponse = {
          lockOfTheDay: null, safeParlay: null, lottoParlay: null,
          gameParlayOfTheDay: null, propParlayOfTheDay: null, mixParlayOfTheDay: null,
          allSafeParlay: null, allLottoParlay: null, allGameParlay: null,
          allPropsParlay: null, allMixParlay: null,
          hrParlay: null, goalScorerParlay: null, threePtParlay: null, tdParlay: null,
          allLadder: null, nbaLadder: null, mlbLadder: null, nhlLadder: null, nflLadder: null,
          wnbaLadder: null, soccerLadder: null,
          summary: `No ${cacheKey} games on the board with enough market coverage today.`,
          generatedAt: new Date().toISOString(),
          isAI: false,
          activeSports: catalogActiveSports,
        };
        void savePicksToDb(cacheKey, emptyResult);
        picksCacheMap.set(cacheKey, { data: emptyResult, expiresAt: Date.now() + 5 * 60_000 });
        return res.json(emptyResult);
      }
      const emptyAll = buildEmptyResult(catalogActiveSports, "No games on the board with enough market coverage today. Check back when tonight's lines are posted.");
      void savePicksToDb(cacheKey, emptyAll);
      picksCacheMap.set(cacheKey, { data: emptyAll, expiresAt: Date.now() + 5 * 60_000 });
      return res.json(emptyAll);
    }

    // Normalize sport labels (API keys like "basketball_nba" → display label "NBA")
    // Defined here so it can be used by both the lock selection and the parlay builders below.
    function normSport(s: string): string {
      // If already a display label (no underscores), return as-is
      if (!s.includes("_")) return s;
      return SPORT_API_TO_LABEL[s] ?? SPORT_FROM_KEY[s] ?? s.toUpperCase();
    }

    // ── LOCK OF THE DAY ──────────────────────────────────────────────────────
    // Pure "best pick wins" — no sport rotation, no favouritism.
    // Score every candidate (game legs + prop legs) by lock quality:
    //   lockScore = impliedProbability% + eloEdge*2 + gameCompositeBonus
    // The highest-scoring pick wins, regardless of sport or bet type.
    //
    // For the ALL-SPORTS tab: all sports + all bet types compete.
    // For individual sport tabs: only that sport's pool competes (gameLegPool
    // is already filtered to the selected sport when cacheKey !== "all").
    function impliedProbPct(odds: number): number {
      return odds > 0
        ? (100 / (odds + 100)) * 100
        : (Math.abs(odds) / (Math.abs(odds) + 100)) * 100;
    }
    function lockScore(leg: AIPickLeg): number {
      const impliedP = impliedProbPct(leg.odds);
      const eloEdge  = getEloEdge(leg.gameId, leg.pick) ?? 0;
      const gameComp = getGameScore(leg.gameId, leg.pick); // 0 for prop legs
      // Implied probability is the foundation — we want the most likely bet to hit.
      // Elo edge rewards model-backed picks. Game composite is a small tiebreaker.
      return impliedP + eloEdge * 2 + gameComp * 0.1;
    }
    const lockCandidates: AIPickLeg[] = [...gameLegPool, ...propPool];
    lockCandidates.sort((a, b) => lockScore(b) - lockScore(a));
    let lockLeg: AIPickLeg = lockCandidates[0];
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

    // Game IDs already committed to the lock — excluded from all parlays below so
    // no parlay repeats a leg that the Lock of the Day already shows.
    const lockExcludeIds = new Set<string>([lockLeg.gameId]);

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
    // Requires only 1 game leg; supplements with props when slate is thin (e.g. NBA with 1 game).
    // Excludes the Lock of the Day game so no leg appears in both the Lock and Safe Parlay.
    const safePool = topSportPool(1);
    const safeLegs = (() => {
      const gameLegs = safePool ? pickUnique(safePool.legs, 3, lockExcludeIds) : [];
      if (gameLegs.length >= 2) return gameLegs;
      // Short game slate — supplement with player prop legs.
      // Try the scored prop pool first (strict -130 filter). If that's empty (can happen when
      // only 1 game is on the board and few props clear the threshold), fall back to ALL
      // filteredProps for this sport, sorted by most-favorite odds — so NBA games with 1 matchup
      // still build a safe parlay from the available player prop lines.
      const sportLabel = safePool?.sport ?? (cacheKey !== "all" ? normSport(cacheKey) : "");
      const strictPool = propsBySport.get(sportLabel) ?? [];
      const seenSafePlayers = new Set<string>();
      const fillLegs = (strictPool.length > 0
        ? strictPool
        : filteredProps
            .slice()
            .sort((a, b) => Math.min(a.overOdds, a.underOdds) - Math.min(b.overOdds, b.underOdds))
            .map(propToFavoriteLeg)
      )
        .filter((l) => {
          if (l.player && seenSafePlayers.has(l.player)) return false;
          if (l.player) seenSafePlayers.add(l.player);
          return true;
        })
        .slice(0, 3 - gameLegs.length);
      return [...gameLegs, ...fillLegs];
    })();
    const safeSport = safePool?.sport ?? "";
    const safeParlay: AIParlay | null = safeLegs.length >= 2 ? {
      id: "safe-1",
      name: `${safeSport} ${safeLegs.length}-Leg Value Parlay`,
      legs: safeLegs,
      combinedOdds: calcCombinedOdds(safeLegs),
      confidence: 62,
      reasoning: `${safeLegs.length} ${safeSport} picks for today's slate — combined into a conservative parlay targeting solid upside.`,
    } : null;

    // Track game IDs already used by Lock + Safe Parlay so the Game Parlay
    // never repeats a leg shown elsewhere above it on the page.
    const safeUsedIds = new Set<string>([...lockExcludeIds, ...safeLegs.map(l => l.gameId)]);

    // ── GAME PARLAY: up to 4 game bets, same sport ───────────────────────────
    // Works with just 1 game available — useful for thin slates (single NBA game, tennis, etc.)
    // Only excludes the Lock game — if we also excluded Safe Parlay games we'd have nothing
    // left on thin slates (e.g. 2 NBA games: lock uses 1, safe uses the other → game parlay empty).
    const gamePool = topSportPool(1);
    const gameLegs = gamePool ? pickUnique(gamePool.legs, 4, lockExcludeIds) : [];
    const gameSport = gamePool?.sport ?? "";
    const gameParlayOfTheDay: AIParlay | null = gameLegs.length >= 1 ? {
      id: "game-1",
      name: `${gameSport} Game ${gameLegs.length}-Legger`,
      legs: gameLegs,
      combinedOdds: calcCombinedOdds(gameLegs),
      confidence: Math.min(65, Math.round(40 + gameLegs.length * 3)),
      reasoning: `Pure ${gameSport} game-line parlay — moneylines, spreads, and totals only. Best available lines from today's full ${gameSport} slate.`,
    } : null;

    // Track all game IDs used by Lock + Safe + Game Parlay — Mix Parlay's game
    // side must draw from what's left so no game leg appears in two parlays.
    const gameUsedIds = new Set<string>([...safeUsedIds, ...gameLegs.map(l => l.gameId)]);

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

    // Track player names already committed to lottoParlay so allLottoParlay
    // (cross-sport) never reuses a prop leg from the single-sport Lotto.
    const usedLottoPlayers = new Set<string>(
      lottoLegs.flatMap(l => ('player' in l && l.player) ? [l.player as string] : []),
    );

    // ── PROPS PARLAY: 3-4 props, same sport ──────────────────────────────────
    // For sports without player prop markets (Soccer, Tennis, MMA), falls back to
    // underdog game picks so the prop parlay section always has content.
    const sortedPropSports = [...propsBySport.entries()].sort((a, b) => b[1].length - a[1].length);
    const topPropSport = sortedPropSports[0];
    const propParlayLegs = (() => {
      if (topPropSport) return topPropSport[1].slice(0, 4);
      const fallbackSportLabel = cacheKey !== "all" ? normSport(cacheKey) : "";
      // MMA/Boxing: generate fight-method picks (KO/Submission/Decision) instead of plain moneylines
      if (fallbackSportLabel === "MMA" || fallbackSportLabel === "Boxing") {
        const fightLegs = legsBySport.get(fallbackSportLabel) ?? [];
        const methodLegs = fightLegs.map((leg) => buildFightMethodLeg(leg)).slice(0, 4);
        if (methodLegs.length >= 2) return methodLegs;
      }
      // Other prop-less sports (Soccer, Tennis, etc.) — use underdog game picks
      return (underdogLegsBySport.get(fallbackSportLabel) ?? underdogLegPool).slice(0, 4);
    })();
    const propSportLabel = topPropSport?.[0] ?? (cacheKey !== "all" ? normSport(cacheKey) : "");
    const isCombatSport = propSportLabel === "MMA" || propSportLabel === "Boxing";
    const propParlayOfTheDay: AIParlay | null = propParlayLegs.length >= 2 ? {
      id: "prop-1",
      name: isCombatSport
        ? `${propSportLabel} Fight Method ${propParlayLegs.length}-Legger`
        : `${propSportLabel} Props ${propParlayLegs.length}-Legger`,
      legs: propParlayLegs,
      combinedOdds: calcCombinedOdds(propParlayLegs),
      confidence: Math.max(20, Math.round(44 - propParlayLegs.length * 2)),
      reasoning: isCombatSport
        ? `Fight method picks for tonight's ${propSportLabel} card — KO, submission, and decision props based on each fighter's finishing history.`
        : `Real bookmaker lines for these ${propSportLabel} player performance props, sourced directly from the best available odds across major sportsbooks.`,
    } : null;

    // Track player names already committed to Props Parlay so Mix Parlay's prop
    // side and the cross-sport allPropsParlay never repeat the same player.
    const usedPropPlayers = new Set<string>(
      propParlayLegs.flatMap(l => ('player' in l && l.player) ? [l.player as string] : []),
    );

    // ── MIX PARLAY: best 3-4 legs — any mix of game bets and player props ─────
    // No forced ratio. The only rule: must include at least 1 game leg AND 1 prop
    // leg — otherwise it would just be a props parlay or a game parlay.
    // Game side excludes IDs already used by Lock + Safe + Game Parlay so
    // no game appears in two different parlays.
    const mixSportEntry = sortedSports.find(([s]) => (propsBySport.get(s)?.length ?? 0) >= 1)
      ?? sortedSports[0] ?? null;
    const mixSportLabel = mixSportEntry?.[0] ?? "";
    // Allow mix parlay to draw from ALL game legs for its sport — the aggressive
    // gameUsedIds exclusion left mix parlay with zero game legs on thin slates (2 games),
    // which triggered the fallback that picked both sides of the same game.
    const mixAllGameLegs = mixSportEntry?.[1] ?? [];
    // Exclude players already in Props Parlay so Mix and Props never share a prop leg.
    const mixAllPropLegs = (propsBySport.get(mixSportLabel) ?? []).filter(l => !l.player || !usedPropPlayers.has(l.player));
    const mixLegs = (() => {
      // Guarantee at least 1 game + 1 prop to qualify as "mixed", then fill to 4
      const firstGame = mixAllGameLegs[0];
      const firstProp = mixAllPropLegs[0];
      if (!firstGame || !firstProp) {
        // No props — for prop-less sports (Soccer, Tennis, MMA) interleave favorites
        // and underdogs from the same sport so the mix section has content
        const fallbackLabel = cacheKey !== "all" ? normSport(cacheKey) : mixSportLabel;
        const favLegs  = (legsBySport.get(fallbackLabel) ?? []).slice(0, 4);
        const dogLegs  = (underdogLegsBySport.get(fallbackLabel) ?? []).slice(0, 4);
        // Deduplicate by gameId — MUST NOT include both sides of the same game.
        // Favorites go first (the safer pick), then underdogs from different games.
        const usedFallbackIds = new Set<string>();
        const combined: AIPickLeg[] = [];
        for (const leg of favLegs) {
          if (combined.length >= 4) break;
          if (usedFallbackIds.has(leg.gameId)) continue;
          combined.push(leg);
          usedFallbackIds.add(leg.gameId);
        }
        for (const leg of dogLegs) {
          if (combined.length >= 4) break;
          if (usedFallbackIds.has(leg.gameId)) continue;
          combined.push(leg);
          usedFallbackIds.add(leg.gameId);
        }
        return combined;
      }
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

    // Game IDs used by Mix Parlay's game side — extended exclusion set for
    // allSafeParlay so it doesn't share game legs with any sport-specific parlay.
    const mixGameIds = new Set<string>(
      mixLegs.filter(l => l.betType !== "player_prop").map(l => l.gameId),
    );
    const allSafeExcludeIds = new Set<string>([...gameUsedIds, ...mixGameIds]);

    // Extend usedPropPlayers with Mix Parlay's prop legs so allPropsParlay (built
    // later) never contains a player already shown in the Mix Parlay.
    mixLegs.filter(l => l.player).forEach(l => usedPropPlayers.add(l.player!));

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

    // allSafeParlay: cross-sport favorites — exclude game IDs already used by Lock/Safe/Game/Mix
    // parlays so the All Sports tab doesn't repeat legs shown in single-sport views.
    const filteredLegsBySportForAllSafe = new Map<string, AIPickLeg[]>(
      [...legsBySport.entries()].map(([s, legs]) => [s, legs.filter(l => !allSafeExcludeIds.has(l.gameId))]),
    );
    const allSafeCrossLegs = buildCrossSportLegs(filteredLegsBySportForAllSafe, 3);
    const allSafeParlay: AIParlay | null = allSafeCrossLegs.length >= 2 ? {
      id: "all-safe-1",
      name: `${allSafeCrossLegs.length}-Leg Cross-Sport Value Parlay`,
      legs: allSafeCrossLegs,
      combinedOdds: calcCombinedOdds(allSafeCrossLegs),
      confidence: Math.min(68, Math.round(48 + allSafeCrossLegs.length * 2)),
      reasoning: `${allSafeCrossLegs.length} game bets drawn from across today's active sports — one per sport, each carrying a positive edge per our model.`,
    } : null;

    // allLottoParlay: use the lotto prop pool (highest-odds/plus-money side) — underdog hunting
    // Exclude players already in the single-sport lottoParlay so no prop appears in both.
    const allLottoPropMap = new Map(
      [...lottoPropsBySport.entries()].map(([s, legs]) => [
        s,
        [...legs]
          .filter(l => !l.player || !usedLottoPlayers.has(l.player))
          .sort((a, b) => b.odds - a.odds),
      ]),
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

    // Exclude players already committed to propParlayOfTheDay so allPropsParlay
    // never shares a prop leg with the single-sport Props Parlay.
    const filteredPropsBySportForAll = new Map<string, AIPickLeg[]>(
      [...propsBySport.entries()].map(([s, legs]) => [
        s, legs.filter(l => !l.player || !usedPropPlayers.has(l.player)),
      ]),
    );
    const allPropsCrossLegs = buildCrossSportLegs(filteredPropsBySportForAll, 4);
    const allPropsParlay: AIParlay | null = allPropsCrossLegs.length >= 2 ? {
      id: "all-props-1",
      name: `${allPropsCrossLegs.length}-Leg Cross-Sport Props`,
      legs: allPropsCrossLegs,
      combinedOdds: calcCombinedOdds(allPropsCrossLegs),
      confidence: Math.max(22, Math.round(44 - allPropsCrossLegs.length * 2)),
      reasoning: `Player performance props sampled from every active sport today — one standout prop per sport for true multi-sport diversification.`,
    } : null;

    // allMixParlay: cross-sport mix — game side excludes all game IDs used by every
    // sport-specific parlay (lock/safe/game/mix) AND allSafeParlay so no game is repeated.
    // Prop side excludes all players already shown in allPropsParlay.
    const allSafeUsedIds = new Set<string>([
      ...allSafeExcludeIds,
      ...allSafeCrossLegs.map(l => l.gameId),
    ]);
    const usedAllPropsPlayers = new Set<string>(
      allPropsCrossLegs.filter(l => l.player).map(l => l.player!),
    );
    const mixCrossMap = new Map<string, AIPickLeg[]>(
      [...legsBySport.keys()].map((s): [string, AIPickLeg[]] => {
        const games = (legsBySport.get(s) ?? []).filter(l => !allSafeUsedIds.has(l.gameId)).slice(0, 1);
        const props = (propsBySport.get(s) ?? [])
          .filter(l => !l.player || (!usedPropPlayers.has(l.player) && !usedAllPropsPlayers.has(l.player)))
          .slice(0, 1);
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

    // MLB: Home Run parlay — anytime HR props, scored by matchup quality.
    // Scoring combines:
    //   1. Implied probability (book consensus on likelihood)
    //   2. Park HR factor — Coors/Cincy/Philly boost; Oracle/Marlins/Mariners penalise
    //   3. Daily-seeded jitter — same player gets a different bump each day so the
    //      same sluggers (Schwarber, Judge) don't monopolise the parlay every day
    // realProps is already filtered for confirmed starters / non-OUT players upstream.
    function buildHrParlayLegs(n: number): AIPickLeg[] {
      // Park HR factors keyed by HOME team name (positive = hitter-friendly)
      const PARK_HR_FACTOR: Record<string, number> = {
        "Colorado Rockies":       10,  // Coors Field — extreme altitude/air
        "Cincinnati Reds":         6,  // Great American Ball Park
        "Philadelphia Phillies":   5,  // Citizens Bank Park
        "Texas Rangers":           5,  // Globe Life Field — hot/thin air
        "Chicago Cubs":            4,  // Wrigley Field
        "New York Yankees":        4,  // Yankee Stadium short porch RF
        "Atlanta Braves":          3,  // Truist Park
        "Boston Red Sox":          3,  // Fenway Park — Green Monster left field
        "Baltimore Orioles":       2,
        "Minnesota Twins":         2,  // Target Field plays medium
        "Milwaukee Brewers":      -2,
        "Kansas City Royals":     -2,
        "Los Angeles Dodgers":    -2,
        "Chicago White Sox":      -2,
        "Houston Astros":         -3,  // Minute Maid (roof closed)
        "Tampa Bay Rays":         -3,  // Tropicana Field dome
        "San Diego Padres":       -4,  // Petco Park — large outfield
        "Seattle Mariners":       -4,  // T-Mobile Park
        "Oakland Athletics":      -4,
        "Miami Marlins":          -5,  // loanDepot park dome
        "San Francisco Giants":   -7,  // Oracle Park — wind/cold kills HRs
      };

      const hrProps = realProps.filter(
        (p) => p.sport === "baseball_mlb" && p.market === "home runs",
      );
      // Group by player — keep only the lowest available line per player
      const bestPerPlayer = new Map<string, CompactProp>();
      for (const p of hrProps) {
        const existing = bestPerPlayer.get(p.player);
        if (!existing || p.line < existing.line ||
            (p.line === existing.line && p.minOverOdds < existing.minOverOdds)) {
          bestPerPlayer.set(p.player, p);
        }
      }

      // Base quality score: park factor + implied probability (no jitter — jitter caused same
      // players to dominate because their implied prob gap was larger than the jitter range).
      function baseHrScore(p: CompactProp): number {
        const impliedProb = p.minOverOdds > 0
          ? (100 / (p.minOverOdds + 100)) * 100
          : (Math.abs(p.minOverOdds) / (Math.abs(p.minOverOdds) + 100)) * 100;
        return impliedProb + (PARK_HR_FACTOR[p.homeTeam] ?? 0) * 0.4;
      }

      // Build a quality pool: all players meeting the minimum quality bar.
      // No per-game cap — early in the day only one or two games have HR props posted,
      // so restricting to one player per game would produce 0–1 legs and kill the parlay.
      // Multiple players from the same game is fine for a themed HR parlay.
      const qualityPool = [...bestPerPlayer.values()]
        .filter((p) => {
          // Minimum quality: implied HR probability ≥ 10% (odds ≤ ~+900).
          // Slightly relaxed from 15% so early-day slates with limited books still qualify.
          const impliedProb = p.minOverOdds > 0
            ? (100 / (p.minOverOdds + 100)) * 100
            : (Math.abs(p.minOverOdds) / (Math.abs(p.minOverOdds) + 100)) * 100;
          return impliedProb >= 10;
        });

      // Random selection from the quality pool — true randomness so each Refresh
      // gives genuinely different picks. Picks are stable all day via DB persistence;
      // an explicit Refresh clears the DB and triggers a new random draw.
      // Prefer players from different games when possible (soft diversity via shuffle),
      // but don't hard-block same-game legs — early-day data may only cover one game.
      const shuffled = [...qualityPool].sort(() => Math.random() - 0.5);
      const selected: CompactProp[] = [];
      const seenGamesSelected = new Set<string>();
      // First pass: pick from different games
      for (const candidate of shuffled) {
        if (selected.length >= n) break;
        if (!seenGamesSelected.has(candidate.gameId)) {
          selected.push(candidate);
          seenGamesSelected.add(candidate.gameId);
        }
      }
      // Second pass: fill remaining slots from any game if we still need legs
      if (selected.length < n) {
        const selectedPlayers = new Set(selected.map((s) => s.player));
        for (const candidate of shuffled) {
          if (selected.length >= n) break;
          if (!selectedPlayers.has(candidate.player)) {
            selected.push(candidate);
            selectedPlayers.add(candidate.player);
          }
        }
      }

      return selected.map((p) => ({
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
    const threePtParlay: AIParlay | null = threePtLegs.length >= 1 ? {
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
      fallbackGameLegs?: AIPickLeg[], // used for prop-less sports (Soccer, Tennis, etc.)
    ): AILadderParlay | null {
      const START = 10;
      const TARGET = 10240;
      const TOTAL_DAYS = 10;
      const seenPlayers = new Set<string>();

      // Use props where the FAVORITE side is a heavy favorite: -180 to -400
      // Two heavy favorites combined (~-250 each) give a near even-money parlay
      const rawPropCandidates: AIPickLeg[] = realProps
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

      // For the All Sports ladder: interleave props by sport so the ladder doesn't
      // show only NBA legs every day. Round-robin one leg per sport at a time.
      const propCandidates: AIPickLeg[] = (() => {
        if (sportLabel !== "All Sports" || rawPropCandidates.length === 0) return rawPropCandidates;
        const bySport = new Map<string, AIPickLeg[]>();
        for (const leg of rawPropCandidates) {
          const s = leg.sport;
          if (!bySport.has(s)) bySport.set(s, []);
          bySport.get(s)!.push(leg);
        }
        const sportCycle = [...bySport.keys()];
        const interleaved: AIPickLeg[] = [];
        let si = 0;
        while (interleaved.length < rawPropCandidates.length) {
          const pool = bySport.get(sportCycle[si % sportCycle.length]);
          if (pool && pool.length > 0) interleaved.push(pool.shift()!);
          si++;
          if (sportCycle.every(s => (bySport.get(s)?.length ?? 0) === 0)) break;
        }
        return interleaved;
      })();

      // Fall back to game legs for prop-less sports (Soccer, Tennis, MMA).
      // Game favorites in the -120 to -350 range behave similarly to heavy prop favorites.
      const candidates: AIPickLeg[] = propCandidates.length >= 2
        ? propCandidates
        : (fallbackGameLegs ?? []).filter((l) => l.odds >= -350 && l.odds <= -110);

      if (candidates.length < 2) return null;

      const steps: AILadderStep[] = [];
      let stake = START;

      if (sportLabel === "All Sports") {
        // Build per-sport queues from prop candidates (leg.sport is already a display label).
        // Supplement sports that have zero prop candidates with game-line favorites so that
        // every sport with live games today can contribute a leg.
        const sportQueue = new Map<string, AIPickLeg[]>();
        for (const leg of candidates) {
          if (!sportQueue.has(leg.sport)) sportQueue.set(leg.sport, []);
          sportQueue.get(leg.sport)!.push(leg);
        }
        for (const [s, legs] of legsBySport.entries()) {
          if ((sportQueue.get(s)?.length ?? 0) > 0) continue;
          const favs = legs.filter((l) => l.odds >= -350 && l.odds <= -110);
          if (favs.length > 0) sportQueue.set(s, [...favs]);
        }

        // Each day: pick the top leg from the sport with the most remaining candidates,
        // then pick the top leg from the sport with the second-most — guaranteed different sports.
        for (let day = 1; day <= TOTAL_DAYS; day++) {
          const available = [...sportQueue.entries()]
            .filter(([, q]) => q.length > 0)
            .sort((a, b) => b[1].length - a[1].length);
          if (available.length < 2) break;
          const leg1 = available[0][1].shift()!;
          const leg2 = available[1][1].shift()!;
          const combined = americanToDecimal(leg1.odds) * americanToDecimal(leg2.odds);
          const targetWin = parseFloat((stake * combined).toFixed(2));
          steps.push({ day, stake: parseFloat(stake.toFixed(2)), targetWin, legs: [leg1, leg2] });
          stake = targetWin;
        }
      } else {
        // Single-sport: walk flat candidates array, skip same-game duplicates only.
        let idx = 0;
        for (let day = 1; day <= TOTAL_DAYS && idx + 1 < candidates.length; day++) {
          const leg1 = candidates[idx++];
          while (idx < candidates.length && candidates[idx].gameId === leg1.gameId) idx++;
          if (idx >= candidates.length) break;
          const leg2 = candidates[idx++];
          const combined = americanToDecimal(leg1.odds) * americanToDecimal(leg2.odds);
          const targetWin = parseFloat((stake * combined).toFixed(2));
          steps.push({ day, stake: parseFloat(stake.toFixed(2)), targetWin, legs: [leg1, leg2] });
          stake = targetWin;
        }
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
    async function getOrBuildLadder(
      apiKeys: string[],
      sportLabel: string,
      fallbackLegs?: AIPickLeg[],
    ): Promise<AILadderParlay | null> {
      const stored = await loadLadderFromDb(sportLabel);
      if (stored) return stored;
      const generated = buildDailyLadder(apiKeys, sportLabel, fallbackLegs);
      if (generated) await saveLadderToDb(sportLabel, generated);
      return generated;
    }

    // All-sports ladder: pool candidates from EVERY sport that has props today,
    // not just the top 2 — so the best legs genuinely come from across all sports.
    const allPropSportKeys = [...new Set(realProps.map((p) => p.sport))];

    // Soccer ladder uses game-leg favorites since soccer has no player prop markets.
    // WNBA ladder also falls back to game legs: WNBA props tend to be -130 to -160
    // (below the -180 prop threshold), so the game-leg fallback ensures the ladder builds.
    const soccerGameFavLegs = (legsBySport.get("Soccer") ?? [])
      .filter((l) => l.odds >= -350 && l.odds <= -110);
    const wnbaGameFavLegs = (legsBySport.get("WNBA") ?? [])
      .filter((l) => l.odds >= -350 && l.odds <= -110);

    const [nbaLadder, mlbLadder, nhlLadder, nflLadder, wnbaLadder, soccerLadder, allLadder] = await Promise.all([
      getOrBuildLadder(["basketball_nba"], "NBA"),
      getOrBuildLadder(["baseball_mlb"], "MLB"),
      getOrBuildLadder(["icehockey_nhl"], "NHL"),
      getOrBuildLadder(["americanfootball_nfl"], "NFL"),
      getOrBuildLadder(["basketball_wnba"], "WNBA", wnbaGameFavLegs),
      getOrBuildLadder([], "Soccer", soccerGameFavLegs),
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
      wnbaLadder,
      soccerLadder,
      summary,
      generatedAt: new Date().toISOString(),
      isAI: false,
      // Only show a sport tab when it has actual game legs — prevents empty Boxing/Tennis
      // tabs from appearing on days with no events for that sport.
      activeSports: (() => {
        const sportsWithLegs = new Set(
          [...legsBySport.keys()].filter((s) => (legsBySport.get(s)?.length ?? 0) > 0),
        );
        const filtered = catalogActiveSports.filter((s) => sportsWithLegs.has(s));
        // Fall back to full catalog if filtering produces nothing (e.g. first run)
        return filtered.length > 0 ? filtered : catalogActiveSports;
      })(),
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
    return res.json(wasAutoRefreshed ? { ...result, autoRefreshed: true } : result);

  } catch (err) {
    req.log.error({ err }, "Picks generation failed");
    const errResult = buildEmptyResult(["NBA", "MLB", "NHL", "NFL"], "Picks generation encountered an error. Please try refreshing.");
    picksCacheMap.set(cacheKey, { data: errResult, expiresAt: Date.now() + 60_000 });
    return res.json(errResult);
  }
});

// Force refresh — clears in-memory cache, today's daily_picks rows, AND today's
// daily_ladders rows so both picks AND ladders regenerate on the next request.
// Also clears the props cache so HR/goal-scorer/3PT/TD parlays get fresh lines
// from the API (books post those props mid-day after the initial picks are cached).
router.post("/ai-picks/refresh", async (req, res) => {
  const sport = typeof req.query.sport === "string" ? req.query.sport.toUpperCase() : null;
  const sportKey = sport && sport !== "ALL" ? sport : null;
  if (sportKey) {
    picksCacheMap.delete(sportKey);
  } else {
    picksCacheMap.clear();
  }
  // Clear the player-props cache so the next generation re-fetches from the API.
  // Without this, a "no props yet" result cached at server start blocks the HR parlay
  // from populating even after books post their lines later in the day.
  clearPropsCache();
  // Clear picks for today
  await deletePicksFromDb(sportKey);
  // Also clear ladders — they are stored in a separate table and were NOT previously
  // cleared on refresh, causing the ladder to serve stale data even after picks changed.
  try {
    if (sportKey) {
      await db.delete(dailyLaddersTable)
        .where(and(eq(dailyLaddersTable.sport, sportKey), eq(dailyLaddersTable.date, todayEasternDate())));
      // Also clear "All Sports" ladder so it regenerates with fresh cross-sport data
      await db.delete(dailyLaddersTable)
        .where(and(eq(dailyLaddersTable.sport, "All Sports"), eq(dailyLaddersTable.date, todayEasternDate())));
    } else {
      await db.delete(dailyLaddersTable)
        .where(eq(dailyLaddersTable.date, todayEasternDate()));
    }
  } catch { /* ignore ladder clear errors */ }
  return res.json({ ok: true });
});

export default router;

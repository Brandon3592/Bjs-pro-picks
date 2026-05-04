import { logger } from "./logger";

const BASE_URL = "https://api.the-odds-api.com/v4";

export const SPORT_KEYS: Record<string, string> = {
  NFL: "americanfootball_nfl",
  NBA: "basketball_nba",
  MLB: "baseball_mlb",
  NHL: "icehockey_nhl",
};

export const SPORT_FROM_KEY: Record<string, string> = {
  americanfootball_nfl: "NFL",
  basketball_nba: "NBA",
  baseball_mlb: "MLB",
  icehockey_nhl: "NHL",
};

export const BOOKMAKER_DISPLAY: Record<string, string> = {
  draftkings: "DraftKings",
  fanduel: "FanDuel",
  betmgm: "BetMGM",
  caesars: "Caesars",
  pointsbetus: "PointsBet",
  williamhill_us: "William Hill",
  barstool: "Barstool",
  betrivers: "BetRivers",
  unibet_us: "Unibet",
  betonlineag: "BetOnline",
  mybookieag: "MyBookie",
  bovada: "Bovada",
};

const PREFERRED_BOOKMAKERS = [
  "draftkings", "fanduel", "betmgm", "caesars", "pointsbetus",
  "williamhill_us", "betrivers", "unibet_us",
];

export interface OddsOutcome {
  name: string;
  price: number;
  point?: number;
}

export interface OddsMarket {
  key: "h2h" | "spreads" | "totals";
  last_update: string;
  outcomes: OddsOutcome[];
}

export interface OddsBookmaker {
  key: string;
  title: string;
  last_update: string;
  markets: OddsMarket[];
}

export interface OddsEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsBookmaker[];
}

export interface ScoreEvent {
  id: string;
  sport_key: string;
  commence_time: string;
  completed: boolean;
  home_team: string;
  away_team: string;
  scores: { name: string; score: string }[] | null;
  last_update: string | null;
}

// In-memory cache
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCached<T>(key: string): T | null {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

export function getApiKey(): string | undefined {
  return process.env.ODDS_API_KEY || undefined;
}

export function hasApiKey(): boolean {
  return !!getApiKey();
}

async function fetchWithKey<T>(path: string, params: Record<string, string> = {}): Promise<T | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set("apiKey", apiKey);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const cacheKey = url.pathname + url.search;
  const cached = getCached<T>(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetch(url.toString());
    if (!res.ok) {
      logger.warn({ status: res.status, path }, "Odds API request failed");
      return null;
    }
    const data = (await res.json()) as T;
    setCache(cacheKey, data);
    const remaining = res.headers.get("x-requests-remaining");
    if (remaining) logger.info({ remaining }, "Odds API quota remaining");
    return data;
  } catch (err) {
    logger.error({ err, path }, "Odds API fetch error");
    return null;
  }
}

export async function fetchOddsForSport(sportKey: string): Promise<OddsEvent[] | null> {
  return fetchWithKey<OddsEvent[]>(`/sports/${sportKey}/odds`, {
    regions: "us",
    markets: "h2h,spreads,totals",
    oddsFormat: "american",
    bookmakers: PREFERRED_BOOKMAKERS.join(","),
  });
}

export async function fetchScoresForSport(sportKey: string): Promise<ScoreEvent[] | null> {
  return fetchWithKey<ScoreEvent[]>(`/sports/${sportKey}/scores`, {
    daysFrom: "3",
  });
}

export async function fetchAllSportOdds(): Promise<{ sport: string; events: OddsEvent[] }[]> {
  const results = await Promise.all(
    Object.entries(SPORT_KEYS).map(async ([sport, key]) => {
      const events = await fetchOddsForSport(key);
      return { sport, events: events ?? [] };
    })
  );
  return results;
}

// ─── Player props ─────────────────────────────────────────────────────────────

export interface PropOutcome {
  name: "Over" | "Under";
  description: string; // player name
  price: number;       // American odds
  point: number;       // line value (e.g. 25.5)
}

export interface PropMarket {
  key: string;
  last_update: string;
  outcomes: PropOutcome[];
}

export interface PropEvent {
  id: string;
  sport_key: string;
  home_team: string;
  away_team: string;
  commence_time: string;
  bookmakers: Array<{
    key: string;
    title: string;
    last_update: string;
    markets: PropMarket[];
  }>;
}

export const PROP_MARKETS: Record<string, { key: string; label: string }[]> = {
  NBA: [
    { key: "player_points", label: "Points" },
    { key: "player_rebounds", label: "Rebounds" },
    { key: "player_assists", label: "Assists" },
    { key: "player_threes", label: "3-Pointers" },
  ],
  MLB: [
    { key: "batter_hits", label: "Hits" },
    { key: "pitcher_strikeouts", label: "Strikeouts" },
    { key: "batter_home_runs", label: "Home Runs" },
  ],
  NHL: [
    { key: "player_goals", label: "Goals" },
    { key: "player_shots_on_goal", label: "Shots on Goal" },
    { key: "player_points", label: "Points" },
  ],
  NFL: [
    { key: "player_pass_yds", label: "Pass Yards" },
    { key: "player_rush_yds", label: "Rush Yards" },
    { key: "player_receiving_yds", label: "Rec Yards" },
    { key: "player_receptions", label: "Receptions" },
  ],
};

const PROPS_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes — props move slowly

export async function fetchPlayerPropsForEvent(
  sportKey: string,
  eventId: string,
  marketKeys: string[],
): Promise<PropEvent | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  const url = new URL(`${BASE_URL}/sports/${sportKey}/events/${eventId}/odds`);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("regions", "us");
  url.searchParams.set("markets", marketKeys.join(","));
  url.searchParams.set("oddsFormat", "american");

  const cacheKey = `props::${url.pathname}::${marketKeys.sort().join(",")}`;
  const cached = getCached<PropEvent>(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetch(url.toString());
    if (!res.ok) {
      logger.warn({ status: res.status, eventId }, "Props API request failed");
      return null;
    }
    const data = (await res.json()) as PropEvent;
    // Use longer TTL for props
    cache.set(cacheKey, { data, expiresAt: Date.now() + PROPS_CACHE_TTL_MS });
    const remaining = res.headers.get("x-requests-remaining");
    if (remaining) logger.info({ remaining }, "Odds API quota remaining");
    return data;
  } catch (err) {
    logger.error({ err, eventId }, "Props API fetch error");
    return null;
  }
}

export async function fetchAllSportScores(): Promise<{ sport: string; scores: ScoreEvent[] }[]> {
  const results = await Promise.all(
    Object.entries(SPORT_KEYS).map(async ([sport, key]) => {
      const scores = await fetchScoresForSport(key);
      return { sport, scores: scores ?? [] };
    })
  );
  return results;
}

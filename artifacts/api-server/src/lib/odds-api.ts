import { logger } from "./logger";

const BASE_URL = "https://api.the-odds-api.com/v4";

export const SPORT_KEYS: Record<string, string> = {
  NFL: "americanfootball_nfl",
  NBA: "basketball_nba",
  MLB: "baseball_mlb",
  NHL: "icehockey_nhl",
};

// Maps every supported Odds API sport key → the display label used in the tab UI.
// Soccer leagues all collapse into one "Soccer" tab; combat sports are separate.
export const SPORT_API_TO_LABEL: Record<string, string> = {
  // US Major Sports
  americanfootball_nfl:               "NFL",
  basketball_nba:                     "NBA",
  baseball_mlb:                       "MLB",
  icehockey_nhl:                      "NHL",
  // US College
  basketball_ncaab:                   "NCAAB",
  americanfootball_ncaaf:             "NCAAF",
  basketball_wnba:                    "WNBA",
  // Soccer — all leagues share one tab
  soccer_epl:                         "Soccer",
  soccer_spain_la_liga:               "Soccer",
  soccer_germany_bundesliga:          "Soccer",
  soccer_italy_serie_a:               "Soccer",
  soccer_france_ligue_one:            "Soccer",
  soccer_uefa_champs_league:          "Soccer",
  soccer_uefa_europa_league:          "Soccer",
  soccer_usa_mls:                     "Soccer",
  soccer_mexico_ligamx:               "Soccer",
  soccer_efl_champ:                   "Soccer",
  soccer_netherlands_eredivisie:      "Soccer",
  soccer_portugal_primeira_liga:      "Soccer",
  soccer_turkey_super_league:         "Soccer",
  soccer_brazil_campeonato:           "Soccer",
  soccer_argentina_primera_division:  "Soccer",
  soccer_belgium_first_div:           "Soccer",
  soccer_conmebol_copa_libertadores:  "Soccer",
  soccer_conmebol_copa_sudamericana:  "Soccer",
  // Combat
  mma_mixed_martial_arts:             "MMA",
  boxing_boxing:                      "Boxing",
};

// Reverse map: API key → display label (for legacy code that uses SPORT_FROM_KEY)
export const SPORT_FROM_KEY: Record<string, string> = { ...SPORT_API_TO_LABEL };

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
  key: string; // "h2h" | "spreads" | "totals" | "alternate_spreads" | "alternate_totals" | "team_totals" | "btts" | ...
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
  return (process.env.THE_ODDS_KEY || process.env.ODDS_API_KEY)?.trim() || undefined;
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

// Fetch the Odds API sport catalog to find which sport keys are currently active
// (have events in the near future). Result is cached like any other API call.
// Exported so picks route can build sport tabs from the catalog (low-quota call).
export async function fetchActiveSportApiKeys(): Promise<Set<string>> {
  interface SportInfo { key: string; active: boolean; }
  const sports = await fetchWithKey<SportInfo[]>("/sports");
  if (!sports) return new Set(Object.keys(SPORT_API_TO_LABEL)); // fallback: try all
  return new Set(sports.filter((s) => s.active).map((s) => s.key));
}

export async function fetchAllSportOdds(): Promise<{ sport: string; events: OddsEvent[] }[]> {
  // Step 1: find which sports are active (1 API call, cached 5 min)
  const activeApiKeys = await fetchActiveSportApiKeys();

  // Step 2: fetch odds only for sports in our supported list that are active
  const toFetch = Object.keys(SPORT_API_TO_LABEL).filter((k) => activeApiKeys.has(k));
  const results = await Promise.all(
    toFetch.map(async (apiKey) => ({
      label: SPORT_API_TO_LABEL[apiKey] as string,
      events: (await fetchOddsForSport(apiKey)) ?? [],
    })),
  );

  // Step 3: group by display label (multiple soccer leagues → one "Soccer" entry)
  const grouped = new Map<string, OddsEvent[]>();
  for (const { label, events } of results) {
    if (!events.length) continue;
    const existing = grouped.get(label) ?? [];
    grouped.set(label, [...existing, ...events]);
  }

  return [...grouped.entries()].map(([sport, events]) => ({ sport, events }));
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

// ─── Sport catalog ────────────────────────────────────────────────────────────

export interface SportCatalogEntry {
  key: string;
  title: string;
  group: "US Sports" | "Soccer" | "Combat" | "More";
  markets: string; // comma-separated Odds API market keys
}

export const SPORT_CATALOG: SportCatalogEntry[] = [
  // US Sports
  { key: "americanfootball_nfl",   title: "NFL",      group: "US Sports", markets: "h2h,spreads,totals" },
  { key: "americanfootball_ncaaf", title: "NCAAF",    group: "US Sports", markets: "h2h,spreads,totals" },
  { key: "americanfootball_ufl",   title: "UFL",      group: "US Sports", markets: "h2h,spreads,totals" },
  { key: "basketball_nba",         title: "NBA",      group: "US Sports", markets: "h2h,spreads,totals" },
  { key: "basketball_wnba",        title: "WNBA",     group: "US Sports", markets: "h2h,spreads,totals" },
  { key: "baseball_mlb",           title: "MLB",      group: "US Sports", markets: "h2h,spreads,totals" },
  { key: "icehockey_nhl",          title: "NHL",      group: "US Sports", markets: "h2h,spreads,totals" },
  { key: "icehockey_ahl",          title: "AHL",      group: "US Sports", markets: "h2h,spreads,totals" },
  // Soccer
  { key: "soccer_epl",                           title: "EPL",               group: "Soccer", markets: "h2h,spreads,totals" },
  { key: "soccer_spain_la_liga",                 title: "La Liga",           group: "Soccer", markets: "h2h,spreads,totals" },
  { key: "soccer_germany_bundesliga",            title: "Bundesliga",        group: "Soccer", markets: "h2h,spreads,totals" },
  { key: "soccer_italy_serie_a",                 title: "Serie A",           group: "Soccer", markets: "h2h,spreads,totals" },
  { key: "soccer_france_ligue_one",              title: "Ligue 1",           group: "Soccer", markets: "h2h,spreads,totals" },
  { key: "soccer_uefa_champs_league",            title: "Champions League",  group: "Soccer", markets: "h2h,spreads,totals" },
  { key: "soccer_uefa_europa_league",            title: "Europa League",     group: "Soccer", markets: "h2h,spreads,totals" },
  { key: "soccer_usa_mls",                       title: "MLS",               group: "Soccer", markets: "h2h,spreads,totals" },
  { key: "soccer_mexico_ligamx",                 title: "Liga MX",           group: "Soccer", markets: "h2h,spreads,totals" },
  { key: "soccer_efl_champ",                     title: "Championship",      group: "Soccer", markets: "h2h,spreads,totals" },
  { key: "soccer_netherlands_eredivisie",        title: "Eredivisie",        group: "Soccer", markets: "h2h,spreads,totals" },
  { key: "soccer_portugal_primeira_liga",        title: "Primeira Liga",     group: "Soccer", markets: "h2h,spreads,totals" },
  { key: "soccer_turkey_super_league",           title: "Süper Lig",         group: "Soccer", markets: "h2h,spreads,totals" },
  { key: "soccer_brazil_campeonato",             title: "Brazil Série A",    group: "Soccer", markets: "h2h,spreads,totals" },
  { key: "soccer_argentina_primera_division",    title: "Argentina Primera", group: "Soccer", markets: "h2h,spreads,totals" },
  { key: "soccer_belgium_first_div",             title: "Belgium First",     group: "Soccer", markets: "h2h,spreads,totals" },
  { key: "soccer_conmebol_copa_libertadores",    title: "Copa Libertadores", group: "Soccer", markets: "h2h,spreads,totals" },
  { key: "soccer_conmebol_copa_sudamericana",    title: "Copa Sudamericana", group: "Soccer", markets: "h2h,spreads,totals" },
  // Combat
  { key: "mma_mixed_martial_arts", title: "MMA",    group: "Combat", markets: "h2h" },
  { key: "boxing_boxing",          title: "Boxing", group: "Combat", markets: "h2h" },
  // More
  { key: "tennis_atp_italian_open",  title: "ATP Italian Open", group: "More", markets: "h2h" },
  { key: "tennis_wta_italian_open",  title: "WTA Italian Open", group: "More", markets: "h2h" },
  { key: "aussierules_afl",          title: "AFL",              group: "More", markets: "h2h,spreads,totals" },
  { key: "basketball_euroleague",    title: "EuroLeague",       group: "More", markets: "h2h,spreads,totals" },
  { key: "rugbyleague_nrl",          title: "NRL",              group: "More", markets: "h2h,spreads,totals" },
  { key: "cricket_ipl",              title: "IPL",              group: "More", markets: "h2h" },
  { key: "baseball_kbo",             title: "KBO",              group: "More", markets: "h2h,spreads,totals" },
];

// ─── Player props ─────────────────────────────────────────────────────────────

export const PROP_MARKETS: Record<string, { key: string; label: string; alt?: boolean }[]> = {
  NBA: [
    { key: "player_points", label: "Points" },
    { key: "player_rebounds", label: "Rebounds" },
    { key: "player_assists", label: "Assists" },
    { key: "player_threes", label: "3-Pointers" },
    { key: "player_blocks", label: "Blocks" },
    { key: "player_steals", label: "Steals" },
    { key: "player_turnovers", label: "Turnovers" },
    { key: "player_double_double", label: "Double-Double" },
    { key: "player_triple_double", label: "Triple-Double" },
    { key: "player_first_basket", label: "First Basket" },
    { key: "player_points_alternate", label: "Alt Points", alt: true },
    { key: "player_rebounds_alternate", label: "Alt Rebounds", alt: true },
    { key: "player_assists_alternate", label: "Alt Assists", alt: true },
    { key: "player_threes_alternate", label: "Alt 3-Pointers", alt: true },
    { key: "player_blocks_alternate", label: "Alt Blocks", alt: true },
    { key: "player_steals_alternate", label: "Alt Steals", alt: true },
  ],
  MLB: [
    { key: "batter_hits", label: "Hits" },
    { key: "pitcher_strikeouts", label: "Strikeouts" },
    { key: "batter_home_runs", label: "Home Runs" },
    { key: "batter_rbis", label: "RBIs" },
    { key: "batter_runs_scored", label: "Runs Scored" },
    { key: "batter_total_bases", label: "Total Bases" },
    { key: "pitcher_hits_allowed", label: "Hits Allowed" },
    { key: "pitcher_walks", label: "Walks Allowed" },
    { key: "batter_hits_alternate", label: "Alt Hits", alt: true },
    { key: "pitcher_strikeouts_alternate", label: "Alt Strikeouts", alt: true },
    { key: "batter_home_runs_alternate", label: "Alt Home Runs", alt: true },
    { key: "batter_total_bases_alternate", label: "Alt Total Bases", alt: true },
  ],
  NHL: [
    { key: "player_goals", label: "Goals" },
    { key: "player_shots_on_goal", label: "Shots on Goal" },
    { key: "player_points", label: "Points" },
    { key: "player_assists", label: "Assists" },
    { key: "player_goals_alternate", label: "Alt Goals", alt: true },
    { key: "player_shots_on_goal_alternate", label: "Alt Shots", alt: true },
    { key: "player_points_alternate", label: "Alt Points", alt: true },
  ],
  NFL: [
    { key: "player_pass_yds", label: "Pass Yards" },
    { key: "player_rush_yds", label: "Rush Yards" },
    { key: "player_receiving_yds", label: "Rec Yards" },
    { key: "player_receptions", label: "Receptions" },
    { key: "player_pass_tds", label: "Pass TDs" },
    { key: "player_rush_tds", label: "Rush TDs" },
    { key: "player_anytime_td", label: "Anytime TD" },
    { key: "player_1st_td", label: "First TD" },
    { key: "player_pass_attempts", label: "Pass Attempts" },
    { key: "player_rush_attempts", label: "Rush Attempts" },
    { key: "player_kicking_points", label: "Kicking Points" },
    { key: "player_pass_yds_alternate", label: "Alt Pass Yds", alt: true },
    { key: "player_rush_yds_alternate", label: "Alt Rush Yds", alt: true },
    { key: "player_receiving_yds_alternate", label: "Alt Rec Yds", alt: true },
    { key: "player_receptions_alternate", label: "Alt Receptions", alt: true },
  ],
};

const PROPS_CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours — props move slowly; conserves quota

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

const ALL_MARKETS_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export async function fetchOddsForSportAllMarkets(
  sportKey: string,
  markets: string,
): Promise<OddsEvent[] | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  const url = new URL(`${BASE_URL}/sports/${sportKey}/odds`);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("regions", "us");
  url.searchParams.set("markets", markets);
  url.searchParams.set("oddsFormat", "american");
  // No bookmakers filter — include ALL sportsbooks

  const cacheKey = `all-markets::${url.pathname}::${markets}`;
  const cached = getCached<OddsEvent[]>(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetch(url.toString());
    if (!res.ok) {
      logger.warn({ status: res.status, sportKey }, "All-markets API request failed");
      return null;
    }
    const data = (await res.json()) as OddsEvent[];
    cache.set(cacheKey, { data, expiresAt: Date.now() + ALL_MARKETS_CACHE_TTL_MS });
    const remaining = res.headers.get("x-requests-remaining");
    if (remaining) logger.info({ remaining, sportKey }, "Odds API quota (all-markets)");
    return data;
  } catch (err) {
    logger.error({ err, sportKey }, "All-markets fetch error");
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

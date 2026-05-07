/**
 * elo-model.ts — Proprietary Elo-based win probability model.
 *
 * Data sources (all free, no API key):
 *   - ESPN standings API  → current season wins/losses/home/road records
 *   - MLB Stats API       → starting pitcher ERA
 *
 * Ratings are initialised from current-season win%:
 *   rating = 1500 + (winPct − 0.5) × 500
 *
 * Home form bonus: teams that win at home significantly more than their
 * overall rate get a bonus when playing at home (and a penalty when away).
 *
 * Home-field advantage added on top:
 *   NBA +65, MLB +45, NHL +50, NFL +65 (in Elo points)
 *
 * Win probability: 1 / (1 + 10^((opponentRating − teamRating) / 400))
 */

import { logger } from "./logger";

// ─── Constants ────────────────────────────────────────────────────────────────

const ELO_BASE  = 1500;
const ELO_SCALE = 500; // win% deviation → Elo delta (0.20 wp diff = 100 pts)

const HOME_ADV: Record<string, number> = {
  NBA: 65,
  MLB: 45,
  NHL: 50,
  NFL: 65,
};

const MLB_LEAGUE_AVG_ERA = 4.10;
const MLB_ERA_TO_ELO     = 30; // 1-run ERA diff ≈ 30 Elo pts

const ESPN_STANDINGS_BASE = "https://site.api.espn.com/apis/v2/sports";
const MLB_API             = "https://statsapi.mlb.com/api/v1";
const CACHE_TTL_MS        = 10 * 60 * 1000; // 10 min

// ─── ESPN sport path map ──────────────────────────────────────────────────────

const ESPN_SPORT_PATH: Record<string, string> = {
  NBA: "basketball/nba",
  MLB: "baseball/mlb",
  NHL: "hockey/nhl",
  NFL: "football/nfl",
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface EloRating {
  total: number;
  winPct: number;
  wins: number;
  losses: number;
}

export interface EloLookupResult {
  modelProb: number;
  homeAdv: number;
  homeRating: number;
  awayRating: number;
  pitcherAdjElo: number;
  homePitcher?: PitcherInfo;
  awayPitcher?: PitcherInfo;
  confidence: "high" | "medium" | "low";
  reasoning: string;
}

interface PitcherInfo {
  name: string;
  era: number;
}

// ─── Cache ────────────────────────────────────────────────────────────────────

const ratingCaches = new Map<string, { ratings: Map<string, EloRating>; expiresAt: number }>();

interface PitcherCache {
  data: Map<string, PitcherInfo>;
  expiresAt: number;
}
let pitcherCache: PitcherCache | null = null;

// ─── Name normalisation ───────────────────────────────────────────────────────

const NAME_OVERRIDES: Record<string, string> = {
  "athletics":            "oakland athletics",
  "la clippers":          "los angeles clippers",
};

function normName(name: string): string {
  const lower = name.toLowerCase().trim();
  return NAME_OVERRIDES[lower] ?? lower;
}

function getStat(stats: { name: string; value: number }[], statName: string): number {
  return stats.find((s) => s.name === statName)?.value ?? 0;
}

// ─── ESPN standings fetcher ───────────────────────────────────────────────────

async function fetchEspnStandings(sport: string): Promise<Map<string, EloRating>> {
  const cached = ratingCaches.get(sport);
  if (cached && Date.now() < cached.expiresAt) return cached.ratings;

  const path = ESPN_SPORT_PATH[sport];
  if (!path) return new Map();

  try {
    const url = `${ESPN_STANDINGS_BASE}/${path}/standings`;
    const res = await fetch(url, { signal: AbortSignal.timeout(7000) });
    if (!res.ok) throw new Error(`ESPN standings ${sport} returned ${res.status}`);

    const data = await res.json() as {
      children?: {
        standings?: {
          entries?: {
            team?: { displayName?: string; abbreviation?: string };
            stats?: { name: string; value: number }[];
          }[];
        };
      }[];
    };

    const ratings = new Map<string, EloRating>();

    const allEntries = (data.children ?? []).flatMap(
      (child) => child.standings?.entries ?? [],
    );

    for (const entry of allEntries) {
      const displayName = entry.team?.displayName;
      const abbrev      = entry.team?.abbreviation;
      const stats       = (entry.stats ?? []).filter((s): s is { name: string; value: number } =>
        typeof s.value === "number",
      );

      if (!displayName) continue;

      const wins    = getStat(stats, "wins");
      const losses  = getStat(stats, "losses");
      const total   = wins + losses;
      if (total === 0) continue;

      const winPct    = wins / total;
      const baseRating = ELO_BASE + (winPct - 0.5) * ELO_SCALE;

      // Home form bonus (available for MLB and NBA; NHL standings don't include home/road)
      const homeWins   = getStat(stats, "homeWins");
      const homeLosses = getStat(stats, "homeLosses");
      const homeTotal  = homeWins + homeLosses;
      const homeWinPct = homeTotal > 0 ? homeWins / homeTotal : winPct;
      // Bonus: how much better the team is at home vs overall (capped at ±40 pts)
      const formBonus  = homeTotal > 5
        ? Math.max(-40, Math.min(40, (homeWinPct - winPct) * ELO_SCALE * 0.5))
        : 0;

      const rating: EloRating = {
        total: Math.round(baseRating + formBonus),
        winPct,
        wins,
        losses,
      };

      ratings.set(normName(displayName), rating);
      if (abbrev) ratings.set(abbrev.toLowerCase(), rating);
    }

    ratingCaches.set(sport, { ratings, expiresAt: Date.now() + CACHE_TTL_MS });
    logger.info({ sport, teams: Math.floor(ratings.size / 2) }, "Elo ratings built from ESPN standings");
    return ratings;

  } catch (err) {
    logger.warn({ err, sport }, "ESPN standings fetch failed — Elo model degraded");
    return ratingCaches.get(sport)?.ratings ?? new Map();
  }
}

// ─── MLB probable pitcher ERA ─────────────────────────────────────────────────

async function fetchMlbProbablePitchers(): Promise<Map<string, PitcherInfo>> {
  if (pitcherCache && Date.now() < pitcherCache.expiresAt) return pitcherCache.data;

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const url   = `${MLB_API}/schedule?sportId=1&date=${today}&hydrate=probablePitcher(note)`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`MLB schedule API returned ${res.status}`);

    const json = await res.json() as {
      dates?: {
        games?: {
          teams?: {
            home?: { team?: { name?: string }; probablePitcher?: { fullName?: string; id?: number } };
            away?: { team?: { name?: string }; probablePitcher?: { fullName?: string; id?: number } };
          };
        }[];
      }[];
    };

    const pitchers = new Map<string, PitcherInfo>();
    const fetchJobs: { teamName: string; pitcherId: number; pitcherName: string }[] = [];

    for (const game of json.dates?.[0]?.games ?? []) {
      for (const side of ["home", "away"] as const) {
        const teamName   = game.teams?.[side]?.team?.name;
        const pitcher    = game.teams?.[side]?.probablePitcher;
        if (teamName && pitcher?.id) {
          fetchJobs.push({ teamName, pitcherId: pitcher.id, pitcherName: pitcher.fullName ?? "TBD" });
          pitchers.set(normName(teamName), { name: pitcher.fullName ?? "TBD", era: MLB_LEAGUE_AVG_ERA });
        }
      }
    }

    await Promise.all(
      fetchJobs.map(async ({ teamName, pitcherId, pitcherName }) => {
        try {
          const r = await fetch(
            `${MLB_API}/people/${pitcherId}/stats?stats=season&group=pitching`,
            { signal: AbortSignal.timeout(4000) },
          );
          if (!r.ok) return;
          const sj = await r.json() as { stats?: { splits?: { stat?: { era?: string } }[] }[] };
          const eraStr = sj.stats?.[0]?.splits?.[0]?.stat?.era;
          const era    = eraStr ? parseFloat(eraStr) : MLB_LEAGUE_AVG_ERA;
          if (!isNaN(era)) {
            pitchers.set(normName(teamName), { name: pitcherName, era });
          }
        } catch { /* keep league-avg ERA */ }
      }),
    );

    pitcherCache = { data: pitchers, expiresAt: Date.now() + 20 * 60 * 1000 };
    logger.info({ count: pitchers.size }, "MLB probable pitchers + ERA loaded for Elo model");
    return pitchers;

  } catch (err) {
    logger.warn({ err }, "MLB pitcher fetch failed — defaulting to league-avg ERA");
    return pitcherCache?.data ?? new Map();
  }
}

// ─── Sport code normaliser ────────────────────────────────────────────────────

function toSportCode(sport: string): string {
  const s = sport.toUpperCase();
  if (s.includes("NBA") || s === "BASKETBALL_NBA") return "NBA";
  if (s.includes("MLB") || s.includes("BASEBALL"))  return "MLB";
  if (s.includes("NHL") || s.includes("HOCKEY"))    return "NHL";
  if (s.includes("NFL") || s.includes("FOOTBALL"))  return "NFL";
  return s;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Pre-warm the ESPN standings cache for the active sports.
 * Call this in parallel with other data fetches at the start of each request.
 */
export async function warmEloCache(sports: string[]): Promise<void> {
  const codes = [...new Set(sports.map(toSportCode))];
  await Promise.all([
    ...codes.map((s) => fetchEspnStandings(s)),
    fetchMlbProbablePitchers(),
  ]);
  logger.info({ sports: codes }, "Elo cache warmed");
}

/**
 * Compute win probability for `pickedTeam` in a game between homeTeam and awayTeam.
 * Returns null if neither team is found in the standings (e.g. pre-season).
 */
export async function getEloWinProb(
  homeTeam: string,
  awayTeam: string,
  sport: string,
  pickedTeam: string,
): Promise<EloLookupResult | null> {
  const sportCode  = toSportCode(sport);
  const ratings    = await fetchEspnStandings(sportCode);

  const homeEntry  = ratings.get(normName(homeTeam));
  const awayEntry  = ratings.get(normName(awayTeam));

  if (!homeEntry && !awayEntry) return null;

  const homeRating = homeEntry?.total ?? ELO_BASE;
  const awayRating = awayEntry?.total ?? ELO_BASE;
  const homeAdv    = HOME_ADV[sportCode] ?? 50;

  let pitcherAdjElo = 0;
  let homePitcher: PitcherInfo | undefined;
  let awayPitcher: PitcherInfo | undefined;

  if (sportCode === "MLB") {
    const pitchers  = await fetchMlbProbablePitchers();
    homePitcher     = pitchers.get(normName(homeTeam));
    awayPitcher     = pitchers.get(normName(awayTeam));
    const homeEra   = homePitcher?.era ?? MLB_LEAGUE_AVG_ERA;
    const awayEra   = awayPitcher?.era ?? MLB_LEAGUE_AVG_ERA;
    pitcherAdjElo   = Math.max(-90, Math.min(90, Math.round((awayEra - homeEra) * MLB_ERA_TO_ELO)));
  }

  const adjustedHome = homeRating + homeAdv + pitcherAdjElo;
  const homeWinProb  = 1 / (1 + Math.pow(10, (awayRating - adjustedHome) / 400));
  const awayWinProb  = 1 - homeWinProb;

  // Determine which side is picked — fuzzy match to handle minor name differences
  const pickedNorm = normName(pickedTeam);
  const homeNorm   = normName(homeTeam);
  const awayNorm   = normName(awayTeam);
  const isHomePick = pickedNorm === homeNorm
    || pickedNorm.includes(homeNorm)
    || homeNorm.includes(pickedNorm);
  const modelProb  = isHomePick ? homeWinProb : awayWinProb;

  const confidence: "high" | "medium" | "low" =
    homeEntry && awayEntry ? "high" : "medium";

  // ── Reasoning text ──────────────────────────────────────────────────────
  const parts: string[] = [];

  if (homeEntry && awayEntry) {
    const homeRecord = `${homeEntry.wins}-${homeEntry.losses}`;
    const awayRecord = `${awayEntry.wins}-${awayEntry.losses}`;
    parts.push(
      `${homeTeam} (${homeRecord}, ${homeEntry.total} Elo) hosts ${awayTeam} (${awayRecord}, ${awayEntry.total} Elo).` +
      ` Model win probability: ${(homeWinProb * 100).toFixed(1)}% home / ${(awayWinProb * 100).toFixed(1)}% away.`,
    );
  } else if (homeEntry) {
    parts.push(`${homeTeam} (${homeEntry.wins}-${homeEntry.losses}) — ${awayTeam} record unavailable.`);
  } else {
    parts.push(`${awayTeam} (${awayEntry!.wins}-${awayEntry!.losses}) — ${homeTeam} record unavailable.`);
  }

  if (sportCode === "MLB" && (homePitcher || awayPitcher)) {
    const hp = homePitcher ? `${homePitcher.name} (${homePitcher.era.toFixed(2)} ERA)` : "TBD";
    const ap = awayPitcher ? `${awayPitcher.name} (${awayPitcher.era.toFixed(2)} ERA)` : "TBD";
    parts.push(`Pitching: ${hp} vs ${ap}.`);
    if (pitcherAdjElo !== 0) {
      parts.push(
        `${Math.abs(pitcherAdjElo)}-pt Elo ${pitcherAdjElo > 0 ? "home" : "away"} pitcher edge.`,
      );
    }
  }

  return {
    modelProb,
    homeAdv,
    homeRating,
    awayRating,
    pitcherAdjElo,
    homePitcher,
    awayPitcher,
    confidence,
    reasoning: parts.join(" "),
  };
}

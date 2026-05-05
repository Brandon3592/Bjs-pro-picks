import { logger } from "./logger";

const MLB_API = "https://statsapi.mlb.com/api/v1";
const CACHE_TTL_MS = 20 * 60 * 1000; // 20 minutes

let cache: { players: Set<string>; expiresAt: number } | null = null;

function todayEastern(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

export async function fetchMlbLineupNames(): Promise<Set<string> | null> {
  if (cache && Date.now() < cache.expiresAt) return cache.players;

  const date = todayEastern();
  const url = `${MLB_API}/schedule?sportId=1&date=${date}&hydrate=lineups`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      logger.warn({ status: res.status }, "MLB lineups API request failed");
      return cache?.players ?? null;
    }

    const data = (await res.json()) as {
      dates?: {
        games?: {
          lineups?: {
            homePlayers?: { fullName: string }[];
            awayPlayers?: { fullName: string }[];
          };
        }[];
      }[];
    };

    const players = new Set<string>();
    for (const game of data.dates?.[0]?.games ?? []) {
      for (const p of game.lineups?.homePlayers ?? []) players.add(p.fullName);
      for (const p of game.lineups?.awayPlayers ?? []) players.add(p.fullName);
    }

    if (players.size > 0) {
      cache = { players, expiresAt: Date.now() + CACHE_TTL_MS };
      logger.info({ count: players.size, date }, "MLB lineups fetched");
    } else {
      logger.info({ date }, "MLB lineups not yet posted");
    }

    return players.size > 0 ? players : null;
  } catch (err) {
    logger.error({ err }, "MLB lineups fetch error");
    return cache?.players ?? null;
  }
}

import { logger } from "./logger";

const ESPN = "https://site.api.espn.com/apis/site/v2/sports";
const CACHE_TTL_MS = 20 * 60 * 1000; // 20 minutes

type InjuryCache = { players: Set<string>; expiresAt: number };

const nbaCache: { out: InjuryCache | null } = { out: null };
const nhlCache: { out: InjuryCache | null } = { out: null };

async function fetchEspnOut(sport: string, league: string, cache: { out: InjuryCache | null }): Promise<Set<string> | null> {
  if (cache.out && Date.now() < cache.out.expiresAt) return cache.out.players;

  const url = `${ESPN}/${sport}/${league}/injuries`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      logger.warn({ status: res.status, league }, "ESPN injuries API failed");
      return cache.out?.players ?? null;
    }
    const data = (await res.json()) as {
      injuries?: { injuries?: { status?: string; athlete?: { displayName?: string } }[] }[];
    };

    const out = new Set<string>();
    for (const team of data.injuries ?? []) {
      for (const inj of team.injuries ?? []) {
        if (inj.status === "Out" && inj.athlete?.displayName) {
          out.add(inj.athlete.displayName);
        }
      }
    }

    cache.out = { players: out, expiresAt: Date.now() + CACHE_TTL_MS };
    logger.info({ count: out.size, league }, "ESPN OUT players fetched");
    return out;
  } catch (err) {
    logger.error({ err, league }, "ESPN injuries fetch error");
    return cache.out?.players ?? null;
  }
}

export function fetchNbaOut(): Promise<Set<string> | null> {
  return fetchEspnOut("basketball", "nba", nbaCache);
}

export function fetchNhlOut(): Promise<Set<string> | null> {
  return fetchEspnOut("hockey", "nhl", nhlCache);
}

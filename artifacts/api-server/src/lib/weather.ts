import { logger } from "./logger";

interface WeatherResult {
  temp: number;
  windSpeed: number;
  condition: string;
  precipitation: number;
}

// WMO weather code to human-readable condition
function codeToCondition(code: number): string {
  if (code === 0) return "Clear";
  if (code <= 3) return "Partly Cloudy";
  if (code <= 48) return "Foggy";
  if (code <= 57) return "Drizzle";
  if (code <= 67) return "Rainy";
  if (code <= 77) return "Snowy";
  if (code <= 82) return "Showers";
  if (code <= 99) return "Thunderstorms";
  return "Cloudy";
}

// Outdoor stadium coordinates (lat, lng) — indoor venues return null
const STADIUM_COORDS: Record<string, { lat: number; lng: number }> = {
  // NFL
  "Kansas City Chiefs": { lat: 39.0489, lng: -94.4839 },
  "Baltimore Ravens": { lat: 39.2780, lng: -76.6227 },
  "Dallas Cowboys": { lat: 32.7473, lng: -97.0945 },
  "Philadelphia Eagles": { lat: 39.9008, lng: -75.1675 },
  "San Francisco 49ers": { lat: 37.4033, lng: -121.9697 },
  "Seattle Seahawks": { lat: 47.5952, lng: -122.3316 },
  "Green Bay Packers": { lat: 44.5013, lng: -88.0622 },
  "Chicago Bears": { lat: 41.8623, lng: -87.6167 },
  "New England Patriots": { lat: 42.0909, lng: -71.2643 },
  "New York Giants": { lat: 40.8128, lng: -74.0742 },
  "New York Jets": { lat: 40.8128, lng: -74.0742 },
  "Buffalo Bills": { lat: 42.7738, lng: -78.7870 },
  "Pittsburgh Steelers": { lat: 40.4468, lng: -80.0158 },
  "Cleveland Browns": { lat: 41.5061, lng: -81.6995 },
  "Cincinnati Bengals": { lat: 39.0954, lng: -84.5160 },
  "Tennessee Titans": { lat: 36.1665, lng: -86.7713 },
  "Jacksonville Jaguars": { lat: 30.3239, lng: -81.6373 },
  "Miami Dolphins": { lat: 25.9580, lng: -80.2389 },
  "Tampa Bay Buccaneers": { lat: 27.9760, lng: -82.5033 },
  "Carolina Panthers": { lat: 35.2258, lng: -80.8528 },
  "Atlanta Falcons": { lat: 33.7554, lng: -84.4009 },
  "New Orleans Saints": { lat: 29.9511, lng: -90.0812 },
  "Washington Commanders": { lat: 38.9079, lng: -76.8645 },
  "Denver Broncos": { lat: 39.7439, lng: -105.0201 },
  "Oakland Raiders": { lat: 36.0909, lng: -115.1838 },
  "Las Vegas Raiders": { lat: 36.0909, lng: -115.1838 },
  "Los Angeles Rams": { lat: 33.9535, lng: -118.3392 },
  "Los Angeles Chargers": { lat: 33.9535, lng: -118.3392 },
  "Arizona Cardinals": { lat: 33.5277, lng: -112.2626 },
  "Houston Texans": { lat: 29.6847, lng: -95.4107 },
  "Indianapolis Colts": { lat: 39.7601, lng: -86.1639 },
  "Detroit Lions": { lat: 42.3400, lng: -83.0456 },
  "Minnesota Vikings": { lat: 44.9736, lng: -93.2575 },
  // MLB — all outdoor
  "New York Yankees": { lat: 40.8296, lng: -73.9262 },
  "Boston Red Sox": { lat: 42.3467, lng: -71.0972 },
  "Chicago Cubs": { lat: 41.9484, lng: -87.6553 },
  "Chicago White Sox": { lat: 41.8300, lng: -87.6338 },
  "Los Angeles Dodgers": { lat: 34.0739, lng: -118.2400 },
  "San Francisco Giants": { lat: 37.7786, lng: -122.3893 },
  "Houston Astros": { lat: 29.7573, lng: -95.3555 },
  "Atlanta Braves": { lat: 33.8908, lng: -84.4677 },
  "Philadelphia Phillies": { lat: 39.9061, lng: -75.1665 },
  "New York Mets": { lat: 40.7571, lng: -73.8458 },
  "St. Louis Cardinals": { lat: 38.6226, lng: -90.1928 },
  "Milwaukee Brewers": { lat: 43.0280, lng: -87.9712 },
  "Cincinnati Reds": { lat: 39.0975, lng: -84.5082 },
  "Pittsburgh Pirates": { lat: 40.4468, lng: -80.0057 },
  "Colorado Rockies": { lat: 39.7559, lng: -104.9942 },
  "Arizona Diamondbacks": { lat: 33.4453, lng: -112.0667 },
  "San Diego Padres": { lat: 32.7073, lng: -117.1566 },
  "Oakland Athletics": { lat: 37.7516, lng: -122.2005 },
  "Seattle Mariners": { lat: 47.5914, lng: -122.3325 },
  "Texas Rangers": { lat: 32.7473, lng: -97.0842 },
  "Kansas City Royals": { lat: 39.0517, lng: -94.4803 },
  "Cleveland Guardians": { lat: 41.4962, lng: -81.6852 },
  "Detroit Tigers": { lat: 42.3390, lng: -83.0487 },
  "Minnesota Twins": { lat: 44.9817, lng: -93.2781 },
  "Baltimore Orioles": { lat: 39.2839, lng: -76.6216 },
  "Toronto Blue Jays": { lat: 43.6414, lng: -79.3894 },
  "Tampa Bay Rays": { lat: 27.7683, lng: -82.6534 },
  "Miami Marlins": { lat: 25.7781, lng: -80.2197 },
  "Washington Nationals": { lat: 38.8730, lng: -77.0074 },
  "Los Angeles Angels": { lat: 33.8003, lng: -117.8827 },
};

// Indoor venues that don't need weather (by team name fragments)
const INDOOR_KEYWORDS = [
  "Celtics", "Heat", "Knicks", "Bulls", "Nets", "Bucks",
  "Suns", "Nuggets", "Warriors", "Clippers", "Lakers",
  "Thunder", "Timberwolves", "Spurs", "Rockets",
  "76ers", "Pacers", "Pistons", "Cavaliers", "Wizards",
  "Magic", "Hornets", "Hawks", "Grizzlies", "Pelicans", "Trail Blazers",
  "Jazz", "Mavericks", "Kings", "Raptors", "Heat",
  // NHL (all indoor rinks)
  "Avalanche", "Lightning", "Bruins", "Rangers", "Penguins",
  "Capitals", "Blackhawks", "Red Wings", "Maple Leafs", "Canadiens",
  "Blues", "Oilers", "Flames", "Canucks", "Jets",
  "Stars", "Kings", "Ducks", "Sharks", "Coyotes",
  "Predators", "Panthers", "Hurricanes", "Blue Jackets", "Sabres",
  "Wild", "Senators", "Islanders", "Devils", "Kraken",
  // NFL indoor
  "Lions", "Vikings", "Falcons", "Saints", "Rams", "Chargers",
  "Colts", "Texans", "Cardinals", "Raiders",
];

function isIndoor(homeTeam: string): boolean {
  return INDOOR_KEYWORDS.some((kw) => homeTeam.includes(kw));
}

function findCoords(homeTeam: string): { lat: number; lng: number } | null {
  if (isIndoor(homeTeam)) return null;
  const exact = STADIUM_COORDS[homeTeam];
  if (exact) return exact;
  // fuzzy match
  for (const [key, coords] of Object.entries(STADIUM_COORDS)) {
    if (homeTeam.includes(key.split(" ").pop()!)) return coords;
  }
  return null;
}

const weatherCache = new Map<string, { result: WeatherResult; fetchedAt: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

export async function fetchWeather(homeTeam: string): Promise<WeatherResult | null> {
  const coords = findCoords(homeTeam);
  if (!coords) return null;

  const cacheKey = `${coords.lat},${coords.lng}`;
  const cached = weatherCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.result;

  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(coords.lat));
    url.searchParams.set("longitude", String(coords.lng));
    url.searchParams.set("current", "temperature_2m,wind_speed_10m,precipitation_probability,weathercode");
    url.searchParams.set("temperature_unit", "fahrenheit");
    url.searchParams.set("wind_speed_unit", "mph");
    url.searchParams.set("forecast_days", "1");

    const resp = await fetch(url.toString());
    if (!resp.ok) return null;
    const json = (await resp.json()) as {
      current: {
        temperature_2m: number;
        wind_speed_10m: number;
        precipitation_probability: number;
        weathercode: number;
      };
    };
    const c = json.current;
    const result: WeatherResult = {
      temp: Math.round(c.temperature_2m),
      windSpeed: Math.round(c.wind_speed_10m),
      condition: codeToCondition(c.weathercode),
      precipitation: c.precipitation_probability ?? 0,
    };
    weatherCache.set(cacheKey, { result, fetchedAt: Date.now() });
    return result;
  } catch (err) {
    logger.warn({ err }, "Failed to fetch weather from OpenMeteo");
    return null;
  }
}

import { useState } from "react";
import { useGetGames, getGetGamesQueryKey } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Wind, Thermometer, ChevronRight, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

const SPORTS = ["all", "NFL", "NBA", "MLB", "NHL"] as const;
const STATUSES = ["all", "live", "upcoming", "final"] as const;

function SportBadge({ sport }: { sport: string }) {
  const colors: Record<string, string> = {
    NFL: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    NBA: "bg-orange-500/10 text-orange-400 border-orange-500/20",
    MLB: "bg-red-500/10 text-red-400 border-red-500/20",
    NHL: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  };
  return (
    <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border", colors[sport] ?? "bg-muted text-muted-foreground border-border")}>
      {sport}
    </span>
  );
}

function EdgeBadge({ edge }: { edge: number }) {
  return (
    <span className={cn(
      "inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-bold border",
      edge >= 2 ? "edge-bg-high" : edge >= 1 ? "edge-bg-medium" : "edge-bg-low"
    )}>
      +{edge.toFixed(2)}% edge
    </span>
  );
}

export default function Games() {
  const [sport, setSport] = useState("all");
  const [status, setStatus] = useState("all");

  const params = {
    sport: sport as "NFL" | "NBA" | "MLB" | "NHL" | "all",
    status: status as "live" | "upcoming" | "final" | "all",
  };

  const games = useGetGames(params, {
    query: {
      refetchInterval: 60000,
      queryKey: getGetGamesQueryKey(params),
    },
  });

  return (
    <div className="p-4 md:p-6 space-y-4 pb-20 md:pb-6">
      <div>
        <h1 className="text-xl font-bold">Games</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Live and upcoming games across all sports</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {SPORTS.map((s) => (
            <button
              key={s}
              onClick={() => setSport(s)}
              data-testid={`filter-sport-${s}`}
              className={cn(
                "px-2.5 py-1 rounded text-xs font-medium border transition-colors",
                sport === s
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
              )}
            >
              {s === "all" ? "All Sports" : s}
            </button>
          ))}
        </div>
        <div className="w-px bg-border mx-1" />
        <div className="flex items-center gap-1.5 flex-wrap">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              data-testid={`filter-status-${s}`}
              className={cn(
                "px-2.5 py-1 rounded text-xs font-medium border transition-colors capitalize",
                status === s
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
              )}
            >
              {s === "all" ? "All" : s}
            </button>
          ))}
        </div>
      </div>

      {/* Game Cards */}
      {games.isLoading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[...Array(6)].map((_, i) => <div key={i} className="bg-card border border-card-border rounded-lg p-4 h-40 animate-pulse" />)}
        </div>
      ) : (games.data ?? []).length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">No games found for current filters.</div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {(games.data ?? []).map((game) => (
            <Link key={game.id} href={`/games/${game.id}`}>
              <div
                className="bg-card border border-card-border rounded-lg p-4 hover:border-primary/40 transition-colors cursor-pointer group"
                data-testid={`card-game-${game.id}`}
              >
                <div className="flex items-center justify-between mb-3">
                  <SportBadge sport={game.sport} />
                  <div className="flex items-center gap-2">
                    {game.status === "live" && (
                      <span className="flex items-center gap-1 text-[10px] font-bold text-red-400">
                        <Activity className="h-2.5 w-2.5 animate-pulse" />
                        LIVE
                      </span>
                    )}
                    {game.status === "final" && (
                      <span className="text-[10px] font-medium text-muted-foreground">FINAL</span>
                    )}
                    {game.status === "upcoming" && (
                      <span className="text-[10px] text-muted-foreground">
                        {format(new Date(game.startTime), "h:mm a")}
                      </span>
                    )}
                  </div>
                </div>

                {/* Teams & Score */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold truncate pr-2">{game.homeTeam}</span>
                    {game.homeScore !== null && game.homeScore !== undefined && (
                      <span className="text-lg font-bold font-mono">{game.homeScore}</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground truncate pr-2">{game.awayTeam}</span>
                    {game.awayScore !== null && game.awayScore !== undefined && (
                      <span className="text-lg font-mono text-muted-foreground">{game.awayScore}</span>
                    )}
                  </div>
                </div>

                {/* Live info */}
                {game.status === "live" && game.quarter && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    {game.quarter} {game.timeRemaining && `• ${game.timeRemaining}`}
                  </div>
                )}

                {/* Weather */}
                {game.weather && (
                  <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
                    <Thermometer className="h-2.5 w-2.5" />
                    <span>{game.weather.temp}°F</span>
                    <Wind className="h-2.5 w-2.5" />
                    <span>{game.weather.windSpeed} mph</span>
                    <span>{game.weather.condition}</span>
                  </div>
                )}

                {/* Edge + link */}
                <div className="mt-3 flex items-center justify-between">
                  {game.topEdge !== null && game.topEdge !== undefined ? (
                    <EdgeBadge edge={game.topEdge} />
                  ) : (
                    <span />
                  )}
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

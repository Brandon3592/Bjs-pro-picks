import { useGetDashboardSummary, getGetDashboardSummaryQueryKey, useGetLineMovements } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Activity, BarChart2, RefreshCw, ChevronRight, TrendingUp, TrendingDown, ArrowRight, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

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

function StatCard({ label, value, sub, icon: Icon, color }: { label: string; value: string | number; sub?: string; icon: React.ElementType; color: string }) {
  return (
    <div className="bg-card border border-card-border rounded-lg p-4 flex items-start gap-3">
      <div className={cn("h-8 w-8 rounded flex items-center justify-center flex-shrink-0", color)}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground font-medium">{label}</p>
        <p className="text-xl font-bold font-mono tabular-nums mt-0.5" data-testid={`stat-${label.toLowerCase().replace(/\s/g, "-")}`}>{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

const SPORT_COLORS: Record<string, string> = {
  NFL: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  NBA: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  MLB: "bg-red-500/10 text-red-400 border-red-500/20",
  NHL: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
};

function SteamMovesWidget() {
  const moves = useGetLineMovements({ hours: 3, limit: 8 }, { query: { refetchInterval: 60000 } });
  const data = moves.data ?? [];

  return (
    <div className="bg-card border border-card-border rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-3.5 w-3.5 text-primary" />
          <h2 className="text-sm font-semibold">Line Movements</h2>
          <span className="text-[10px] text-muted-foreground bg-muted border border-border px-1.5 py-0.5 rounded">last 3h</span>
        </div>
        <Link href="/games">
          <span className="text-xs text-primary hover:underline flex items-center gap-1 cursor-pointer">
            All games <ChevronRight className="h-3 w-3" />
          </span>
        </Link>
      </div>

      {moves.isLoading ? (
        <div className="p-4 space-y-2">
          {[...Array(4)].map((_, i) => <div key={i} className="h-10 bg-muted rounded animate-pulse" />)}
        </div>
      ) : data.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <p className="text-sm text-muted-foreground">No significant line moves detected yet.</p>
          <p className="text-xs text-muted-foreground mt-1">Lines are tracked every 5 minutes. Check back soon.</p>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {data.map((mv, i) => {
            const isSteam = mv.direction === "steam";
            const isReverse = mv.direction === "reverse";
            return (
              <div key={i} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/20 transition-colors" data-testid={`row-move-${i}`}>
                <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border flex-shrink-0", SPORT_COLORS[mv.sport] ?? "bg-muted text-muted-foreground border-border")}>
                  {mv.sport}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium truncate">{mv.outcomeName}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{mv.homeTeam} vs {mv.awayTeam} · {mv.bookmaker}</div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-xs font-mono text-muted-foreground">{mv.oldPrice > 0 ? `+${mv.oldPrice}` : mv.oldPrice}</span>
                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                  <span className={cn("text-xs font-mono font-bold", isSteam ? "text-emerald-400" : isReverse ? "text-amber-400" : "text-muted-foreground")}>
                    {mv.newPrice > 0 ? `+${mv.newPrice}` : mv.newPrice}
                  </span>
                  {isSteam && <TrendingUp className="h-3 w-3 text-emerald-400" />}
                  {isReverse && <TrendingDown className="h-3 w-3 text-amber-400" />}
                  <span className={cn("text-[10px] font-mono px-1.5 py-0.5 rounded border", isSteam ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : isReverse ? "bg-amber-500/10 text-amber-400 border-amber-500/20" : "bg-muted text-muted-foreground border-border")}>
                    {mv.magnitude.toFixed(1)}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const qc = useQueryClient();
  const summary = useGetDashboardSummary({ query: { refetchInterval: 60000, queryKey: getGetDashboardSummaryQueryKey() } });

  const data = summary.data;
  const lastRefreshed = data?.lastRefreshed ? formatDistanceToNow(new Date(data.lastRefreshed), { addSuffix: true }) : null;

  return (
    <div className="p-4 md:p-6 space-y-6 pb-20 md:pb-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Dashboard</h1>
          {lastRefreshed && <p className="text-xs text-muted-foreground mt-0.5">Refreshed {lastRefreshed}</p>}
        </div>
        <button
          onClick={() => qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() })}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          data-testid="button-refresh"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", summary.isFetching && "animate-spin")} />
          Refresh
        </button>
      </div>

      {/* Stats */}
      {summary.isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[...Array(3)].map((_, i) => <div key={i} className="bg-card border border-card-border rounded-lg p-4 h-24 animate-pulse" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <StatCard label="Live Games" value={data?.liveGamesCount ?? 0} icon={Activity} color="bg-red-500/10 text-red-400" />
          <StatCard label="Upcoming" value={data?.upcomingGamesCount ?? 0} sub="today's slate" icon={Calendar} color="bg-blue-500/10 text-blue-400" />
          <StatCard label="Total Games" value={data?.totalGames ?? 0} sub="across all sports" icon={BarChart2} color="bg-primary/10 text-primary" />
        </div>
      )}

      {/* Today's Top Games */}
      <div className="bg-card border border-card-border rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold">Today's Top Games</h2>
          <Link href="/games">
            <span className="text-xs text-primary hover:underline flex items-center gap-1 cursor-pointer" data-testid="link-view-all-bets">
              View all <ChevronRight className="h-3 w-3" />
            </span>
          </Link>
        </div>
        {summary.isLoading ? (
          <div className="p-4 space-y-3">
            {[...Array(4)].map((_, i) => <div key={i} className="h-12 bg-muted rounded animate-pulse" />)}
          </div>
        ) : !(data?.topGames as any[])?.length ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-muted-foreground">No upcoming games found.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {((data?.topGames ?? []) as any[]).map((g: any) => (
              <Link key={g.id} href={`/games/${g.id}`}>
                <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors cursor-pointer" data-testid={`row-game-${g.id}`}>
                  <SportBadge sport={g.sport} />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium truncate">{g.awayTeam} @ {g.homeTeam}</div>
                    <div className="text-[10px] text-muted-foreground">{new Date(g.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {g.bookCount} books</div>
                  </div>
                  <ChevronRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Steam Moves */}
      <SteamMovesWidget />

      {/* Sport & Bookmaker Breakdown */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-card border border-card-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-sm font-semibold">By Sport</h2>
          </div>
          <div className="divide-y divide-border">
            {((data?.sportBreakdown ?? []) as any[]).map((s: any) => (
              <div key={s.sport} className="flex items-center justify-between px-4 py-3" data-testid={`stat-sport-${s.sport.toLowerCase()}`}>
                <SportBadge sport={s.sport} />
                <span className="text-xs text-muted-foreground">{s.games} game{s.games !== 1 ? "s" : ""}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-card border border-card-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-sm font-semibold">By Bookmaker</h2>
          </div>
          <div className="divide-y divide-border">
            {((data?.bookmakerBreakdown ?? []) as any[]).map((b: any) => (
              <div key={b.bookmaker} className="flex items-center justify-between px-4 py-3" data-testid={`stat-bookmaker-${b.bookmaker.toLowerCase()}`}>
                <span className="text-sm font-medium">{b.bookmaker}</span>
                <span className="text-xs text-muted-foreground">{b.games} game{b.games !== 1 ? "s" : ""}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

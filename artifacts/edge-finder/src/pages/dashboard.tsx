import { useGetDashboardSummary, getGetDashboardSummaryQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { Link } from "wouter";
import { Activity, TrendingUp, Zap, RefreshCw, BarChart2, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

function EdgeBadge({ edge }: { edge: number }) {
  return (
    <span className={cn(
      "inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-bold border",
      edge >= 5 ? "edge-bg-high" : edge >= 3 ? "edge-bg-medium" : "edge-bg-low"
    )}>
      +{edge.toFixed(1)}%
    </span>
  );
}

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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <div key={i} className="bg-card border border-card-border rounded-lg p-4 h-24 animate-pulse" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Live Games" value={data?.liveGamesCount ?? 0} icon={Activity} color="bg-red-500/10 text-red-400" />
          <StatCard label="Upcoming" value={data?.upcomingGamesCount ?? 0} icon={BarChart2} color="bg-blue-500/10 text-blue-400" />
          <StatCard label="Value Bets" value={data?.totalValueBets ?? 0} sub="with 3%+ edge" icon={TrendingUp} color="bg-primary/10 text-primary" />
          <StatCard label="Avg Edge" value={`${(data?.avgEdge ?? 0).toFixed(1)}%`} sub="across all bets" icon={Zap} color="bg-yellow-500/10 text-yellow-400" />
        </div>
      )}

      {/* Top Value Bets */}
      <div className="bg-card border border-card-border rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold">Top Value Bets</h2>
          <Link href="/value-bets">
            <span className="text-xs text-primary hover:underline flex items-center gap-1 cursor-pointer" data-testid="link-view-all-bets">
              View all <ChevronRight className="h-3 w-3" />
            </span>
          </Link>
        </div>
        {summary.isLoading ? (
          <div className="p-4 space-y-3">
            {[...Array(3)].map((_, i) => <div key={i} className="h-12 bg-muted rounded animate-pulse" />)}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="text-left px-4 py-2 font-medium">Game</th>
                  <th className="text-left px-4 py-2 font-medium hidden sm:table-cell">Sport</th>
                  <th className="text-left px-4 py-2 font-medium">Bet</th>
                  <th className="text-left px-4 py-2 font-medium">Book</th>
                  <th className="text-right px-4 py-2 font-medium">Edge</th>
                  <th className="text-right px-4 py-2 font-medium hidden md:table-cell">Kelly</th>
                </tr>
              </thead>
              <tbody>
                {(data?.topValueBets ?? []).map((vb) => (
                  <tr key={vb.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors" data-testid={`row-value-bet-${vb.id}`}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-xs leading-snug">
                        <span>{vb.homeTeam}</span>
                        <span className="text-muted-foreground mx-1">vs</span>
                        <span>{vb.awayTeam}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 hidden sm:table-cell">
                      <SportBadge sport={vb.sport} />
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="text-xs">
                        <span className="font-medium">{vb.team}</span>
                        <span className="text-muted-foreground ml-1 capitalize">{vb.betType}</span>
                      </div>
                      <div className="font-mono text-xs text-muted-foreground">{vb.odds > 0 ? `+${vb.odds}` : vb.odds}</div>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{vb.bookmaker}</td>
                    <td className="px-4 py-2.5 text-right">
                      <EdgeBadge edge={vb.edge} />
                    </td>
                    <td className="px-4 py-2.5 text-right hidden md:table-cell">
                      <span className="text-xs font-mono text-muted-foreground">{(vb.kellyStake * 100).toFixed(1)}%</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Sport Breakdown */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-card border border-card-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-sm font-semibold">By Sport</h2>
          </div>
          <div className="divide-y divide-border">
            {(data?.sportBreakdown ?? []).map((s) => (
              <div key={s.sport} className="flex items-center justify-between px-4 py-3" data-testid={`stat-sport-${s.sport.toLowerCase()}`}>
                <div className="flex items-center gap-2">
                  <SportBadge sport={s.sport} />
                  <span className="text-xs text-muted-foreground">{s.games} games</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-xs text-muted-foreground">{s.valueBets} bets</span>
                  <EdgeBadge edge={s.avgEdge} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-card border border-card-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-sm font-semibold">By Bookmaker</h2>
          </div>
          <div className="divide-y divide-border">
            {(data?.bookmakerBreakdown ?? []).map((b) => (
              <div key={b.bookmaker} className="flex items-center justify-between px-4 py-3" data-testid={`stat-bookmaker-${b.bookmaker.toLowerCase()}`}>
                <span className="text-sm font-medium">{b.bookmaker}</span>
                <div className="flex items-center gap-4">
                  <span className="text-xs text-muted-foreground">{b.valueBets} bets</span>
                  <EdgeBadge edge={b.avgEdge} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

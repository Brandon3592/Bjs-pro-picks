import { useState } from "react";
import { useGetValueBets, getGetValueBetsQueryKey } from "@workspace/api-client-react";
import { ArrowUpDown, ArrowUp, ArrowDown, Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

type SortField = "edge" | "odds" | "kellyStake" | "sport";
type SortDir = "asc" | "desc";

function EdgeBadge({ edge }: { edge: number }) {
  return (
    <span className={cn(
      "inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-bold border",
      edge >= 2 ? "edge-bg-high" : edge >= 1 ? "edge-bg-medium" : "edge-bg-low"
    )}>
      +{edge.toFixed(2)}%
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

function SortIcon({ field, current, dir }: { field: SortField; current: SortField; dir: SortDir }) {
  if (field !== current) return <ArrowUpDown className="h-3 w-3 text-muted-foreground" />;
  return dir === "asc" ? <ArrowUp className="h-3 w-3 text-primary" /> : <ArrowDown className="h-3 w-3 text-primary" />;
}

const SPORTS = ["all", "NFL", "NBA", "MLB", "NHL"] as const;

export default function ValueBets() {
  const [sortBy, setSortBy] = useState<SortField>("edge");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [sport, setSport] = useState<string>("all");

  const bets = useGetValueBets(
    { sport: sport as "NFL" | "NBA" | "MLB" | "NHL" | "all", sortBy, sortDir, minEdge: 3 },
    { query: { refetchInterval: 60000, queryKey: getGetValueBetsQueryKey({ sport: sport as "NFL" | "NBA" | "MLB" | "NHL" | "all", sortBy, sortDir, minEdge: 3 }) } }
  );

  function toggleSort(field: SortField) {
    if (sortBy === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortDir("desc");
    }
  }

  const cols: { label: string; field?: SortField; className?: string }[] = [
    { label: "Game" },
    { label: "Sport", field: "sport", className: "hidden sm:table-cell" },
    { label: "Bet" },
    { label: "Book" },
    { label: "Odds", field: "odds", className: "text-right" },
    { label: "Implied", className: "text-right hidden md:table-cell" },
    { label: "Model", className: "text-right hidden md:table-cell" },
    { label: "Edge", field: "edge", className: "text-right" },
    { label: "Kelly", field: "kellyStake", className: "text-right hidden lg:table-cell" },
    { label: "Status", className: "hidden sm:table-cell" },
  ];

  return (
    <div className="p-4 md:p-6 space-y-4 pb-20 md:pb-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold">Value Bets</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Live market edges via consensus de-vig · {bets.data?.length ?? 0} bet{(bets.data?.length ?? 0) !== 1 ? "s" : ""} found
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          {SPORTS.map((s) => (
            <button
              key={s}
              onClick={() => setSport(s)}
              data-testid={`filter-sport-${s.toLowerCase()}`}
              className={cn(
                "px-2.5 py-1 rounded text-xs font-medium border transition-colors",
                sport === s
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
              )}
            >
              {s === "all" ? "All" : s}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-card border border-card-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground bg-muted/30">
                {cols.map((col) => (
                  <th
                    key={col.label}
                    className={cn("px-3 py-2.5 font-medium text-left", col.className)}
                    onClick={col.field ? () => toggleSort(col.field!) : undefined}
                  >
                    {col.field ? (
                      <button className="flex items-center gap-1 hover:text-foreground transition-colors">
                        {col.label}
                        <SortIcon field={col.field} current={sortBy} dir={sortDir} />
                      </button>
                    ) : (
                      col.label
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bets.isLoading ? (
                [...Array(6)].map((_, i) => (
                  <tr key={i} className="border-b border-border">
                    {cols.map((c) => (
                      <td key={c.label} className={cn("px-3 py-3", c.className)}>
                        <div className="h-4 bg-muted rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : (bets.data ?? []).length === 0 ? (
                <tr>
                  <td colSpan={cols.length} className="px-4 py-12 text-center">
                    <div className="text-muted-foreground text-sm font-medium">No value bets detected</div>
                    <div className="text-muted-foreground text-xs mt-1 max-w-xs mx-auto">
                      The market is currently efficient — all books are pricing within {sport === "all" ? "0.5%" : `0.5%`} of consensus. Check back as lines move closer to game time.
                    </div>
                  </td>
                </tr>
              ) : (
                (bets.data ?? []).map((vb) => (
                  <tr key={vb.id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors" data-testid={`row-bet-${vb.id}`}>
                    <td className="px-3 py-3">
                      <div className="text-xs font-medium leading-snug">
                        <div>{vb.homeTeam}</div>
                        <div className="text-muted-foreground">vs {vb.awayTeam}</div>
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        {format(new Date(vb.startTime), "MMM d, h:mm a")}
                      </div>
                    </td>
                    <td className="px-3 py-3 hidden sm:table-cell">
                      <SportBadge sport={vb.sport} />
                    </td>
                    <td className="px-3 py-3">
                      <div className="text-xs font-medium">{vb.team}</div>
                      <div className="text-[10px] text-muted-foreground capitalize">{vb.betType}</div>
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">{vb.bookmaker}</td>
                    <td className="px-3 py-3 text-right font-mono text-xs font-bold">
                      {vb.odds > 0 ? `+${vb.odds}` : vb.odds}
                    </td>
                    <td className="px-3 py-3 text-right hidden md:table-cell">
                      <span className="text-xs font-mono text-muted-foreground">{(vb.impliedProb * 100).toFixed(1)}%</span>
                    </td>
                    <td className="px-3 py-3 text-right hidden md:table-cell">
                      <span className="text-xs font-mono text-foreground">{(vb.modelProb * 100).toFixed(1)}%</span>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <EdgeBadge edge={vb.edge} />
                    </td>
                    <td className="px-3 py-3 text-right hidden lg:table-cell">
                      <span className="text-xs font-mono text-muted-foreground">{(vb.kellyStake * 100).toFixed(1)}%</span>
                    </td>
                    <td className="px-3 py-3 hidden sm:table-cell">
                      <span className={cn(
                        "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border",
                        vb.status === "live"
                          ? "bg-red-500/10 text-red-400 border-red-500/20"
                          : "bg-muted text-muted-foreground border-border"
                      )}>
                        {vb.status === "live" ? "LIVE" : "UPCOMING"}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground text-center">
        For entertainment only. Bet responsibly. Auto-refreshes every 60 seconds.
      </p>
    </div>
  );
}

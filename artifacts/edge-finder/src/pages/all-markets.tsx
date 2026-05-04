import { useState } from "react";
import { useGetAllMarketsCatalog, useGetAllMarkets } from "@workspace/api-client-react";
import { Globe, RefreshCw, TrendingUp, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

const GROUPS = ["US Sports", "Soccer", "Combat", "More"] as const;
type Group = (typeof GROUPS)[number];

const GROUP_COLORS: Record<Group, string> = {
  "US Sports": "text-blue-400",
  Soccer: "text-green-400",
  Combat: "text-red-400",
  More: "text-purple-400",
};

const MARKET_FILTER_OPTIONS = [
  { key: "all", label: "All Markets" },
  { key: "h2h", label: "Moneyline" },
  { key: "spreads", label: "Spread" },
  { key: "totals", label: "Total" },
  { key: "alternate_spreads", label: "Alt Spread" },
  { key: "alternate_totals", label: "Alt Total" },
  { key: "team_totals", label: "Team Total" },
  { key: "btts", label: "BTTS" },
];

function edgeColor(edge: number) {
  if (edge >= 2) return "text-primary bg-primary/10 border-primary/30";
  if (edge >= 1) return "text-amber-400 bg-amber-400/10 border-amber-400/30";
  return "text-muted-foreground bg-muted/30 border-border";
}

function formatOdds(o: number) {
  return o > 0 ? `+${o}` : `${o}`;
}

export default function AllMarkets() {
  const [group, setGroup] = useState<Group>("US Sports");
  const [selectedSport, setSelectedSport] = useState<string>("basketball_nba");
  const [marketFilter, setMarketFilter] = useState<string>("all");
  const [minEdge, setMinEdge] = useState<number>(0.5);

  const { data: catalog = [] } = useGetAllMarketsCatalog(
    {},
    { query: { staleTime: Infinity } },
  );

  const currentGroup = catalog.find((g) => g.group === group);

  const {
    data: bets = [],
    isLoading,
    isFetching,
    refetch,
  } = useGetAllMarkets(
    { sport: selectedSport, minEdge },
    { query: { enabled: !!selectedSport, refetchInterval: 10 * 60_000 } },
  );

  const selectedSportTitle =
    catalog.flatMap((g) => g.sports).find((s) => s.key === selectedSport)?.title ?? selectedSport;

  const filtered =
    marketFilter === "all" ? bets : bets.filter((b) => b.marketKey === marketFilter);

  // Get unique market keys present in the results (for smart filter display)
  const presentMarkets = new Set(bets.map((b) => b.marketKey));

  // Group filtered bets by game for display
  const byGame = new Map<string, typeof filtered>();
  for (const bet of filtered) {
    if (!byGame.has(bet.gameId)) byGame.set(bet.gameId, []);
    byGame.get(bet.gameId)!.push(bet);
  }

  return (
    <div className="p-4 md:p-6 space-y-4 pb-20 md:pb-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <Globe className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">All Markets</h1>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          Every bet type across every sport — moneylines, spreads, totals, alt lines, team totals, BTTS &amp; more
        </p>
      </div>

      {/* Group tabs */}
      <div className="flex gap-1 flex-wrap">
        {GROUPS.map((g) => (
          <button
            key={g}
            onClick={() => setGroup(g)}
            className={cn(
              "px-3 py-1.5 rounded-md text-xs font-semibold transition-colors",
              group === g
                ? "bg-primary text-primary-foreground"
                : "bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {g}
          </button>
        ))}
      </div>

      {/* Sport chips */}
      {currentGroup && (
        <div className="flex flex-wrap gap-1.5">
          {currentGroup.sports.map((s) => (
            <button
              key={s.key}
              onClick={() => setSelectedSport(s.key)}
              className={cn(
                "px-3 py-1 rounded-full text-xs font-semibold border transition-colors",
                selectedSport === s.key
                  ? cn("bg-primary/15 border-primary/50", GROUP_COLORS[group])
                  : "bg-transparent border-border text-muted-foreground hover:border-primary/30 hover:text-foreground",
              )}
            >
              {s.title}
            </button>
          ))}
        </div>
      )}

      {/* Controls row */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>Min edge</span>
          {[0.5, 1, 2].map((v) => (
            <button
              key={v}
              onClick={() => setMinEdge(v)}
              className={cn(
                "px-2 py-0.5 rounded border text-[11px] font-mono transition-colors",
                minEdge === v
                  ? "bg-primary/15 border-primary/40 text-primary"
                  : "border-border text-muted-foreground hover:border-primary/30",
              )}
            >
              {v}%
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", isFetching && "animate-spin")} />
          Refresh
        </Button>
        {bets.length > 0 && (
          <span className="text-xs text-muted-foreground ml-auto">
            {filtered.length} edge{filtered.length !== 1 ? "s" : ""} · {selectedSportTitle}
          </span>
        )}
      </div>

      {/* Market type filter chips */}
      {bets.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {MARKET_FILTER_OPTIONS.filter(
            (opt) => opt.key === "all" || presentMarkets.has(opt.key),
          ).map((opt) => (
            <button
              key={opt.key}
              onClick={() => setMarketFilter(opt.key)}
              className={cn(
                "px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors",
                marketFilter === opt.key
                  ? "bg-primary/15 border-primary/40 text-primary"
                  : "bg-transparent border-border text-muted-foreground hover:border-primary/30",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="text-center py-16 text-muted-foreground text-sm animate-pulse">
          Fetching {selectedSportTitle} odds across all bookmakers…
        </div>
      )}

      {/* Empty */}
      {!isLoading && bets.length === 0 && (
        <div className="text-center py-16 space-y-2">
          <TrendingUp className="h-10 w-10 text-muted-foreground/30 mx-auto" />
          <p className="text-sm font-medium text-muted-foreground">No edges found</p>
          <p className="text-xs text-muted-foreground/70">
            Try a lower min edge threshold or select a different sport.
          </p>
        </div>
      )}

      {!isLoading && bets.length > 0 && filtered.length === 0 && (
        <div className="text-center py-8 text-muted-foreground text-sm">
          No {marketFilter} edges — try a different market filter.
        </div>
      )}

      {/* Results grouped by game */}
      {!isLoading && filtered.length > 0 && (
        <div className="space-y-3">
          {Array.from(byGame.entries()).map(([gameId, gameBets]) => {
            const first = gameBets[0];
            const startTime = new Date(first.startTime);
            const isToday = startTime.toDateString() === new Date().toDateString();
            return (
              <div key={gameId} className="bg-card border border-card-border rounded-lg overflow-hidden">
                {/* Game header */}
                <div className="px-4 py-2 border-b border-border bg-muted/20 flex items-center gap-3">
                  <span className="text-xs font-semibold text-foreground">
                    {first.homeTeam} <span className="text-muted-foreground font-normal">vs</span>{" "}
                    {first.awayTeam}
                  </span>
                  <span
                    className={cn(
                      "text-[10px] px-1.5 py-0.5 rounded font-bold uppercase",
                      first.status === "live"
                        ? "bg-red-500/20 text-red-400"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {first.status === "live" ? "LIVE" : isToday ? format(startTime, "h:mm a") : format(startTime, "MMM d")}
                  </span>
                  <span className="text-[10px] text-muted-foreground ml-auto">
                    {gameBets.length} edge{gameBets.length !== 1 ? "s" : ""}
                  </span>
                </div>

                {/* Desktop table header */}
                <div className="hidden md:grid grid-cols-[1fr_96px_96px_88px_72px_56px_64px] gap-2 px-4 py-1.5 border-b border-border bg-muted/10 text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                  <span>Selection</span>
                  <span>Market</span>
                  <span>Book</span>
                  <span>Odds</span>
                  <span className="text-right">Impl%</span>
                  <span className="text-right">Cons%</span>
                  <span className="text-right">Edge</span>
                </div>

                {/* Rows */}
                <div className="divide-y divide-border">
                  {gameBets.map((bet) => (
                    <BetRow key={bet.id} bet={bet} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BetRow({ bet }: { bet: ReturnType<typeof useGetAllMarkets>["data"][number] }) {
  const isAlt = bet.marketKey.startsWith("alternate_") || bet.marketKey === "team_totals";
  return (
    <>
      {/* Desktop */}
      <div className="hidden md:grid grid-cols-[1fr_96px_96px_88px_72px_56px_64px] gap-2 px-4 py-2.5 items-center hover:bg-muted/20 transition-colors">
        <div className="min-w-0">
          <span className="text-sm font-medium truncate block">{bet.selection}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground truncate">{bet.marketLabel}</span>
          {isAlt && (
            <span className="text-[9px] font-bold uppercase text-violet-400 bg-violet-400/10 rounded px-1 flex-shrink-0">
              ALT
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground truncate">{bet.bookmaker}</span>
        <span className={cn("text-sm font-mono font-medium", bet.odds > 0 ? "text-primary" : "")}>
          {formatOdds(bet.odds)}
        </span>
        <span className="text-xs font-mono text-right text-muted-foreground">{bet.impliedProb}%</span>
        <span className="text-xs font-mono text-right text-muted-foreground">{bet.consensusProb}%</span>
        <div className="flex justify-end">
          <span className={cn("text-xs font-mono font-bold px-1.5 py-0.5 rounded border", edgeColor(bet.edge))}>
            +{bet.edge}%
          </span>
        </div>
      </div>

      {/* Mobile */}
      <div className="md:hidden px-4 py-3 space-y-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-sm font-semibold">{bet.selection}</span>
              {isAlt && (
                <span className="text-[9px] font-bold uppercase text-violet-400 bg-violet-400/10 rounded px-1">
                  ALT
                </span>
              )}
            </div>
            <span className="text-xs text-muted-foreground">{bet.marketLabel}</span>
          </div>
          <span className={cn("text-xs font-mono font-bold px-1.5 py-0.5 rounded border flex-shrink-0", edgeColor(bet.edge))}>
            +{bet.edge}%
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className={cn("font-mono font-medium", bet.odds > 0 ? "text-primary" : "")}>
            {formatOdds(bet.odds)}
          </span>
          <span>@ {bet.bookmaker}</span>
          <span className="ml-auto">{bet.impliedProb}% → {bet.consensusProb}%</span>
        </div>
      </div>
    </>
  );
}

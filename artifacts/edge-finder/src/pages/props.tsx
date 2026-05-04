import { useState } from "react";
import { useGetPropsGames, useGetProps } from "@workspace/api-client-react";
import { Users, RefreshCw, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const SPORTS = ["NBA", "MLB", "NHL", "NFL"] as const;
type Sport = (typeof SPORTS)[number];

interface MarketDef {
  key: string;
  label: string;
  alt?: boolean;
}

const SPORT_MARKETS: Record<Sport, MarketDef[]> = {
  NBA: [
    { key: "player_points", label: "Points" },
    { key: "player_rebounds", label: "Rebounds" },
    { key: "player_assists", label: "Assists" },
    { key: "player_threes", label: "3-Pointers" },
    { key: "player_points_alternate", label: "Alt Points", alt: true },
    { key: "player_rebounds_alternate", label: "Alt Rebounds", alt: true },
    { key: "player_assists_alternate", label: "Alt Assists", alt: true },
    { key: "player_threes_alternate", label: "Alt 3-Pointers", alt: true },
  ],
  MLB: [
    { key: "batter_hits", label: "Hits" },
    { key: "pitcher_strikeouts", label: "Strikeouts" },
    { key: "batter_home_runs", label: "Home Runs" },
    { key: "batter_hits_alternate", label: "Alt Hits", alt: true },
    { key: "pitcher_strikeouts_alternate", label: "Alt Strikeouts", alt: true },
    { key: "batter_home_runs_alternate", label: "Alt Home Runs", alt: true },
  ],
  NHL: [
    { key: "player_goals", label: "Goals" },
    { key: "player_shots_on_goal", label: "Shots on Goal" },
    { key: "player_points", label: "Points" },
    { key: "player_goals_alternate", label: "Alt Goals", alt: true },
    { key: "player_shots_on_goal_alternate", label: "Alt Shots", alt: true },
    { key: "player_points_alternate", label: "Alt Points", alt: true },
  ],
  NFL: [
    { key: "player_pass_yds", label: "Pass Yards" },
    { key: "player_rush_yds", label: "Rush Yards" },
    { key: "player_receiving_yds", label: "Rec Yards" },
    { key: "player_receptions", label: "Receptions" },
    { key: "player_pass_yds_alternate", label: "Alt Pass Yds", alt: true },
    { key: "player_rush_yds_alternate", label: "Alt Rush Yds", alt: true },
    { key: "player_receiving_yds_alternate", label: "Alt Rec Yds", alt: true },
    { key: "player_receptions_alternate", label: "Alt Receptions", alt: true },
  ],
};

const SPORT_COLORS: Record<Sport, string> = {
  NBA: "text-orange-400",
  MLB: "text-blue-400",
  NHL: "text-cyan-400",
  NFL: "text-green-400",
};

function formatOdds(o: number) {
  return o > 0 ? `+${o}` : `${o}`;
}

function edgeColor(edge: number) {
  if (edge >= 2) return "text-primary bg-primary/10 border-primary/30";
  if (edge >= 1) return "text-amber-400 bg-amber-400/10 border-amber-400/30";
  return "text-muted-foreground bg-muted/30 border-border";
}

/** Default active markets = standard lines only (no alt) */
function defaultMarkets(sport: Sport): Set<string> {
  return new Set(SPORT_MARKETS[sport].filter((m) => !m.alt).map((m) => m.key));
}

export default function Props() {
  const [sport, setSport] = useState<Sport>("NBA");
  const [selectedGame, setSelectedGame] = useState<string>("");
  const [activeMarkets, setActiveMarkets] = useState<Set<string>>(() => defaultMarkets("NBA"));

  const markets = SPORT_MARKETS[sport];

  const { data: games = [], isLoading: gamesLoading } = useGetPropsGames(
    { sport },
    { query: { staleTime: 5 * 60_000 } },
  );

  const gameId = selectedGame || games[0]?.id || "";

  const marketsParam = markets
    .filter((m) => activeMarkets.has(m.key))
    .map((m) => m.key)
    .join(",");

  const {
    data: propEdges = [],
    isLoading: propsLoading,
    refetch,
    isFetching,
  } = useGetProps(
    { gameId, sport, markets: marketsParam },
    { query: { enabled: !!gameId && marketsParam.length > 0, refetchInterval: 15 * 60_000 } },
  );

  function handleSportChange(s: Sport) {
    setSport(s);
    setSelectedGame("");
    setActiveMarkets(defaultMarkets(s));
  }

  function toggleMarket(key: string) {
    setActiveMarkets((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function toggleAltLines() {
    const altKeys = markets.filter((m) => m.alt).map((m) => m.key);
    const anyAltActive = altKeys.some((k) => activeMarkets.has(k));
    setActiveMarkets((prev) => {
      const next = new Set(prev);
      if (anyAltActive) {
        altKeys.forEach((k) => next.delete(k));
      } else {
        altKeys.forEach((k) => next.add(k));
      }
      return next;
    });
  }

  const altKeys = markets.filter((m) => m.alt).map((m) => m.key);
  const anyAltActive = altKeys.some((k) => activeMarkets.has(k));

  const selectedGameData = games.find((g) => g.id === gameId);
  const isLoading = gamesLoading || propsLoading;

  return (
    <div className="p-4 md:p-6 space-y-4 pb-20 md:pb-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">Player Props</h1>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          Consensus de-vig edge across DraftKings, FanDuel, BetMGM &amp; more — including alternate lines
        </p>
      </div>

      {/* Sport tabs */}
      <div className="flex gap-1 flex-wrap">
        {SPORTS.map((s) => (
          <button
            key={s}
            onClick={() => handleSportChange(s)}
            className={cn(
              "px-3 py-1.5 rounded-md text-xs font-semibold transition-colors",
              sport === s
                ? "bg-primary text-primary-foreground"
                : "bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Game selector + controls row */}
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={gameId}
          onValueChange={setSelectedGame}
          disabled={gamesLoading || games.length === 0}
        >
          <SelectTrigger className="w-64 text-xs" data-testid="select-game">
            <SelectValue placeholder={gamesLoading ? "Loading games…" : "Select a game"} />
          </SelectTrigger>
          <SelectContent>
            {games.map((g) => (
              <SelectItem key={g.id} value={g.id} className="text-xs">
                {g.homeTeam} vs {g.awayTeam}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          variant="outline"
          size="sm"
          onClick={toggleAltLines}
          className={cn(
            "text-xs transition-colors",
            anyAltActive && "border-primary/50 bg-primary/10 text-primary",
          )}
        >
          Alt Lines {anyAltActive ? "On" : "Off"}
        </Button>

        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching || !gameId}>
          <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", isFetching && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* Market filter chips */}
      <div className="flex gap-1.5 flex-wrap">
        {markets.map((m) => (
          <button
            key={m.key}
            onClick={() => toggleMarket(m.key)}
            className={cn(
              "px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors",
              m.alt
                ? activeMarkets.has(m.key)
                  ? "bg-violet-500/15 border-violet-500/40 text-violet-400"
                  : "bg-transparent border-dashed border-border text-muted-foreground/60 hover:border-violet-400/30 hover:text-violet-400/60"
                : activeMarkets.has(m.key)
                  ? "bg-primary/15 border-primary/40 text-primary"
                  : "bg-transparent border-border text-muted-foreground hover:border-primary/30",
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Selected game title */}
      {selectedGameData && (
        <div className="flex items-center gap-2 text-sm flex-wrap">
          <span className={cn("text-[10px] font-bold uppercase tracking-widest", SPORT_COLORS[sport])}>
            {sport}
          </span>
          <span className="font-semibold">
            {selectedGameData.homeTeam} <span className="text-muted-foreground font-normal">vs</span>{" "}
            {selectedGameData.awayTeam}
          </span>
          <Badge variant="secondary" className="text-[10px]">
            {selectedGameData.status}
          </Badge>
          {propEdges.length > 0 && (
            <span className="text-xs text-muted-foreground ml-auto">
              {propEdges.length} edge{propEdges.length !== 1 ? "s" : ""} found
            </span>
          )}
        </div>
      )}

      {/* Empty / loading states */}
      {!gameId && !gamesLoading && (
        <div className="text-center py-16 text-muted-foreground text-sm">
          Select a game above to load player props.
        </div>
      )}

      {activeMarkets.size === 0 && gameId && (
        <div className="text-center py-16 text-muted-foreground text-sm">
          Enable at least one market above.
        </div>
      )}

      {isLoading && (
        <div className="text-center py-16 text-muted-foreground text-sm animate-pulse">
          Fetching props from bookmakers…
        </div>
      )}

      {!isLoading && gameId && propEdges.length === 0 && activeMarkets.size > 0 && (
        <div className="text-center py-16 space-y-2">
          <TrendingUp className="h-10 w-10 text-muted-foreground/30 mx-auto" />
          <p className="text-sm font-medium text-muted-foreground">No edges found</p>
          <p className="text-xs text-muted-foreground/70">
            Props are priced efficiently here. Try enabling alt lines or switching games.
          </p>
        </div>
      )}

      {/* Props table */}
      {!isLoading && propEdges.length > 0 && (
        <div className="bg-card border border-card-border rounded-lg overflow-hidden">
          <div className="grid grid-cols-[1fr_88px_56px_88px_72px_56px_64px] gap-2 px-4 py-2 border-b border-border bg-muted/30 text-[10px] font-medium text-muted-foreground uppercase tracking-wide hidden md:grid">
            <span>Player</span>
            <span>Market</span>
            <span className="text-right">Line</span>
            <span>Book</span>
            <span>Odds</span>
            <span className="text-right">Impl%</span>
            <span className="text-right">Edge</span>
          </div>

          <div className="divide-y divide-border">
            {propEdges.map((p, i) => (
              <PropRow
                key={`${p.player}-${p.market}-${p.line}-${p.side}-${p.bookmaker}-${i}`}
                prop={p}
                isAlt={p.market.endsWith("_alternate")}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PropRow({
  prop,
  isAlt,
}: {
  prop: ReturnType<typeof useGetProps>["data"][number];
  isAlt: boolean;
}) {
  return (
    <>
      {/* Desktop row */}
      <div className="hidden md:grid grid-cols-[1fr_88px_56px_88px_72px_56px_64px] gap-2 px-4 py-2.5 items-center hover:bg-muted/20 transition-colors">
        <div className="min-w-0">
          <span className="text-sm font-medium truncate block">{prop.player}</span>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground">{prop.side}</span>
            {isAlt && (
              <span className="text-[9px] font-bold uppercase tracking-wider text-violet-400 bg-violet-400/10 rounded px-1 py-0.5">
                ALT
              </span>
            )}
          </div>
        </div>
        <span className="text-xs text-muted-foreground truncate">{prop.marketLabel}</span>
        <span className="text-sm font-mono text-right">{prop.line}</span>
        <span className="text-xs text-muted-foreground truncate">{prop.bookmaker}</span>
        <span className={cn("text-sm font-mono font-medium", prop.odds > 0 ? "text-primary" : "text-foreground")}>
          {formatOdds(prop.odds)}
        </span>
        <span className="text-xs font-mono text-right text-muted-foreground">{prop.impliedProb}%</span>
        <div className="flex justify-end">
          <span className={cn("text-xs font-mono font-bold px-1.5 py-0.5 rounded border", edgeColor(prop.edge))}>
            +{prop.edge}%
          </span>
        </div>
      </div>

      {/* Mobile row */}
      <div className="md:hidden px-4 py-3 space-y-1">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold">{prop.player}</span>
              {isAlt && (
                <span className="text-[9px] font-bold uppercase tracking-wider text-violet-400 bg-violet-400/10 rounded px-1 py-0.5">
                  ALT
                </span>
              )}
            </div>
            <span className="text-xs text-muted-foreground">
              {prop.side} {prop.line} {prop.marketLabel}
            </span>
          </div>
          <span className={cn("text-xs font-mono font-bold px-1.5 py-0.5 rounded border flex-shrink-0", edgeColor(prop.edge))}>
            +{prop.edge}%
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className={cn("font-mono font-medium", prop.odds > 0 ? "text-primary" : "text-foreground")}>
            {formatOdds(prop.odds)}
          </span>
          <span>@</span>
          <span>{prop.bookmaker}</span>
          <span className="ml-auto">{prop.impliedProb}% impl · {prop.consensusProb}% cons</span>
        </div>
      </div>
    </>
  );
}

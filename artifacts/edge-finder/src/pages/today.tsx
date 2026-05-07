import { useState } from "react";
import { useGetAiPicks, useRefreshAiPicks } from "@workspace/api-client-react";
import { RefreshCw, Lock, Zap, Dices, Trophy, Shuffle, Target, TrendingUp, Cpu } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AIPick, AIParlay, AIPickLeg } from "@workspace/api-client-react";

function fmtOdds(o: number) {
  return o > 0 ? `+${o}` : `${o}`;
}

function impliedProb(odds: number): string {
  const p = odds > 0 ? 100 / (100 + odds) : Math.abs(odds) / (Math.abs(odds) + 100);
  return `${(p * 100).toFixed(0)}%`;
}

function combinedOddsPayout(odds: number): string {
  const decimal = odds > 0 ? odds / 100 + 1 : 100 / Math.abs(odds) + 1;
  return `$${((decimal - 1) * 100).toFixed(0)} profit per $100`;
}

function sportColor(sport: string) {
  const map: Record<string, string> = {
    NBA: "bg-orange-500/10 text-orange-400 border-orange-500/20",
    MLB: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    NHL: "bg-violet-500/10 text-violet-400 border-violet-500/20",
    NFL: "bg-green-500/10 text-green-400 border-green-500/20",
  };
  return map[sport] ?? "bg-muted text-muted-foreground border-border";
}

function confidenceColor(c: number) {
  if (c >= 70) return "text-green-400";
  if (c >= 55) return "text-amber-400";
  return "text-red-400";
}

function confidenceBg(c: number) {
  if (c >= 70) return "bg-green-500";
  if (c >= 55) return "bg-amber-500";
  return "bg-red-500";
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// ─── Lock of the Day card ──────────────────────────────────────────────────────

function LockCard({ pick }: { pick: AIPick }) {
  const [open, setOpen] = useState(true);
  const bullets = pick.reasoning.split(/\.\s+/).filter((s) => s.trim().length > 6);

  return (
    <div className="rounded-2xl border-2 border-amber-500/30 bg-card overflow-hidden shadow-lg">
      {/* Gold strip */}
      <div className="flex items-center justify-between px-4 py-3 bg-amber-500/10 border-b border-amber-500/20">
        <div className="flex items-center gap-2">
          <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border", sportColor(pick.sport))}>
            {pick.sport}
          </span>
          <span className="text-sm font-medium text-foreground">{pick.awayTeam} @ {pick.homeTeam}</span>
        </div>
        <span className="text-xs text-muted-foreground">{formatTime(pick.startTime)}</span>
      </div>

      {/* Body */}
      <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3">
        <div className="flex-1 min-w-0">
          {pick.player && (
            <p className="text-sm font-semibold text-amber-400 mb-0.5">{pick.player}</p>
          )}
          <p className="text-2xl font-bold leading-tight">{pick.pick}</p>
          <p className="text-xs text-muted-foreground mt-1">via {pick.bookmaker}</p>
        </div>
        <div className="flex-shrink-0 text-right">
          <p className={cn("text-4xl font-bold font-mono tabular-nums", pick.odds > 0 ? "text-green-400" : "text-foreground")}>
            {fmtOdds(pick.odds)}
          </p>
          {pick.edge > 0 && (
            <div className="mt-1.5 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-green-500/10 border border-green-500/30">
              <TrendingUp className="h-3 w-3 text-green-400" />
              <span className="text-xs font-bold text-green-400">+{(pick.edge * 100).toFixed(1)}% edge</span>
            </div>
          )}
        </div>
      </div>

      {/* Confidence bar */}
      <div className="flex items-center gap-3 px-5 pb-3">
        <div className="flex-1 h-2 rounded-full bg-border overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all", confidenceBg(pick.confidence))}
            style={{ width: `${pick.confidence}%` }}
          />
        </div>
        <span className={cn("text-xs font-bold tabular-nums", confidenceColor(pick.confidence))}>
          {pick.confidence}% confidence
        </span>
      </div>

      {/* Model Analysis */}
      <div className="border-t border-border mx-4 pt-3 pb-4">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 text-xs font-semibold text-amber-400 mb-2 hover:text-amber-300 transition-colors"
        >
          <Cpu className="h-3.5 w-3.5" />
          Model Analysis
          <span className="text-muted-foreground font-normal ml-1">{open ? "▲" : "▼"}</span>
        </button>

        {open && (
          <>
            {pick.tags?.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {pick.tags.map((tag) => (
                  <span key={tag} className="text-[10px] px-2 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/25 font-medium">
                    {tag.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
            )}
            <ul className="space-y-2">
              {bullets.map((sentence, i) => (
                <li key={i} className="flex gap-2.5 items-start">
                  <span className="text-amber-400 text-sm leading-5 flex-shrink-0">·</span>
                  <span className="text-sm text-foreground leading-5">{sentence.replace(/\.$/, "")}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Parlay card ───────────────────────────────────────────────────────────────

function ParlayCard({ parlay, accent, icon: Icon, label, sublabel }: {
  parlay: AIParlay;
  accent: string;
  icon: React.ElementType;
  label: string;
  sublabel: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="rounded-2xl border bg-card overflow-hidden"
      style={{ borderColor: accent + "44" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: accent + "22", backgroundColor: accent + "0d" }}>
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 flex-shrink-0" style={{ color: accent }} />
          <div>
            <p className="text-sm font-bold" style={{ color: accent }}>{label}</p>
            <p className="text-[10px] text-muted-foreground">{sublabel}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold font-mono tabular-nums" style={{ color: accent }}>
            {fmtOdds(parlay.combinedOdds)}
          </p>
          <p className="text-[10px] text-muted-foreground">{parlay.legs.length}-leg parlay</p>
        </div>
      </div>

      {/* Payout */}
      <div className="px-4 py-2 border-b border-border">
        <p className="text-xs text-muted-foreground">{parlay.name} · {combinedOddsPayout(parlay.combinedOdds)}</p>
      </div>

      {/* Legs */}
      <div className="divide-y divide-border">
        {parlay.legs.map((leg: AIPickLeg, i: number) => (
          <div key={i} className="flex items-center gap-3 px-4 py-2.5">
            <div
              className="h-2 w-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: leg.sport === "NBA" ? "#f97316" : leg.sport === "MLB" ? "#3b82f6" : leg.sport === "NHL" ? "#8b5cf6" : "#22c55e" }}
            />
            <div className="flex-1 min-w-0">
              <p className="text-[10px] text-muted-foreground truncate">
                {leg.awayTeam && leg.homeTeam ? `${leg.awayTeam} @ ${leg.homeTeam}` : leg.homeTeam || "Today's game"}
              </p>
              <p className="text-sm font-semibold truncate">
                {leg.player && !leg.pick.toLowerCase().includes(leg.player.toLowerCase())
                  ? `${leg.player} ${leg.pick}`
                  : leg.pick}
              </p>
            </div>
            <div className="flex-shrink-0 text-right">
              <p className="text-sm font-bold font-mono" style={{ color: accent }}>{fmtOdds(leg.odds)}</p>
              <p className="text-[10px] text-muted-foreground">{impliedProb(leg.odds)} impl.</p>
            </div>
          </div>
        ))}
      </div>

      {/* Confidence + toggle */}
      <div className="px-4 py-2.5 border-t border-border">
        <div className="flex items-center gap-3">
          <div className="flex-1 h-1.5 rounded-full bg-border overflow-hidden">
            <div
              className={cn("h-full rounded-full", confidenceBg(parlay.confidence))}
              style={{ width: `${parlay.confidence}%` }}
            />
          </div>
          <span className={cn("text-xs font-bold tabular-nums", confidenceColor(parlay.confidence))}>
            {parlay.confidence}%
          </span>
          <button
            onClick={() => setOpen((v) => !v)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors ml-1"
          >
            {open ? "Hide ▲" : "Why? ▼"}
          </button>
        </div>
        {open && (
          <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{parlay.reasoning}</p>
        )}
      </div>
    </div>
  );
}

// ─── Section header ────────────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, label, sublabel, accent }: {
  icon: React.ElementType;
  label: string;
  sublabel: string;
  accent: string;
}) {
  return (
    <div className="flex items-center gap-2.5 mb-3 pl-3 border-l-4" style={{ borderColor: accent }}>
      <Icon className="h-4.5 w-4.5 flex-shrink-0" style={{ color: accent }} />
      <div>
        <p className="text-sm font-bold" style={{ color: accent }}>{label}</p>
        <p className="text-[10px] text-muted-foreground">{sublabel}</p>
      </div>
    </div>
  );
}

// ─── Sport tab bar ─────────────────────────────────────────────────────────────

const SPORT_TABS = [
  { key: "all", label: "All Sports", emoji: "🌐" },
  { key: "NBA", label: "NBA", emoji: "🏀" },
  { key: "MLB", label: "MLB", emoji: "⚾" },
  { key: "NHL", label: "NHL", emoji: "🏒" },
] as const;

type SportKey = typeof SPORT_TABS[number]["key"];

// ─── Skeleton ──────────────────────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("rounded-lg bg-muted animate-pulse", className)} />;
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function TodayPage() {
  const [sport, setSport] = useState<SportKey>("all");
  const sportParam = sport === "all" ? undefined : sport;

  const { data, isLoading, isFetching } = useGetAiPicks(
    sportParam ? { sport: sportParam } : undefined,
    { query: { staleTime: 15 * 60_000, gcTime: 15 * 60_000, refetchOnWindowFocus: false } as any },
  );
  const { mutate: doRefresh, isPending: isRefreshing } = useRefreshAiPicks();

  function handleRefresh() {
    doRefresh(undefined, { onSettled: () => {} });
  }

  const lock = data?.lockOfTheDay ?? null;
  const safeParlay = sport === "all" ? (data as any)?.allSafeParlay : data?.safeParlay;
  const lottoParlay = sport === "all" ? (data as any)?.allLottoParlay : data?.lottoParlay;
  const gameParlay = sport === "all" ? (data as any)?.allGameParlay : data?.gameParlayOfTheDay;
  const propParlay = sport === "all" ? (data as any)?.allPropsParlay : data?.propParlayOfTheDay;
  const mixParlay = sport === "all" ? (data as any)?.allMixParlay : data?.mixParlayOfTheDay;

  return (
    <div className="p-4 md:p-6 space-y-6 pb-20 md:pb-8">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Today's Picks</h1>
          {data?.generatedAt && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Updated {new Date(data.generatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </p>
          )}
        </div>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing || isFetching}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", (isRefreshing || isFetching) && "animate-spin")} />
          {isRefreshing ? "Regenerating…" : "Refresh"}
        </button>
      </div>

      {/* Sport tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {SPORT_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setSport(tab.key)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors",
              sport === tab.key
                ? "bg-primary text-primary-foreground"
                : "bg-card border border-border text-muted-foreground hover:text-foreground"
            )}
          >
            <span>{tab.emoji}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Summary banner */}
      {data?.summary && (
        <div className="bg-card border border-border rounded-lg px-4 py-3 flex items-start gap-3">
          <div className={cn(
            "flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-semibold border flex-shrink-0",
            data.isAI ? "bg-primary/10 text-primary border-primary/20" : "bg-muted text-muted-foreground border-border"
          )}>
            <Cpu className="h-3 w-3" />
            {data.isAI ? "AI" : "Model"}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{data.summary}</p>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-64" />
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      ) : (
        <div className="space-y-8">
          {/* Lock of the Day */}
          <div>
            <SectionHeader icon={Lock} label="Lock of the Day" sublabel="Highest confidence single pick" accent="#f59e0b" />
            {lock ? (
              <LockCard pick={lock} />
            ) : (
              <div className="bg-card border border-border rounded-xl px-4 py-8 text-center">
                <p className="text-sm text-muted-foreground">No lock available — try refreshing.</p>
              </div>
            )}
          </div>

          {/* Safe Parlay */}
          <div>
            <SectionHeader icon={Zap} label="Safe Parlay" sublabel="2–3 legs, solid value (+175 to +500)" accent="#22c55e" />
            {safeParlay?.legs?.length > 0 ? (
              <ParlayCard parlay={safeParlay} accent="#22c55e" icon={Zap} label="Safe Parlay" sublabel="2–3 legs, solid value" />
            ) : (
              <div className="bg-card border border-border rounded-xl px-4 py-6 text-center">
                <p className="text-sm text-muted-foreground">No safe parlay — try refreshing.</p>
              </div>
            )}
          </div>

          {/* Lotto Parlay */}
          <div>
            <SectionHeader icon={Dices} label="Lotto Parlay" sublabel="4–6 legs, big payout (+800 to +3000)" accent="#a855f7" />
            {lottoParlay?.legs?.length > 0 ? (
              <ParlayCard parlay={lottoParlay} accent="#a855f7" icon={Dices} label="Lotto Parlay" sublabel="4–6 legs, big payout" />
            ) : (
              <div className="bg-card border border-border rounded-xl px-4 py-6 text-center">
                <p className="text-sm text-muted-foreground">No lotto parlay — try refreshing.</p>
              </div>
            )}
          </div>

          {/* Game Parlay */}
          {gameParlay?.legs?.length > 0 && (
            <div>
              <SectionHeader icon={Trophy} label="Game Picks Parlay" sublabel="Moneyline, spread & O/U only" accent="#3b82f6" />
              <ParlayCard parlay={gameParlay} accent="#3b82f6" icon={Trophy} label="Game Picks Parlay" sublabel="Moneyline, spread & O/U" />
            </div>
          )}

          {/* Props Parlay */}
          {propParlay?.legs?.length > 0 && (
            <div>
              <SectionHeader icon={Target} label="Player Props Parlay" sublabel="All player performance props" accent="#f97316" />
              <ParlayCard parlay={propParlay} accent="#f97316" icon={Target} label="Player Props Parlay" sublabel="Performance props" />
            </div>
          )}

          {/* Mix Parlay */}
          {mixParlay?.legs?.length > 0 && (
            <div>
              <SectionHeader icon={Shuffle} label="Mix Parlay" sublabel="Game bets + player props combined" accent="#14b8a6" />
              <ParlayCard parlay={mixParlay} accent="#14b8a6" icon={Shuffle} label="Mix Parlay" sublabel="Games + props combined" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

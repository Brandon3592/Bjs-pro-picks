import { useState } from "react";
import {
  useGetAiPicks,
  useRefreshAiPicks,
  useGetLadderProgress,
  useSettleLadder,
  getGetLadderProgressQueryKey,
  type LadderProgress,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  RefreshCw, Lock, Zap, Dices, Trophy, Shuffle, Target,
  TrendingUp, Cpu, Share2, PlusCircle, ExternalLink,
  Check, X, ArrowRight, ChevronDown, ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AIPick, AIParlay, AIPickLeg, AILadderParlay } from "@workspace/api-client-react";

// ─── Constants ─────────────────────────────────────────────────────────────────

const NFL_SEASON_ACTIVE = (() => {
  const m = new Date().getMonth() + 1;
  return m >= 8 || m <= 2;
})();

const SPORT_TABS = [
  { key: "all", label: "All Sports", emoji: "🌐" },
  { key: "NBA",  label: "NBA",       emoji: "🏀" },
  { key: "MLB",  label: "MLB",       emoji: "⚾" },
  { key: "NHL",  label: "NHL",       emoji: "🏒" },
  { key: "NFL",  label: "NFL",       emoji: "🏈" },
] as const;

type SportKey = typeof SPORT_TABS[number]["key"];

const LADDER_ACCENT = "#10b981";

// ─── Helpers ───────────────────────────────────────────────────────────────────

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

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
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

function sportBadgeClass(sport: string) {
  const map: Record<string, string> = {
    NBA: "bg-orange-500/10 text-orange-400 border-orange-500/20",
    MLB: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    NHL: "bg-violet-500/10 text-violet-400 border-violet-500/20",
    NFL: "bg-green-500/10 text-green-400 border-green-500/20",
  };
  return map[sport] ?? "bg-muted text-muted-foreground border-border";
}

function sportDotColor(sport: string) {
  const map: Record<string, string> = {
    NBA: "#f97316", MLB: "#3b82f6", NHL: "#8b5cf6", NFL: "#22c55e",
  };
  return map[sport] ?? "#6b7280";
}

function fmtMoney(n: number) {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

function calcCombinedOdds(legs: AIPickLeg[]): number {
  const dec = legs.reduce((acc, l) => {
    return acc * (l.odds > 0 ? l.odds / 100 + 1 : 100 / Math.abs(l.odds) + 1);
  }, 1);
  const net = dec - 1;
  return net >= 1 ? Math.round(net * 100) : -Math.round(100 / net);
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
      <Icon className="h-4 w-4 flex-shrink-0" style={{ color: accent }} />
      <div>
        <p className="text-sm font-bold" style={{ color: accent }}>{label}</p>
        <p className="text-[10px] text-muted-foreground">{sublabel}</p>
      </div>
    </div>
  );
}

// ─── Empty card ────────────────────────────────────────────────────────────────

function EmptyCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-xl px-4 py-6 text-center">
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

// ─── Skeleton ──────────────────────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("rounded-xl bg-muted animate-pulse", className)} />;
}

// ─── Lock of the Day card ──────────────────────────────────────────────────────

function LockCard({ pick }: { pick: AIPick }) {
  const [open, setOpen] = useState(true);
  const bullets = pick.reasoning.split(/\.\s+/).filter((s) => s.trim().length > 6);
  const GOLD = "#f59e0b";

  return (
    <div className="rounded-2xl border-2 bg-card overflow-hidden shadow-lg" style={{ borderColor: GOLD + "55" }}>
      {/* Gold header strip */}
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ backgroundColor: GOLD + "18", borderColor: GOLD + "30" }}>
        <div className="flex items-center gap-2 min-w-0">
          <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border flex-shrink-0", sportBadgeClass(pick.sport))}>
            {pick.sport}
          </span>
          <span className="text-sm font-medium truncate">{pick.awayTeam} @ {pick.homeTeam}</span>
        </div>
        <span className="text-xs text-muted-foreground flex-shrink-0 ml-2">{formatTime(pick.startTime)}</span>
      </div>

      {/* Main pick */}
      <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3">
        <div className="flex-1 min-w-0">
          {pick.player && <p className="text-sm font-semibold mb-0.5" style={{ color: GOLD }}>{pick.player}</p>}
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
          <div className={cn("h-full rounded-full transition-all", confidenceBg(pick.confidence))} style={{ width: `${pick.confidence}%` }} />
        </div>
        <span className={cn("text-xs font-bold tabular-nums", confidenceColor(pick.confidence))}>
          {pick.confidence}% confidence
        </span>
      </div>

      {/* Model Analysis */}
      <div className="border-t border-border mx-4 pt-3 pb-4">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 text-xs font-semibold mb-2 hover:opacity-80 transition-opacity"
          style={{ color: GOLD }}
        >
          <Cpu className="h-3.5 w-3.5" />
          Model Analysis
          {open ? <ChevronUp className="h-3 w-3 text-muted-foreground ml-1" /> : <ChevronDown className="h-3 w-3 text-muted-foreground ml-1" />}
        </button>
        {open && (
          <>
            {pick.tags?.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {pick.tags.map((tag) => (
                  <span key={tag} className="text-[10px] px-2 py-0.5 rounded border font-medium" style={{ backgroundColor: GOLD + "22", color: GOLD, borderColor: GOLD + "44" }}>
                    {tag.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
            )}
            <ul className="space-y-2">
              {bullets.map((sentence, i) => (
                <li key={i} className="flex gap-2.5 items-start">
                  <span className="text-sm leading-5 flex-shrink-0" style={{ color: GOLD }}>·</span>
                  <span className="text-sm text-foreground leading-5">{sentence.replace(/\.$/, "")}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 px-4 pb-4">
        <a
          href={`https://www.draftkings.com`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold transition-colors hover:opacity-80"
          style={{ borderColor: GOLD + "66", color: GOLD }}
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Place Bet
        </a>
      </div>
    </div>
  );
}

// ─── Parlay card ───────────────────────────────────────────────────────────────

function ParlayCard({ parlay, accent }: { parlay: AIParlay; accent: string }) {
  const [open, setOpen] = useState(false);

  const shareText = () => {
    const legs = parlay.legs.map((l, i) =>
      `  ${i + 1}. ${l.player ? `${l.player} — ` : ""}${l.pick} (${fmtOdds(l.odds)}) via ${l.bookmaker}`
    ).join("\n");
    const text = `🎯 ${parlay.name}\n${fmtOdds(parlay.combinedOdds)} combined odds\n\n${legs}\n\nGenerated by BJ's Pro Picks`;
    if (navigator.share) {
      navigator.share({ title: parlay.name, text }).catch(() => {});
    } else {
      navigator.clipboard.writeText(text).catch(() => {});
    }
  };

  return (
    <div className="rounded-2xl border bg-card overflow-hidden" style={{ borderColor: accent + "44" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: accent + "22", backgroundColor: accent + "0d" }}>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold px-2 py-0.5 rounded border" style={{ color: accent, backgroundColor: accent + "22", borderColor: accent + "55" }}>
            {parlay.legs.length}-Leg Parlay
          </span>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold font-mono tabular-nums" style={{ color: accent }}>
            {fmtOdds(parlay.combinedOdds)}
          </p>
        </div>
      </div>

      {/* Name + payout */}
      <div className="px-4 py-2.5 border-b border-border">
        <p className="text-sm font-semibold">{parlay.name}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{combinedOddsPayout(parlay.combinedOdds)}</p>
      </div>

      {/* Legs */}
      <div className="divide-y divide-border">
        {parlay.legs.map((leg: AIPickLeg, i: number) => (
          <div key={i} className="flex items-center gap-3 px-4 py-2.5">
            <div className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: sportDotColor(leg.sport) }} />
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

      {/* Confidence + reasoning toggle */}
      <div className="px-4 py-2.5 border-t border-border">
        <div className="flex items-center gap-3">
          <div className="flex-1 h-1.5 rounded-full bg-border overflow-hidden">
            <div className={cn("h-full rounded-full", confidenceBg(parlay.confidence))} style={{ width: `${parlay.confidence}%` }} />
          </div>
          <span className={cn("text-xs font-bold tabular-nums", confidenceColor(parlay.confidence))}>
            {parlay.confidence}%
          </span>
          <button onClick={() => setOpen((v) => !v)} className="text-xs text-muted-foreground hover:text-foreground transition-colors ml-1">
            {open ? "Hide ▲" : "Why? ▼"}
          </button>
        </div>
        {open && (
          <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{parlay.reasoning}</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 px-4 pb-4 pt-1">
        <button
          onClick={shareText}
          className="p-2 rounded-lg border text-xs font-semibold transition-colors hover:opacity-80"
          style={{ borderColor: accent + "55", color: accent }}
          title="Share parlay"
        >
          <Share2 className="h-3.5 w-3.5" />
        </button>
        <a
          href="https://www.draftkings.com"
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors hover:opacity-80"
          style={{ backgroundColor: accent, color: "#fff" }}
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Place Bet
        </a>
      </div>
    </div>
  );
}

// ─── Daily Ladder card ─────────────────────────────────────────────────────────

function DailyLadderCard({
  parlay,
  progress,
  onSettle,
  isSettling,
}: {
  parlay: AILadderParlay;
  progress: LadderProgress | undefined;
  onSettle: (won: boolean) => void;
  isSettling: boolean;
}) {
  const steps = parlay.steps ?? [];
  const today = steps[0];
  if (!today || !today.legs?.length) return null;

  const currentDay = progress?.currentDay ?? 1;
  const currentStake = progress?.currentStake ?? 10;
  const settled = progress?.settled ?? false;
  const result = progress?.result ?? null;

  const todayDecimal = today.legs.reduce((acc, l) => {
    return acc * (l.odds > 0 ? l.odds / 100 + 1 : 100 / Math.abs(l.odds) + 1);
  }, 1);
  const targetWin = currentStake * todayDecimal;
  const todayCombined = calcCombinedOdds(today.legs);
  const TOTAL_DAYS = parlay.totalDays ?? steps.length;
  const ACCENT = LADDER_ACCENT;

  return (
    <div className="rounded-2xl border bg-card overflow-hidden" style={{ borderColor: ACCENT + "44" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: ACCENT + "22", backgroundColor: ACCENT + "0d" }}>
        <span className="text-xs font-bold px-2 py-0.5 rounded border" style={{ color: ACCENT, backgroundColor: ACCENT + "22", borderColor: ACCENT + "55" }}>
          Daily Ladder
        </span>
        <span className="text-xs text-muted-foreground">
          Day {currentDay} of {TOTAL_DAYS} · ${parlay.startStake} → ${parlay.targetPayout.toLocaleString()}
        </span>
      </div>

      {/* Streak dots */}
      <div className="px-4 py-3 overflow-x-auto">
        <div className="flex gap-2 min-w-max">
          {Array.from({ length: TOTAL_DAYS }, (_, i) => i + 1).map((d) => {
            const isPast = d < currentDay;
            const isCurrent = d === currentDay;
            const bg = isPast ? "#22c55e" : isCurrent ? ACCENT : "transparent";
            const border = isPast ? "#22c55e" : isCurrent ? ACCENT : "#374151";
            return (
              <div key={d} className="flex flex-col items-center gap-1">
                <div
                  className="h-8 w-8 rounded-full flex items-center justify-center border-2 text-xs font-bold"
                  style={{ backgroundColor: bg, borderColor: border, color: isPast || isCurrent ? "#fff" : "#6b7280" }}
                >
                  {isPast ? <Check className="h-3.5 w-3.5" /> : d}
                </div>
                <span className="text-[9px] font-medium" style={{ color: isCurrent ? ACCENT : "transparent" }}>
                  {isCurrent ? fmtMoney(targetWin) : "."}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Result banner */}
      {settled && result === "won" && (
        <div className="mx-4 mb-3 flex items-center gap-2 px-3 py-2.5 rounded-lg border" style={{ backgroundColor: "#22c55e18", borderColor: "#22c55e55" }}>
          <Check className="h-4 w-4 text-green-400 flex-shrink-0" />
          <p className="text-xs font-medium text-green-400">Won! Day {currentDay} unlocked — roll ${currentStake.toFixed(0)} tomorrow.</p>
        </div>
      )}
      {settled && result === "lost" && (
        <div className="mx-4 mb-3 flex items-center gap-2 px-3 py-2.5 rounded-lg border" style={{ backgroundColor: "#ef444418", borderColor: "#ef444455" }}>
          <X className="h-4 w-4 text-red-400 flex-shrink-0" />
          <p className="text-xs font-medium text-red-400">Lost. Reset to Day 1 — come back tomorrow with $10.</p>
        </div>
      )}

      {/* Today's bet */}
      <div className="mx-4 mb-4 rounded-xl border p-3" style={{ backgroundColor: ACCENT + "12", borderColor: ACCENT + "40" }}>
        <p className="text-[10px] font-bold tracking-wider mb-2" style={{ color: ACCENT }}>TODAY'S 2-LEG PARLAY</p>
        <div className="space-y-2 mb-3">
          {today.legs.map((leg, li) => (
            <div key={li} className="flex items-center gap-2.5">
              <div
                className="h-5 w-5 rounded flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-white"
                style={{ backgroundColor: li === 0 ? ACCENT : ACCENT + "80" }}
              >
                {li + 1}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{leg.pick}</p>
                <p className="text-[10px] text-muted-foreground truncate">
                  {leg.awayTeam && leg.homeTeam ? `${leg.awayTeam} @ ${leg.homeTeam}` : leg.homeTeam || "Today's game"} · {leg.bookmaker}
                </p>
              </div>
              <span className="text-xs font-bold font-mono px-2 py-0.5 rounded border" style={{ color: ACCENT, backgroundColor: ACCENT + "22", borderColor: ACCENT + "55" }}>
                {fmtOdds(leg.odds)}
              </span>
            </div>
          ))}
        </div>

        {/* Stake → Win */}
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1 bg-background rounded-lg px-3 py-2 text-center">
            <p className="text-[10px] text-muted-foreground">Bet</p>
            <p className="text-sm font-bold">${currentStake.toFixed(0)}</p>
          </div>
          <ArrowRight className="h-4 w-4 flex-shrink-0" style={{ color: ACCENT }} />
          <div className="flex-1 bg-background rounded-lg px-3 py-2 text-center">
            <p className="text-[10px] text-muted-foreground">Win</p>
            <p className="text-sm font-bold" style={{ color: ACCENT }}>${targetWin.toFixed(0)}</p>
          </div>
          <span className="text-xs font-bold font-mono px-2 py-1 rounded border" style={{ color: ACCENT, backgroundColor: ACCENT + "22", borderColor: ACCENT + "55" }}>
            {fmtOdds(todayCombined)}
          </span>
        </div>

        <a
          href="https://www.draftkings.com"
          target="_blank"
          rel="noopener noreferrer"
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold transition-colors hover:opacity-90"
          style={{ backgroundColor: ACCENT, color: "#fff" }}
        >
          <ExternalLink className="h-4 w-4" />
          Place Today's 2-Leg Bet
        </a>
      </div>

      {/* Settlement */}
      {!settled && (
        <div className="px-4 pb-4">
          <p className="text-xs text-muted-foreground mb-2 text-center">Did today's bet win?</p>
          <div className="flex gap-2">
            <button
              onClick={() => onSettle(true)}
              disabled={isSettling}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-semibold transition-colors hover:opacity-80 disabled:opacity-50"
              style={{ backgroundColor: "#22c55e22", borderColor: "#22c55e66", color: "#22c55e" }}
            >
              <Check className="h-4 w-4" /> Won
            </button>
            <button
              onClick={() => onSettle(false)}
              disabled={isSettling}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-semibold transition-colors hover:opacity-80 disabled:opacity-50"
              style={{ backgroundColor: "#ef444422", borderColor: "#ef444466", color: "#ef4444" }}
            >
              <X className="h-4 w-4" /> Lost
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Divider ───────────────────────────────────────────────────────────────────

function Divider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="flex-1 h-px bg-border" />
      <span className="text-[10px] font-bold tracking-widest text-muted-foreground">{label}</span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function TodayPage() {
  const [selectedSport, setSelectedSport] = useState<SportKey>("all");
  const queryClient = useQueryClient();

  // All-sports data — cross-sport parlays for All Sports tab
  const {
    data: allData,
    isLoading: allLoading,
    isFetching: allFetching,
    refetch: refetchAll,
  } = useGetAiPicks(
    undefined,
    { query: { staleTime: 15 * 60_000, gcTime: 15 * 60_000, refetchOnMount: true, refetchOnWindowFocus: false } as any },
  );

  // Sport-specific data — lazy-loaded per sport tab
  const {
    data: sportData,
    isLoading: sportLoading,
    isFetching: sportFetching,
    refetch: refetchSport,
  } = useGetAiPicks(
    selectedSport !== "all" ? { sport: selectedSport } : undefined,
    {
      query: {
        enabled: selectedSport !== "all",
        staleTime: 15 * 60_000,
        gcTime: 15 * 60_000,
        refetchOnMount: true,
        refetchOnWindowFocus: false,
      } as any,
    },
  );

  const isLoading = selectedSport === "all" ? allLoading : (allLoading || sportLoading);
  const isFetching = selectedSport === "all" ? allFetching : (allFetching || sportFetching);

  const { mutate: doRefresh, isPending: isRefreshing } = useRefreshAiPicks();

  // Ladder
  const { data: ladderProgress, refetch: refetchProgress } = useGetLadderProgress(
    { sport: selectedSport },
    { query: { staleTime: 0, refetchOnMount: true, refetchOnWindowFocus: false } as any },
  );
  const { mutate: settleLadder, isPending: isSettling } = useSettleLadder();

  function handleSettle(won: boolean) {
    const step = activeLadder?.steps?.[0];
    if (!step) return;
    const stake = ladderProgress?.currentStake ?? 10;
    const decimal = step.legs.reduce((acc: number, l: AIPickLeg) => {
      return acc * (l.odds > 0 ? l.odds / 100 + 1 : 100 / Math.abs(l.odds) + 1);
    }, 1);
    const payout = parseFloat((stake * decimal).toFixed(2));
    settleLadder(
      { data: { sport: selectedSport, won, payout: won ? payout : 0 } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetLadderProgressQueryKey({ sport: selectedSport }) });
          refetchProgress();
        },
      },
    );
  }

  function handleRefresh() {
    doRefresh(undefined, {
      onSettled: () => {
        refetchAll();
        if (selectedSport !== "all") refetchSport();
      },
    });
  }

  // Parlay mapping
  const isAllTab = selectedSport === "all";
  const lock        = isAllTab ? (allData?.lockOfTheDay ?? null)      : (sportData?.lockOfTheDay       ?? null);
  const safeParlay  = isAllTab ? (allData?.allSafeParlay  ?? null)    : (sportData?.safeParlay          ?? null);
  const lottoParlay = isAllTab ? (allData?.allLottoParlay  ?? null)   : (sportData?.lottoParlay         ?? null);
  const gameParlay  = isAllTab ? (allData?.allGameParlay   ?? null)   : (sportData?.gameParlayOfTheDay  ?? null);
  const propParlay  = isAllTab ? (allData?.allPropsParlay  ?? null)   : (sportData?.propParlayOfTheDay  ?? null);
  const mixParlay   = isAllTab ? (allData?.allMixParlay    ?? null)   : (sportData?.mixParlayOfTheDay   ?? null);

  const hrParlay         = sportData?.hrParlay         ?? allData?.hrParlay         ?? null;
  const goalScorerParlay = sportData?.goalScorerParlay ?? allData?.goalScorerParlay ?? null;
  const threePtParlay    = sportData?.threePtParlay    ?? allData?.threePtParlay    ?? null;
  const tdParlay         = sportData?.tdParlay         ?? allData?.tdParlay         ?? null;

  // Ladders
  const allLadder = (allData?.allLadder ?? null) as AILadderParlay | null;
  const nbaLadder = (allData?.nbaLadder ?? null) as AILadderParlay | null;
  const mlbLadder = (allData?.mlbLadder ?? null) as AILadderParlay | null;
  const nhlLadder = (allData?.nhlLadder ?? null) as AILadderParlay | null;
  const nflLadder = (allData?.nflLadder ?? null) as AILadderParlay | null;
  const isAI = allData?.isAI ?? false;

  const activeLadder =
    selectedSport === "all" ? allLadder :
    selectedSport === "NBA" ? nbaLadder :
    selectedSport === "MLB" ? mlbLadder :
    selectedSport === "NHL" ? nhlLadder :
    selectedSport === "NFL" ? nflLadder : null;

  const ladderSportLabel =
    selectedSport === "all" ? "All Sports" : selectedSport;

  const isNflOffSeason = selectedSport === "NFL" && !NFL_SEASON_ACTIVE;

  return (
    <div className="p-4 md:p-6 space-y-5 pb-20 md:pb-8">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Today's Picks</h1>
          {allData?.generatedAt && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Updated {new Date(allData.generatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
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
            onClick={() => setSelectedSport(tab.key)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors",
              selectedSport === tab.key
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
      {allData?.summary && (
        <div className="bg-card border border-border rounded-lg px-4 py-3 flex items-start gap-3">
          <div className={cn(
            "flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-semibold border flex-shrink-0",
            isAI ? "bg-primary/10 text-primary border-primary/20" : "bg-muted text-muted-foreground border-border"
          )}>
            <Cpu className="h-3 w-3" />
            {isAI ? "AI" : "Model"}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{allData.summary}</p>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-64" />
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      ) : isNflOffSeason ? (
        /* ── NFL off-season ── */
        <div className="space-y-5">
          <Divider label="NFL PICKS" />
          <EmptyCard>🏈 NFL season starts in September. Check back then for NFL-specific picks.</EmptyCard>
          <Divider label="DAILY LADDER · $10 → $10K" />
          <div>
            <SectionHeader icon={Trophy} label="NFL Daily Ladder" sublabel="Win today's bet → roll winnings to tomorrow" accent={LADDER_ACCENT} />
            <EmptyCard>NFL ladder available during the season (September–February).</EmptyCard>
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Lock of the Day */}
          <div>
            <SectionHeader icon={Lock} label="Lock of the Day" sublabel="Highest confidence single pick" accent="#f59e0b" />
            {lock ? <LockCard pick={lock} /> : <EmptyCard>No lock available — try refreshing.</EmptyCard>}
          </div>

          {/* Safe Parlay */}
          <div>
            <SectionHeader icon={Zap} label="Safe Parlay of the Day" sublabel="2–3 legs, solid value (+175 to +500)" accent="#22c55e" />
            {(safeParlay?.legs?.length ?? 0) > 0
              ? <ParlayCard parlay={safeParlay!} accent="#22c55e" />
              : <EmptyCard>No safe parlay — try refreshing.</EmptyCard>
            }
          </div>

          {/* Lotto Parlay */}
          <div>
            <SectionHeader icon={Dices} label="Lotto Parlay of the Day" sublabel="4–6 legs, big payout (+800 to +3000)" accent="#a855f7" />
            {(lottoParlay?.legs?.length ?? 0) > 0
              ? <ParlayCard parlay={lottoParlay!} accent="#a855f7" />
              : <EmptyCard>No lotto parlay — try refreshing.</EmptyCard>
            }
          </div>

          {/* Game Parlay */}
          <div>
            <SectionHeader icon={Trophy} label="Game Picks Parlay" sublabel="Moneyline, spread & O/U only — no props" accent="#3b82f6" />
            {(gameParlay?.legs?.length ?? 0) > 0
              ? <ParlayCard parlay={gameParlay!} accent="#3b82f6" />
              : <EmptyCard>No game parlay — try refreshing.</EmptyCard>
            }
          </div>

          {/* Props Parlay */}
          <div>
            <SectionHeader icon={Target} label="Player Props Parlay" sublabel="All player performance props" accent="#f97316" />
            {(propParlay?.legs?.length ?? 0) > 0
              ? <ParlayCard parlay={propParlay!} accent="#f97316" />
              : <EmptyCard>No props parlay — try refreshing.</EmptyCard>
            }
          </div>

          {/* Mix Parlay */}
          <div>
            <SectionHeader icon={Shuffle} label="Mix Parlay" sublabel="Game bets + player props combined" accent="#14b8a6" />
            {(mixParlay?.legs?.length ?? 0) > 0
              ? <ParlayCard parlay={mixParlay!} accent="#14b8a6" />
              : <EmptyCard>No mix parlay — try refreshing.</EmptyCard>
            }
          </div>

          {/* Sport-specific prop parlays */}
          {selectedSport !== "all" && (
            <>
              <Divider label={`${selectedSport} PROP PARLAYS`} />

              {selectedSport === "NBA" && (
                <div>
                  <SectionHeader icon={Target} label="NBA 3-Pointer Parlay" sublabel="Volume shooters from deep" accent="#f97316" />
                  {(threePtParlay?.legs?.length ?? 0) > 0
                    ? <ParlayCard parlay={threePtParlay!} accent="#f97316" />
                    : <EmptyCard>No 3PT parlay — check back on NBA game days.</EmptyCard>
                  }
                </div>
              )}

              {selectedSport === "MLB" && (
                <div>
                  <SectionHeader icon={TrendingUp} label="MLB Home Run Parlay" sublabel="Multi-HR bomber parlay · high variance" accent="#3b82f6" />
                  {(hrParlay?.legs?.length ?? 0) > 0
                    ? <ParlayCard parlay={hrParlay!} accent="#3b82f6" />
                    : <EmptyCard>Home run prop odds haven't been posted yet — check back closer to first pitch.</EmptyCard>
                  }
                </div>
              )}

              {selectedSport === "NHL" && (
                <div>
                  <SectionHeader icon={Target} label="NHL Points Parlay" sublabel="Anytime goal or assist combo" accent="#8b5cf6" />
                  {(goalScorerParlay?.legs?.length ?? 0) > 0
                    ? <ParlayCard parlay={goalScorerParlay!} accent="#8b5cf6" />
                    : <EmptyCard>No goal scorer parlay — check back on NHL game days.</EmptyCard>
                  }
                </div>
              )}

              {selectedSport === "NFL" && NFL_SEASON_ACTIVE && (
                <div>
                  <SectionHeader icon={Target} label="NFL TD Scorer Parlay" sublabel="Anytime touchdown combo" accent="#22c55e" />
                  {(tdParlay?.legs?.length ?? 0) > 0
                    ? <ParlayCard parlay={tdParlay!} accent="#22c55e" />
                    : <EmptyCard>No TD parlay — check back on NFL game days.</EmptyCard>
                  }
                </div>
              )}
            </>
          )}

          {/* Daily Ladder */}
          <Divider label="DAILY LADDER · $10 → $10K" />
          <div>
            <SectionHeader icon={TrendingUp} label={`${ladderSportLabel} Daily Ladder`} sublabel="Win today's bet → roll winnings to tomorrow" accent={LADDER_ACCENT} />
            {activeLadder && (activeLadder.steps?.length ?? 0) >= 1
              ? (
                <DailyLadderCard
                  parlay={activeLadder}
                  progress={ladderProgress}
                  onSettle={handleSettle}
                  isSettling={isSettling}
                />
              )
              : (
                <EmptyCard>
                  {selectedSport === "NFL" && !NFL_SEASON_ACTIVE
                    ? "NFL ladder available during the season (September–February)."
                    : `No ${ladderSportLabel} ladder today — try refreshing.`}
                </EmptyCard>
              )
            }
          </div>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground text-center">
        For entertainment only. Bet responsibly. Past performance does not guarantee future results.
      </p>
    </div>
  );
}

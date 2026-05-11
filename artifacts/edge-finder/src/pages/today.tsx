import { useState, useEffect } from "react";
import { Link } from "wouter";
import {
  useGetAiPicks,
  useRefreshAiPicks,
  useGetLadderProgress,
  useSettleLadder,
  getGetAiPicksQueryKey,
  getGetLadderProgressQueryKey,
  type LadderProgress,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  RefreshCw, Lock, Zap, Dices, Trophy, Shuffle, Target,
  TrendingUp, Cpu, Share2, ExternalLink, AlertTriangle,
  Check, X, ArrowRight, ChevronDown, ChevronUp, BookOpen,
  BookMarked, ClipboardCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AIPick, AIParlay, AIPickLeg, AILadderParlay } from "@workspace/api-client-react";

// ─── Constants ─────────────────────────────────────────────────────────────────

const NFL_SEASON_ACTIVE = (() => {
  const m = new Date().getMonth() + 1;
  return m >= 8 || m <= 2;
})();

// Ordered list of all possible sport tabs — shown only when that sport is active today
const ALL_POSSIBLE_TABS = [
  { key: "all",     label: "All Sports", emoji: "🌐" },
  { key: "NBA",     label: "NBA",        emoji: "🏀" },
  { key: "MLB",     label: "MLB",        emoji: "⚾" },
  { key: "NHL",     label: "NHL",        emoji: "🏒" },
  { key: "NFL",     label: "NFL",        emoji: "🏈" },
  { key: "NCAAB",   label: "NCAAB",      emoji: "🎓" },
  { key: "NCAAF",   label: "NCAAF",      emoji: "🎓" },
  { key: "NCAABSB", label: "NCAABSB",    emoji: "🥎" },
  { key: "WNBA",    label: "WNBA",       emoji: "🏀" },
  { key: "Soccer",  label: "Soccer",     emoji: "⚽" },
  { key: "MMA",     label: "MMA",        emoji: "🥊" },
  { key: "Boxing",  label: "Boxing",     emoji: "🥊" },
  { key: "Tennis",  label: "Tennis",     emoji: "🎾" },
  { key: "Golf",    label: "Golf",       emoji: "⛳" },
];

type SportKey = string;

const LADDER_ACCENT = "#10b981";

// ─── Sportsbooks ───────────────────────────────────────────────────────────────

interface Sportsbook {
  name: string;
  color: string;
  getUrl: (sport?: SportKey) => string;
}

const SPORTSBOOKS_LIST: Sportsbook[] = [
  {
    name: "DraftKings",
    color: "#53D16A",
    getUrl: (sport) => {
      const paths: Record<string, string> = {
        NBA: "https://sportsbook.draftkings.com/leagues/basketball/nba",
        NFL: "https://sportsbook.draftkings.com/leagues/football/nfl",
        MLB: "https://sportsbook.draftkings.com/leagues/baseball/mlb",
        NHL: "https://sportsbook.draftkings.com/leagues/hockey/nhl",
      };
      return paths[sport ?? ""] ?? "https://sportsbook.draftkings.com/";
    },
  },
  {
    name: "FanDuel",
    color: "#1493FF",
    getUrl: (sport) => {
      const paths: Record<string, string> = {
        NBA: "https://sportsbook.fanduel.com/basketball/nba",
        NFL: "https://sportsbook.fanduel.com/football/nfl",
        MLB: "https://sportsbook.fanduel.com/baseball/mlb",
        NHL: "https://sportsbook.fanduel.com/hockey/nhl",
      };
      return paths[sport ?? ""] ?? "https://sportsbook.fanduel.com/";
    },
  },
  {
    name: "BetMGM",
    color: "#C9A84C",
    getUrl: (sport) => {
      const paths: Record<string, string> = {
        NBA: "https://sports.betmgm.com/en/sports/basketball-7/betting/usa-9/nba-6004",
        NFL: "https://sports.betmgm.com/en/sports/football-11/betting/usa-9/nfl-35",
        MLB: "https://sports.betmgm.com/en/sports/baseball-23/betting/usa-9/mlb-75",
        NHL: "https://sports.betmgm.com/en/sports/hockey-12/betting/usa-9/nhl-41",
      };
      return paths[sport ?? ""] ?? "https://sports.betmgm.com/en/sports";
    },
  },
  {
    name: "Caesars",
    color: "#003087",
    getUrl: (sport) => {
      const paths: Record<string, string> = {
        NBA: "https://www.caesars.com/sportsbook-and-casino/sport/basketball",
        NFL: "https://www.caesars.com/sportsbook-and-casino/sport/football",
        MLB: "https://www.caesars.com/sportsbook-and-casino/sport/baseball",
        NHL: "https://www.caesars.com/sportsbook-and-casino/sport/hockey",
      };
      return paths[sport ?? ""] ?? "https://www.caesars.com/sportsbook-and-casino";
    },
  },
  {
    name: "BetRivers",
    color: "#E4002B",
    getUrl: () => "https://www.betrivers.com/",
  },
  {
    name: "Bovada",
    color: "#FF6900",
    getUrl: (sport) => {
      const paths: Record<string, string> = {
        NBA: "https://www.bovada.lv/sports/basketball/nba",
        NFL: "https://www.bovada.lv/sports/football/nfl",
        MLB: "https://www.bovada.lv/sports/baseball/mlb",
        NHL: "https://www.bovada.lv/sports/hockey/nhl",
      };
      return paths[sport ?? ""] ?? "https://www.bovada.lv/sports";
    },
  },
  {
    name: "BetOnline",
    color: "#4CAF50",
    getUrl: () => "https://www.betonline.ag/sportsbook",
  },
  {
    name: "ESPN Bet",
    color: "#CC0000",
    getUrl: () => "https://www.espnbet.com",
  },
];

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

function sportBadgeClass(sport: string) {
  const map: Record<string, string> = {
    NBA:    "bg-orange-500/10 text-orange-400 border-orange-500/20",
    MLB:    "bg-blue-500/10 text-blue-400 border-blue-500/20",
    NHL:    "bg-violet-500/10 text-violet-400 border-violet-500/20",
    NFL:    "bg-green-500/10 text-green-400 border-green-500/20",
    Tennis: "bg-pink-500/10 text-pink-400 border-pink-500/20",
    Golf:   "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    Soccer: "bg-teal-500/10 text-teal-400 border-teal-500/20",
    MMA:    "bg-red-500/10 text-red-400 border-red-500/20",
    Boxing: "bg-red-500/10 text-red-400 border-red-500/20",
  };
  return map[sport] ?? "bg-muted text-muted-foreground border-border";
}

function sportDotColor(sport: string) {
  const map: Record<string, string> = {
    NBA: "#f97316", MLB: "#3b82f6", NHL: "#8b5cf6", NFL: "#22c55e",
    Tennis: "#ec4899", Golf: "#10b981", Soccer: "#14b8a6",
    MMA: "#ef4444", Boxing: "#ef4444",
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

// ─── Generic Bookmaker Modal ────────────────────────────────────────────────────
// Mirrors the mobile BookmakerSheet — shows all sportsbooks sorted by preferred first,
// auto-copies the pick to clipboard, lets the user choose where to place the bet.

type BookmakerBet = {
  matchup: string;
  pick: string;
  odds: number;
  sport?: string;
  preferredBookmaker?: string;
};

function BookmakerModal({ bet, onClose }: { bet: BookmakerBet | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  const oddsStr = bet ? fmtOdds(bet.odds) : "";
  const pickText = bet ? `${bet.matchup} — ${bet.pick} (${oddsStr})` : "";

  useEffect(() => {
    if (!bet) return;
    navigator.clipboard.writeText(pickText).then(() => {
      setCopied(true);
      const t = setTimeout(() => setCopied(false), 3000);
      return () => clearTimeout(t);
    }).catch(() => {});
  }, [bet, pickText]);

  if (!bet) return null;

  const sortedBooks = [...SPORTSBOOKS_LIST].sort((a, b) => {
    const pref = bet.preferredBookmaker?.toLowerCase() ?? "";
    const aMatch = a.name.toLowerCase() === pref ? -1 : 0;
    const bMatch = b.name.toLowerCase() === pref ? 1 : 0;
    return aMatch + bMatch;
  });

  const preferredBook = sortedBooks[0];
  const otherBooks = sortedBooks.slice(1);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-background border border-border rounded-t-2xl sm:rounded-2xl w-full max-w-md overflow-hidden max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="w-9 h-1 rounded-full bg-border self-center mt-3 mb-0 flex-shrink-0" />

        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-4 pb-3 flex-shrink-0">
          <div>
            <p className="text-lg font-semibold">Place Your Bet</p>
            <p className="text-xs text-muted-foreground mt-0.5">Pick is copied — just open your book and search</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors mt-0.5">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Bet summary */}
        <div className="mx-5 mb-3 bg-card border border-border rounded-xl p-3 flex-shrink-0">
          <p className="text-sm font-semibold truncate">{bet.matchup}</p>
          <div className="flex items-start justify-between gap-2 mt-1">
            <p className="text-sm font-medium flex-1 leading-snug">{bet.pick}</p>
            <p className="text-lg font-bold text-primary flex-shrink-0">{oddsStr}</p>
          </div>
          <div className={cn(
            "flex items-center gap-2 mt-2 px-2.5 py-1.5 rounded-lg border text-xs font-medium",
            copied
              ? "bg-primary/10 border-primary/30 text-primary"
              : "bg-muted border-border text-muted-foreground"
          )}>
            {copied
              ? <Check className="h-3.5 w-3.5 flex-shrink-0" />
              : <ClipboardCheck className="h-3.5 w-3.5 flex-shrink-0" />
            }
            {copied ? "Pick copied to clipboard!" : "Copying pick…"}
          </div>
        </div>

        {/* Preferred sportsbook — big CTA */}
        <div className="px-5 flex-shrink-0">
          <p className="text-xs text-muted-foreground mb-2">Best odds found at</p>
          <a
            href={preferredBook.getUrl(bet.sport)}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center justify-between px-4 py-3.5 rounded-xl mb-1"
            style={{ backgroundColor: preferredBook.color }}
            onClick={onClose}
          >
            <div className="flex items-center gap-2.5">
              <div className="h-3 w-3 rounded-full bg-white/35" />
              <span className="text-base font-bold text-white">{preferredBook.name}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold text-white">Open &amp; Bet</span>
              <ExternalLink className="h-4 w-4 text-white" />
            </div>
          </a>
        </div>

        {/* Other sportsbooks */}
        <div className="px-5 flex-1 overflow-y-auto py-3">
          <p className="text-xs text-muted-foreground mb-2">Or choose another sportsbook</p>
          <div className="space-y-2">
            {otherBooks.map((sb) => (
              <a
                key={sb.name}
                href={sb.getUrl(bet.sport)}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center gap-2.5 px-3.5 py-3 rounded-xl border border-border bg-card hover:bg-muted/50 transition-colors"
                onClick={onClose}
              >
                <div className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: sb.color }} />
                <span className="text-sm font-medium flex-1">{sb.name}</span>
                <ExternalLink className="h-4 w-4 text-muted-foreground" />
              </a>
            ))}
          </div>
        </div>

        <div className="h-4 flex-shrink-0" />
      </div>
    </div>
  );
}

// ─── Lock of the Day card ──────────────────────────────────────────────────────

function LockCard({
  pick,
  onTrack,
  onLog,
  onBet,
}: {
  pick: AIPick;
  onTrack: () => void;
  onLog: () => void;
  onBet: () => void;
}) {
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
        </div>
      </div>

      {/* Confidence bar */}
      {pick.confidence != null && (
        <div className="flex items-center gap-3 px-4 pb-2">
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{ width: `${pick.confidence * 100}%`, backgroundColor: GOLD }}
            />
          </div>
          <span className="text-[11px] font-semibold" style={{ color: GOLD }}>
            {Math.round((pick.confidence ?? 0) * 100)}% confidence · {impliedProb(pick.odds)} implied
          </span>
        </div>
      )}

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

      {/* Actions — Track | Log Bet | Place Bet (mirrors mobile 3-button layout) */}
      <div className="flex items-center gap-2 px-4 pb-4">
        <button
          onClick={onTrack}
          className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold transition-colors hover:opacity-80"
          style={{ borderColor: GOLD + "66", color: GOLD }}
        >
          <BookMarked className="h-3.5 w-3.5" />
          Track
        </button>
        <button
          onClick={onLog}
          className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold transition-colors hover:opacity-80"
          style={{ borderColor: GOLD + "66", color: GOLD }}
        >
          <BookOpen className="h-3.5 w-3.5" />
          Log Bet
        </button>
        <button
          onClick={onBet}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors hover:opacity-80"
          style={{ backgroundColor: GOLD, color: "#000" }}
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Place Bet
        </button>
      </div>
    </div>
  );
}

// ─── Parlay card ───────────────────────────────────────────────────────────────

function ParlayCard({
  parlay,
  accent,
  onBet,
  onLog,
}: {
  parlay: AIParlay;
  accent: string;
  onBet: () => void;
  onLog: () => void;
}) {
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
          <div key={i} className="flex items-start gap-3 px-4 py-2.5">
            <div className="h-2 w-2 rounded-full flex-shrink-0 mt-1.5" style={{ backgroundColor: sportDotColor(leg.sport) }} />
            <div className="flex-1 min-w-0">
              <p className="text-[10px] text-muted-foreground leading-snug">
                {leg.awayTeam && leg.homeTeam ? `${leg.awayTeam} @ ${leg.homeTeam}` : leg.homeTeam || "Today's game"}
              </p>
              <p className="text-sm font-semibold leading-snug">
                {leg.player && !leg.pick.toLowerCase().includes(leg.player.toLowerCase())
                  ? `${leg.player} ${leg.pick}`
                  : leg.pick}
              </p>
            </div>
            <div className="flex-shrink-0 text-right pt-0.5">
              <p className="text-sm font-bold font-mono" style={{ color: accent }}>{fmtOdds(leg.odds)}</p>
              <p className="text-[10px] text-muted-foreground">{formatTime(leg.startTime)}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Reasoning toggle */}
      <div className="px-4 py-2.5 border-t border-border">
        <div className="flex items-center gap-3">
          <button onClick={() => setOpen((v) => !v)} className="text-xs text-muted-foreground hover:text-foreground transition-colors ml-1">
            {open ? "Hide ▲" : "Why? ▼"}
          </button>
        </div>
        {open && (
          <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{parlay.reasoning}</p>
        )}
      </div>

      {/* Actions — Share | Log Bet | Place Bet */}
      <div className="flex items-center gap-2 px-4 pb-4 pt-1">
        <button
          onClick={shareText}
          className="p-2 rounded-lg border text-xs font-semibold transition-colors hover:opacity-80"
          style={{ borderColor: accent + "55", color: accent }}
          title="Share parlay"
        >
          <Share2 className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onLog}
          className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold transition-colors hover:opacity-80"
          style={{ borderColor: accent + "55", color: accent }}
        >
          <BookOpen className="h-3.5 w-3.5" />
          Log Bet
        </button>
        <button
          onClick={onBet}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors hover:opacity-80"
          style={{ backgroundColor: accent, color: "#fff" }}
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Place Bet
        </button>
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
  onPlaceBet,
  onLog,
}: {
  parlay: AILadderParlay;
  progress: LadderProgress | undefined;
  onSettle: (won: boolean) => void;
  isSettling: boolean;
  onPlaceBet: () => void;
  onLog: () => void;
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
            <div key={li} className="flex items-start gap-2.5">
              <div
                className="h-5 w-5 rounded flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-white mt-0.5"
                style={{ backgroundColor: li === 0 ? ACCENT : ACCENT + "80" }}
              >
                {li + 1}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold leading-snug">{leg.pick}</p>
                <p className="text-[10px] text-muted-foreground leading-snug">
                  {leg.awayTeam && leg.homeTeam ? `${leg.awayTeam} @ ${leg.homeTeam}` : leg.homeTeam || "Today's game"} · {leg.bookmaker}
                </p>
              </div>
              <div className="flex-shrink-0 flex flex-col items-end gap-0.5 mt-0.5">
                <span className="text-xs font-bold font-mono px-2 py-0.5 rounded border" style={{ color: ACCENT, backgroundColor: ACCENT + "22", borderColor: ACCENT + "55" }}>
                  {fmtOdds(leg.odds)}
                </span>
                <span className="text-[10px] text-muted-foreground">{formatTime(leg.startTime)}</span>
              </div>
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

        <button
          onClick={onPlaceBet}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold transition-colors hover:opacity-90"
          style={{ backgroundColor: ACCENT, color: "#fff" }}
        >
          <ExternalLink className="h-4 w-4" />
          Place Today's 2-Leg Bet
        </button>
      </div>

      {/* Settlement */}
      {!settled && (
        <div className="px-4 pb-3">
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

      {/* Bottom actions — Log Bet | Place Bet (mirrors mobile DailyLadderCard bottom row) */}
      <div className="flex items-center gap-2 px-4 pb-4 pt-2 border-t border-border mt-1">
        <button
          onClick={onLog}
          className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold transition-colors hover:opacity-80 flex-1"
          style={{ borderColor: ACCENT + "55", color: ACCENT }}
        >
          <BookOpen className="h-3.5 w-3.5" />
          Log Bet
        </button>
        <button
          onClick={onPlaceBet}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors hover:opacity-80"
          style={{ backgroundColor: ACCENT, color: "#fff" }}
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Place Bet
        </button>
      </div>
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
  const [bookmakerBet, setBookmakerBet] = useState<BookmakerBet | null>(null);
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

  // Auto-refresh banner
  const [autoRefreshedBanner, setAutoRefreshedBanner] = useState(false);
  const autoRefreshedFlag = (allData as any)?.autoRefreshed as boolean | undefined;
  useEffect(() => {
    if (!autoRefreshedFlag) return;
    setAutoRefreshedBanner(true);
    const t = setTimeout(() => setAutoRefreshedBanner(false), 15_000);
    return () => clearTimeout(t);
  }, [autoRefreshedFlag]);

  function handleRefresh() {
    doRefresh(undefined, {
      onSettled: () => {
        queryClient.invalidateQueries({ queryKey: getGetAiPicksQueryKey() });
      },
    });
  }

  // ── Bet action helpers (mirrors mobile openBet / openBetParlay) ──────────────

  function openBet(pick: AIPick | { awayTeam: string; homeTeam: string; pick: string; odds: number; bookmaker: string; sport?: string }) {
    setBookmakerBet({
      matchup: `${"awayTeam" in pick ? pick.awayTeam : (pick as any).awayTeam} @ ${"homeTeam" in pick ? pick.homeTeam : (pick as any).homeTeam}`,
      pick: pick.pick,
      odds: pick.odds,
      sport: (pick as any).sport,
      preferredBookmaker: pick.bookmaker,
    });
  }

  function openBetParlay(legs: AIPickLeg[]) {
    if (!legs.length) return;
    const combined = calcCombinedOdds(legs);
    const pickText = legs.map((l, i) => `Leg ${i + 1}: ${l.pick}`).join("  ·  ");
    setBookmakerBet({
      matchup: legs.length > 1 ? `${legs.length}-Leg Parlay` : `${legs[0].awayTeam} @ ${legs[0].homeTeam}`,
      pick: pickText,
      odds: combined,
      sport: legs[0]?.sport,
      preferredBookmaker: legs[0]?.bookmaker,
    });
  }

  function openBetForParlay(p: AIParlay) {
    setBookmakerBet({
      matchup: p.name,
      pick: p.legs.map((l, i) => `Leg ${i + 1}: ${l.pick}`).join("  ·  "),
      odds: p.combinedOdds,
      sport: p.legs[0]?.sport,
      preferredBookmaker: p.legs[0]?.bookmaker,
    });
  }

  // Log Bet — navigates to /tracker (web equivalent of mobile QuickAddModal)
  function logBetToTracker() {
    window.location.href = "/tracker";
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
  const allScorerParlay  = isAllTab ? ((allData as any)?.allScorerParlay ?? null) : null;

  // Ladders
  const allLadder    = (allData?.allLadder    ?? null) as AILadderParlay | null;
  const nbaLadder    = (sportData?.nbaLadder    ?? allData?.nbaLadder    ?? null) as AILadderParlay | null;
  const mlbLadder    = (sportData?.mlbLadder    ?? allData?.mlbLadder    ?? null) as AILadderParlay | null;
  const nhlLadder    = (sportData?.nhlLadder    ?? allData?.nhlLadder    ?? null) as AILadderParlay | null;
  const nflLadder    = (sportData?.nflLadder    ?? allData?.nflLadder    ?? null) as AILadderParlay | null;
  const wnbaLadder   = (sportData?.wnbaLadder   ?? allData?.wnbaLadder   ?? null) as AILadderParlay | null;
  const soccerLadder = (sportData?.soccerLadder ?? allData?.soccerLadder ?? null) as AILadderParlay | null;
  const isAI = allData?.isAI ?? false;

  // Individual sports (Tennis, Golf) and combat sports (MMA, Boxing) — hide Game Picks Parlay
  const INDIVIDUAL_SPORTS = new Set(["Tennis", "Golf"]);
  const COMBAT_SPORTS     = new Set(["MMA", "Boxing"]);
  // Match Picks shown for MMA/Boxing (as Fight Picks) and Tennis — NOT for Golf
  const MATCH_PICKS_SPORTS = new Set(["MMA", "Boxing", "Tennis"]);
  const isIndividualSport = INDIVIDUAL_SPORTS.has(selectedSport) || COMBAT_SPORTS.has(selectedSport);

  const noPicksForSport = !isAllTab && !isLoading && !lock && !safeParlay && !lottoParlay
    && (isIndividualSport || !gameParlay);

  const activeLadder =
    selectedSport === "all"    ? allLadder    :
    selectedSport === "NBA"    ? nbaLadder    :
    selectedSport === "MLB"    ? mlbLadder    :
    selectedSport === "NHL"    ? nhlLadder    :
    selectedSport === "NFL"    ? nflLadder    :
    selectedSport === "WNBA"   ? wnbaLadder   :
    selectedSport === "Soccer" ? soccerLadder :
    null;

  const ladderSportLabel =
    selectedSport === "all" ? "All Sports" : selectedSport;

  const isNflOffSeason = selectedSport === "NFL" && !NFL_SEASON_ACTIVE;

  // Sports where Props Parlay and Mix Parlay sections are shown.
  // All team sports are included; individual sports handle their own sections.
  const TEAM_SPORTS = new Set(["all", "NBA", "MLB", "NHL", "NFL", "NCAAB", "NCAAF", "NCAABSB", "WNBA", "Soccer"]);
  const hasSportProps  = TEAM_SPORTS.has(selectedSport);
  // Mix Parlay shown for team sports + non-Golf individual sports
  const hasMixParlay   = TEAM_SPORTS.has(selectedSport) || MATCH_PICKS_SPORTS.has(selectedSport);
  const hasSportLadder = activeLadder !== null;

  const activeSports = (allData as any)?.activeSports as string[] | undefined;
  // All active sports (team + individual) get their own tab.
  // The All Sports tab content is separately filtered to team sports only in the API.
  const sportTabs = activeSports
    ? ALL_POSSIBLE_TABS.filter((t) => t.key === "all" || activeSports.includes(t.key))
    : ALL_POSSIBLE_TABS.filter((t) => ["all", "NBA", "MLB", "NHL", "NFL"].includes(t.key));

  return (
    <div className="p-4 md:p-6 space-y-5 pb-20 md:pb-8">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold">Today's Picks</h1>
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border bg-primary/10 text-primary border-primary/20">v3.1</span>
          </div>
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

      {/* Auto-refresh banner */}
      {autoRefreshedBanner && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-xl border border-amber-500/30 bg-amber-500/10">
          <AlertTriangle className="h-4 w-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-amber-300 flex-1 leading-relaxed">
            Picks were automatically updated — a game was postponed or a player was ruled out. Fresh picks are now showing.
          </p>
          <button
            onClick={() => setAutoRefreshedBanner(false)}
            className="text-amber-400/60 hover:text-amber-400 transition-colors flex-shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Sport tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {sportTabs.map((tab) => (
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
        <div className="space-y-5">
          <Divider label="NFL PICKS" />
          <EmptyCard>🏈 NFL season starts in September. Check back then for NFL-specific picks.</EmptyCard>
          <Divider label="DAILY LADDER · $10 → $10K" />
          <div>
            <SectionHeader icon={Trophy} label="NFL Daily Ladder" sublabel="Win today's bet → roll winnings to tomorrow" accent={LADDER_ACCENT} />
            <EmptyCard>NFL ladder available during the season (September–February).</EmptyCard>
          </div>
        </div>
      ) : noPicksForSport ? (
        <EmptyCard>
          No {selectedSport} picks available today — either no games are on the board or market coverage is too thin. Check back later or switch to another sport.
        </EmptyCard>
      ) : (
        <div className="space-y-8">
          {/* Lock of the Day */}
          <div>
            <SectionHeader icon={Lock} label="Lock of the Day" sublabel="Highest confidence single pick" accent="#f59e0b" />
            {lock ? (
              <LockCard
                pick={lock}
                onTrack={logBetToTracker}
                onLog={logBetToTracker}
                onBet={() => openBet(lock)}
              />
            ) : (
              <EmptyCard>No lock available — try refreshing.</EmptyCard>
            )}
          </div>

          {/* Safe Parlay — hidden when null */}
          {(safeParlay?.legs?.length ?? 0) > 0 && (
            <div>
              <SectionHeader icon={Zap} label="Safe Parlay of the Day" sublabel="2–3 legs, solid value (+175 to +500)" accent="#22c55e" />
              <ParlayCard parlay={safeParlay!} accent="#22c55e"
                onBet={() => openBetForParlay(safeParlay!)}
                onLog={logBetToTracker}
              />
            </div>
          )}

          {/* Lotto Parlay — hidden when null */}
          {(lottoParlay?.legs?.length ?? 0) > 0 && (
            <div>
              <SectionHeader icon={Dices} label="Lotto Parlay of the Day" sublabel="4–6 legs, big payout (+800 to +3000)" accent="#a855f7" />
              <ParlayCard parlay={lottoParlay!} accent="#a855f7"
                onBet={() => openBetForParlay(lottoParlay!)}
                onLog={logBetToTracker}
              />
            </div>
          )}

          {/* Game Parlay — team sports only, hidden when null */}
          {!isIndividualSport && (gameParlay?.legs?.length ?? 0) > 0 && (
            <div>
              <SectionHeader icon={Trophy} label="Game Picks Parlay" sublabel="Moneyline, spread & O/U only — no props" accent="#3b82f6" />
              <ParlayCard parlay={gameParlay!} accent="#3b82f6"
                onBet={() => openBetForParlay(gameParlay!)}
                onLog={logBetToTracker}
              />
            </div>
          )}

          {/* Fight Picks Parlay — MMA and Boxing only, hidden when no data */}
          {COMBAT_SPORTS.has(selectedSport) && ((propParlay?.legs?.length ?? 0) > 0 || (gameParlay?.legs?.length ?? 0) > 0) && (
            <div>
              <SectionHeader icon={Target} label="Fight Picks Parlay" sublabel="KO, submission & decision method props" accent="#ef4444" />
              {(propParlay?.legs?.length ?? 0) > 0
                ? <ParlayCard parlay={propParlay!} accent="#ef4444"
                    onBet={() => openBetForParlay(propParlay!)}
                    onLog={logBetToTracker}
                  />
                : <ParlayCard parlay={gameParlay!} accent="#ef4444"
                    onBet={() => openBetForParlay(gameParlay!)}
                    onLog={logBetToTracker}
                  />
              }
            </div>
          )}

          {/* Match Picks Parlay — Tennis only, hidden when no data */}
          {selectedSport === "Tennis" && (gameParlay?.legs?.length ?? 0) > 0 && (
            <div>
              <SectionHeader icon={Target} label="Match Picks Parlay" sublabel="Best value match picks combined" accent="#ec4899" />
              <ParlayCard parlay={gameParlay!} accent="#ec4899"
                onBet={() => openBetForParlay(gameParlay!)}
                onLog={logBetToTracker}
              />
            </div>
          )}

          {/* Props Parlay — team sports only, hidden when null */}
          {hasSportProps && (propParlay?.legs?.length ?? 0) > 0 && (
            <div>
              <SectionHeader icon={Target}
                label={
                  selectedSport === "Soccer" ? "Match Value Parlay" :
                  selectedSport === "WNBA" ? "WNBA Props Parlay" :
                  selectedSport === "NCAAB" ? "NCAAB Props Parlay" :
                  selectedSport === "NCAAF" ? "NCAAF Props Parlay" :
                  selectedSport === "NCAABSB" ? "NCAABSB Props Parlay" :
                  "Player Props Parlay"
                }
                sublabel={
                  selectedSport === "Soccer" ? "Best value soccer match picks combined" :
                  "All player performance props"
                }
                accent="#f97316" />
              <ParlayCard parlay={propParlay!} accent="#f97316"
                onBet={() => openBetForParlay(propParlay!)}
                onLog={logBetToTracker}
              />
            </div>
          )}

          {/* Mix Parlay — team sports + non-Golf individual sports, hidden when null */}
          {hasMixParlay && (mixParlay?.legs?.length ?? 0) > 0 && (
            <div>
              <SectionHeader icon={Shuffle} label="Mix Parlay" sublabel="Game bets + player props combined" accent="#14b8a6" />
              <ParlayCard parlay={mixParlay!} accent="#14b8a6"
                onBet={() => openBetForParlay(mixParlay!)}
                onLog={logBetToTracker}
              />
            </div>
          )}

          {/* Notice when lock exists but no multi-leg parlays could be built */}
          {lock && (safeParlay?.legs?.length ?? 0) === 0 && (lottoParlay?.legs?.length ?? 0) === 0
            && (gameParlay?.legs?.length ?? 0) === 0 && (propParlay?.legs?.length ?? 0) === 0
            && (mixParlay?.legs?.length ?? 0) === 0 && (
            <EmptyCard>
              Not enough games on the board today to build multi-leg parlays — the Lock of the Day above is your best bet. Parlays will populate as more {isAllTab ? "sports" : selectedSport} games are added to the board.
            </EmptyCard>
          )}

          {/* All Sports Scorer Parlay — All Sports tab only */}
          {isAllTab && allScorerParlay && (
            <div>
              <Divider label="ALL SPORTS SCORER" />
              <SectionHeader icon={TrendingUp} label="All Sports Scorer Parlay" sublabel="HR + 3PT + TD + Goal scorer legs combined" accent="#f59e0b" />
              <ParlayCard parlay={allScorerParlay} accent="#f59e0b"
                onBet={() => openBetForParlay(allScorerParlay)}
                onLog={logBetToTracker}
              />
            </div>
          )}

          {/* Sport-specific scorer parlays — team sports per-sport tab */}
          {hasSportProps && selectedSport !== "all" && (() => {
            const hasNba3pt  = (selectedSport === "NBA" || selectedSport === "WNBA" || selectedSport === "NCAAB") && (threePtParlay?.legs?.length ?? 0) > 0;
            const hasMlbHr   = (selectedSport === "MLB" || selectedSport === "NCAABSB") && (hrParlay?.legs?.length ?? 0) > 0;
            const hasNhlGs   = (selectedSport === "NHL" || selectedSport === "Soccer") && (goalScorerParlay?.legs?.length ?? 0) > 0;
            const hasNflTd   = (selectedSport === "NFL" || selectedSport === "NCAAF") && NFL_SEASON_ACTIVE && (tdParlay?.legs?.length ?? 0) > 0;
            if (!hasNba3pt && !hasMlbHr && !hasNhlGs && !hasNflTd) return null;
            const scorerLabel =
              selectedSport === "WNBA" ? "WNBA 3-Pointer Parlay" :
              selectedSport === "NCAAB" ? "NCAAB 3-Pointer Parlay" :
              selectedSport === "NCAABSB" ? "NCAABSB Home Run Parlay" :
              selectedSport === "Soccer" ? "Soccer Goal Scorer Parlay" :
              selectedSport === "NCAAF" ? "NCAAF TD Scorer Parlay" :
              null;
            return (
              <>
                <Divider label={`${selectedSport} SCORER PARLAY`} />
                {hasNba3pt && (
                  <div>
                    <SectionHeader icon={Target} label={scorerLabel ?? "3-Pointer Parlay"} sublabel="Volume shooters from deep" accent="#f97316" />
                    <ParlayCard parlay={threePtParlay!} accent="#f97316"
                      onBet={() => openBetForParlay(threePtParlay!)}
                      onLog={logBetToTracker}
                    />
                  </div>
                )}
                {hasMlbHr && (
                  <div>
                    <SectionHeader icon={TrendingUp} label={scorerLabel ?? "Home Run Parlay"} sublabel="Multi-HR bomber parlay · high variance" accent="#3b82f6" />
                    <ParlayCard parlay={hrParlay!} accent="#3b82f6"
                      onBet={() => openBetForParlay(hrParlay!)}
                      onLog={logBetToTracker}
                    />
                  </div>
                )}
                {hasNhlGs && (
                  <div>
                    <SectionHeader icon={Target} label={scorerLabel ?? "Goal Scorer Parlay"} sublabel="Anytime goal or assist combo" accent="#8b5cf6" />
                    <ParlayCard parlay={goalScorerParlay!} accent="#8b5cf6"
                      onBet={() => openBetForParlay(goalScorerParlay!)}
                      onLog={logBetToTracker}
                    />
                  </div>
                )}
                {hasNflTd && (
                  <div>
                    <SectionHeader icon={Target} label={scorerLabel ?? "TD Scorer Parlay"} sublabel="Anytime touchdown combo" accent="#22c55e" />
                    <ParlayCard parlay={tdParlay!} accent="#22c55e"
                      onBet={() => openBetForParlay(tdParlay!)}
                      onLog={logBetToTracker}
                    />
                  </div>
                )}
              </>
            );
          })()}

          {/* Daily Ladder */}
          {hasSportLadder && (
            <>
              <Divider label="DAILY LADDER · $10 → $10K" />
              <div>
                <SectionHeader icon={TrendingUp} label={`${ladderSportLabel} Daily Ladder`} sublabel="Win today's bet → roll winnings to tomorrow" accent={LADDER_ACCENT} />
                {(activeLadder!.steps?.length ?? 0) >= 1
                  ? (
                    <DailyLadderCard
                      parlay={activeLadder!}
                      progress={ladderProgress}
                      onSettle={handleSettle}
                      isSettling={isSettling}
                      onPlaceBet={() => openBetParlay(activeLadder!.steps?.[0]?.legs ?? [])}
                      onLog={logBetToTracker}
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
            </>
          )}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground text-center">
        For entertainment only. Bet responsibly. Past performance does not guarantee future results.
      </p>

      {/* Bookmaker chooser modal — used by all Place Bet buttons */}
      {bookmakerBet && (
        <BookmakerModal bet={bookmakerBet} onClose={() => setBookmakerBet(null)} />
      )}
    </div>
  );
}

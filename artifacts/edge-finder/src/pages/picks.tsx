import { useState, useRef } from "react";
import { useGetPickHistory, useGetPickHistoryStats, useLogPick, useUpdatePickResult, getGetPickHistoryQueryKey, getGetPickHistoryStatsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toPng } from "html-to-image";
import { cn } from "@/lib/utils";
import { Trophy, TrendingUp, Percent, Clock, Download, CheckCircle2, XCircle, RotateCcw } from "lucide-react";

function fmtOdds(o: number) {
  return o > 0 ? `+${o}` : `${o}`;
}

function ResultBadge({ result, id, onUpdate }: { result: string; id: number; onUpdate: (id: number, r: "win" | "loss" | "pending") => void }) {
  if (result === "win") {
    return (
      <button onClick={() => onUpdate(id, "pending")} title="Click to undo" className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded border bg-green-500/10 text-green-400 border-green-500/20 hover:bg-green-500/20 transition-colors">
        <CheckCircle2 className="h-3 w-3" /> WIN
      </button>
    );
  }
  if (result === "loss") {
    return (
      <button onClick={() => onUpdate(id, "pending")} title="Click to undo" className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded border bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20 transition-colors">
        <XCircle className="h-3 w-3" /> LOSS
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <button onClick={() => onUpdate(id, "win")} className="text-[10px] px-2 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20 hover:bg-green-500/20 transition-colors font-bold">W</button>
      <button onClick={() => onUpdate(id, "loss")} className="text-[10px] px-2 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors font-bold">L</button>
    </div>
  );
}

export default function PicksPage() {
  const qc = useQueryClient();
  const history = useGetPickHistory({ query: { queryKey: getGetPickHistoryQueryKey() } });
  const stats = useGetPickHistoryStats({ query: { queryKey: getGetPickHistoryStatsQueryKey() } });
  const updatePick = useUpdatePickResult();

  function handleUpdate(pickId: number, result: "win" | "loss" | "pending") {
    updatePick.mutate(
      { pickId, data: { result } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetPickHistoryQueryKey() });
          qc.invalidateQueries({ queryKey: getGetPickHistoryStatsQueryKey() });
        },
      }
    );
  }

  const s = stats.data;
  const winRate = s?.winRate != null ? (s.winRate * 100).toFixed(1) : null;
  const picks = history.data ?? [];

  return (
    <div className="p-4 md:p-6 space-y-5 pb-20 md:pb-6">
      <div>
        <h1 className="text-xl font-bold">Pick History</h1>
        <p className="text-xs text-muted-foreground mt-0.5">30-day AI pick performance tracker</p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-card border border-card-border rounded-lg p-4 flex items-start gap-3">
          <div className="h-8 w-8 rounded flex items-center justify-center bg-green-500/10 text-green-400 flex-shrink-0">
            <Trophy className="h-4 w-4" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Win Rate</p>
            <p className="text-xl font-bold font-mono mt-0.5">{winRate != null ? `${winRate}%` : "—"}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{s?.wins ?? 0}W / {s?.losses ?? 0}L</p>
          </div>
        </div>
        <div className="bg-card border border-card-border rounded-lg p-4 flex items-start gap-3">
          <div className="h-8 w-8 rounded flex items-center justify-center bg-primary/10 text-primary flex-shrink-0">
            <TrendingUp className="h-4 w-4" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Tracked</p>
            <p className="text-xl font-bold font-mono mt-0.5">{s?.total ?? 0}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{s?.pending ?? 0} pending</p>
          </div>
        </div>
        <div className="bg-card border border-card-border rounded-lg p-4 flex items-start gap-3">
          <div className={cn("h-8 w-8 rounded flex items-center justify-center flex-shrink-0", (s?.totalProfit ?? 0) >= 0 ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400")}>
            <Percent className="h-4 w-4" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total Profit</p>
            <p className={cn("text-xl font-bold font-mono mt-0.5", (s?.totalProfit ?? 0) >= 0 ? "text-green-400" : "text-red-400")}>
              {(s?.totalProfit ?? 0) >= 0 ? "+" : ""}${Math.abs(s?.totalProfit ?? 0).toFixed(2)}
            </p>
          </div>
        </div>
        <div className="bg-card border border-card-border rounded-lg p-4 flex items-start gap-3">
          <div className="h-8 w-8 rounded flex items-center justify-center bg-blue-500/10 text-blue-400 flex-shrink-0">
            <Clock className="h-4 w-4" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Last 30 Days</p>
            <p className="text-xl font-bold font-mono mt-0.5">{picks.length}</p>
            <p className="text-xs text-muted-foreground mt-0.5">picks generated</p>
          </div>
        </div>
      </div>

      {/* Pick history table */}
      <div className="bg-card border border-card-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold">Pick Archive</h2>
        </div>
        {history.isLoading ? (
          <div className="p-4 space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="h-14 bg-muted rounded animate-pulse" />)}</div>
        ) : picks.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm text-muted-foreground">No picks tracked yet.</p>
            <p className="text-xs text-muted-foreground mt-1">Picks are automatically logged when you view the AI Picks page on mobile.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground bg-muted/30">
                  <th className="text-left px-3 py-2 font-medium">Game</th>
                  <th className="text-left px-3 py-2 font-medium hidden sm:table-cell">Pick</th>
                  <th className="text-right px-3 py-2 font-medium">Odds</th>
                  <th className="text-right px-3 py-2 font-medium hidden md:table-cell">Conf.</th>
                  <th className="text-right px-3 py-2 font-medium hidden lg:table-cell">Date</th>
                  <th className="text-center px-3 py-2 font-medium">Result</th>
                </tr>
              </thead>
              <tbody>
                {picks.map((p) => (
                  <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/20" data-testid={`row-pick-${p.id}`}>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded border flex-shrink-0", {
                          "bg-blue-500/10 text-blue-400 border-blue-500/20": p.sport === "NFL",
                          "bg-orange-500/10 text-orange-400 border-orange-500/20": p.sport === "NBA",
                          "bg-red-500/10 text-red-400 border-red-500/20": p.sport === "MLB",
                          "bg-cyan-500/10 text-cyan-400 border-cyan-500/20": p.sport === "NHL",
                        })}>{p.sport}</span>
                        <span className="truncate max-w-[120px]">{p.awayTeam} @ {p.homeTeam}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 hidden sm:table-cell">
                      <div className="font-medium truncate max-w-[160px]">{p.player ? `${p.player} — ` : ""}{p.pick}</div>
                      <div className="text-muted-foreground">{p.bookmaker}</div>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono font-bold">
                      {fmtOdds(p.odds)}
                    </td>
                    <td className="px-3 py-2.5 text-right hidden md:table-cell">
                      <span className={cn("font-mono", p.confidence >= 70 ? "text-green-400" : p.confidence >= 55 ? "text-amber-400" : "text-red-400")}>
                        {p.confidence}%
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right hidden lg:table-cell text-muted-foreground">
                      {format(new Date(p.createdAt), "MMM d")}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <ResultBadge result={p.result} id={p.id} onUpdate={handleUpdate} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground text-center">
        For entertainment only. Track picks manually by clicking W/L after each game. Past performance does not guarantee future results.
      </p>
    </div>
  );
}

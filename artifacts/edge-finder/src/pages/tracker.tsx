import { useState } from "react";
import { useGetBets, useGetBetStats, useGetBankrollChart, useCreateBet, useUpdateBet, useDeleteBet, getGetBetsQueryKey, getGetBetStatsQueryKey, getGetBankrollChartQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { PlusCircle, TrendingUp, TrendingDown, DollarSign, Percent, ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

const betFormSchema = z.object({
  sport: z.enum(["NFL", "NBA", "MLB", "NHL"]),
  homeTeam: z.string().min(1, "Required"),
  awayTeam: z.string().min(1, "Required"),
  team: z.string().min(1, "Required"),
  betType: z.enum(["moneyline", "spread", "over", "under"]),
  bookmaker: z.string().min(1, "Required"),
  odds: z.coerce.number().int(),
  stake: z.coerce.number().positive("Must be positive"),
  gameDate: z.string().min(1, "Required"),
  notes: z.string().optional(),
});

type BetFormValues = z.infer<typeof betFormSchema>;

const BOOKMAKERS = ["DraftKings", "FanDuel", "BetMGM", "Caesars", "PointsBet", "Other"];

function StatCard({ label, value, sub, positive, icon: Icon }: { label: string; value: string; sub?: string; positive?: boolean; icon: React.ElementType }) {
  return (
    <div className="bg-card border border-card-border rounded-lg p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-muted-foreground font-medium">{label}</p>
          <p className={cn("text-xl font-bold font-mono mt-0.5", positive === true ? "text-green-400" : positive === false ? "text-destructive" : "text-foreground")} data-testid={`stat-${label.toLowerCase().replace(/\s/g, "-")}`}>
            {value}
          </p>
          {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
        </div>
        <div className="h-7 w-7 rounded bg-muted flex items-center justify-center">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
      </div>
    </div>
  );
}

export default function Tracker() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const bets = useGetBets({ sport: "all", result: "all" }, { query: { queryKey: getGetBetsQueryKey({ sport: "all", result: "all" }) } });
  const stats = useGetBetStats({ query: { queryKey: getGetBetStatsQueryKey() } });
  const chart = useGetBankrollChart({ query: { queryKey: getGetBankrollChartQueryKey() } });

  const createBet = useCreateBet({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetBetsQueryKey({}) });
        qc.invalidateQueries({ queryKey: getGetBetStatsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetBankrollChartQueryKey() });
        setShowForm(false);
        form.reset();
      },
    },
  });

  const updateBet = useUpdateBet({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetBetsQueryKey({}) });
        qc.invalidateQueries({ queryKey: getGetBetStatsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetBankrollChartQueryKey() });
      },
    },
  });

  const deleteBet = useDeleteBet({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetBetsQueryKey({}) });
        qc.invalidateQueries({ queryKey: getGetBetStatsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetBankrollChartQueryKey() });
      },
    },
  });

  const form = useForm<BetFormValues>({
    resolver: zodResolver(betFormSchema),
    defaultValues: {
      sport: "NFL",
      homeTeam: "",
      awayTeam: "",
      team: "",
      betType: "moneyline",
      bookmaker: "DraftKings",
      odds: -110,
      stake: 100,
      gameDate: new Date().toISOString().slice(0, 16),
      notes: "",
    },
  });

  function onSubmit(values: BetFormValues) {
    createBet.mutate({
      data: {
        ...values,
        gameDate: new Date(values.gameDate),
        notes: values.notes || null,
        gameId: null,
      },
    });
  }

  const s = stats.data;
  const roi = s?.roi ?? 0;
  const profit = s?.totalProfit ?? 0;

  return (
    <div className="p-4 md:p-6 space-y-5 pb-20 md:pb-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Bet Tracker</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Log and track your wagers</p>
        </div>
        <Button size="sm" onClick={() => setShowForm(!showForm)} data-testid="button-log-bet">
          <PlusCircle className="h-3.5 w-3.5 mr-1.5" />
          {showForm ? "Cancel" : "Log Bet"}
        </Button>
      </div>

      {/* Log Bet Form */}
      {showForm && (
        <div className="bg-card border border-card-border rounded-lg p-5">
          <h2 className="text-sm font-semibold mb-4">New Bet</h2>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <FormField control={form.control} name="sport" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Sport</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger data-testid="select-sport"><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="NFL">NFL</SelectItem>
                        <SelectItem value="NBA">NBA</SelectItem>
                        <SelectItem value="MLB">MLB</SelectItem>
                        <SelectItem value="NHL">NHL</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="betType" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Bet Type</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger data-testid="select-bet-type"><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="moneyline">Moneyline</SelectItem>
                        <SelectItem value="spread">Spread</SelectItem>
                        <SelectItem value="over">Over</SelectItem>
                        <SelectItem value="under">Under</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="bookmaker" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Bookmaker</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger data-testid="select-bookmaker"><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {BOOKMAKERS.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="gameDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Game Date</FormLabel>
                    <FormControl><Input type="datetime-local" {...field} className="text-xs" data-testid="input-game-date" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="homeTeam" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Home Team</FormLabel>
                    <FormControl><Input placeholder="e.g. Kansas City Chiefs" {...field} data-testid="input-home-team" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="awayTeam" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Away Team</FormLabel>
                    <FormControl><Input placeholder="e.g. Baltimore Ravens" {...field} data-testid="input-away-team" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <FormField control={form.control} name="team" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Bet On</FormLabel>
                    <FormControl><Input placeholder="Team or Over/Under" {...field} data-testid="input-team" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="odds" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Odds (American)</FormLabel>
                    <FormControl><Input type="number" placeholder="-110" {...field} data-testid="input-odds" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="stake" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Stake ($)</FormLabel>
                    <FormControl><Input type="number" step="0.01" placeholder="100" {...field} data-testid="input-stake" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs">Notes (optional)</FormLabel>
                  <FormControl><Input placeholder="e.g. Home field advantage, line movement..." {...field} data-testid="input-notes" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <Button type="submit" disabled={createBet.isPending} className="w-full sm:w-auto" data-testid="button-submit-bet">
                {createBet.isPending ? "Logging..." : "Log Bet"}
              </Button>
            </form>
          </Form>
        </div>
      )}

      {/* Stats */}
      {stats.isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-card border border-card-border rounded-lg animate-pulse" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Win Rate" value={`${((s?.winRate ?? 0) * 100).toFixed(1)}%`} sub={`${s?.wins ?? 0}W / ${s?.losses ?? 0}L / ${s?.pending ?? 0}P`} icon={Percent} />
          <StatCard label="ROI" value={`${roi >= 0 ? "+" : ""}${roi.toFixed(1)}%`} positive={roi >= 0} icon={TrendingUp} />
          <StatCard label="Total Profit" value={`${profit >= 0 ? "+" : ""}$${Math.abs(profit).toFixed(2)}`} positive={profit >= 0} sub={`$${(s?.totalStaked ?? 0).toFixed(2)} staked`} icon={DollarSign} />
          <StatCard label="Bankroll" value={`$${(s?.currentBankroll ?? 1000).toFixed(2)}`} sub={s?.bestSport ? `Best: ${s.bestSport}` : undefined} icon={TrendingUp} />
        </div>
      )}

      {/* Bankroll Chart */}
      {chart.data && chart.data.length > 0 && (
        <div className="bg-card border border-card-border rounded-lg p-4">
          <h2 className="text-sm font-semibold mb-4">Bankroll Growth</h2>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chart.data} margin={{ top: 4, right: 4, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px", fontSize: 11 }}
                  formatter={(value: number) => [`$${value.toFixed(2)}`, "Bankroll"]}
                />
                <Line type="monotone" dataKey="bankroll" stroke="hsl(142 71% 45%)" strokeWidth={2} dot={false} activeDot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Bets Table */}
      <div className="bg-card border border-card-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold">Bet History</h2>
        </div>
        {bets.isLoading ? (
          <div className="p-4 space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-14 bg-muted rounded animate-pulse" />)}</div>
        ) : (bets.data ?? []).length === 0 ? (
          <div className="py-10 text-center text-muted-foreground text-sm">No bets logged yet. Log your first bet above.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground bg-muted/30">
                  <th className="text-left px-3 py-2 font-medium">Game</th>
                  <th className="text-left px-3 py-2 font-medium hidden sm:table-cell">Bet</th>
                  <th className="text-right px-3 py-2 font-medium">Odds</th>
                  <th className="text-right px-3 py-2 font-medium">Stake</th>
                  <th className="text-right px-3 py-2 font-medium hidden md:table-cell">Profit</th>
                  <th className="text-center px-3 py-2 font-medium">Result</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {(bets.data ?? []).map((bet) => (
                  <tr key={bet.id} className="border-b border-border last:border-0 hover:bg-muted/20" data-testid={`row-bet-${bet.id}`}>
                    <td className="px-3 py-2.5">
                      <div className="text-xs font-medium">{bet.homeTeam} vs {bet.awayTeam}</div>
                      <div className="text-[10px] text-muted-foreground">{format(new Date(bet.gameDate), "MMM d, yyyy")}</div>
                    </td>
                    <td className="px-3 py-2.5 hidden sm:table-cell">
                      <div className="text-xs">{bet.team}</div>
                      <div className="text-[10px] text-muted-foreground capitalize">{bet.betType} · {bet.bookmaker}</div>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs font-bold">
                      {bet.odds > 0 ? `+${bet.odds}` : bet.odds}
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs font-mono">${bet.stake.toFixed(2)}</td>
                    <td className="px-3 py-2.5 text-right hidden md:table-cell">
                      {bet.profit !== null && bet.profit !== undefined ? (
                        <span className={cn("text-xs font-mono font-bold", bet.profit >= 0 ? "text-green-400" : "text-destructive")}>
                          {bet.profit >= 0 ? "+" : ""}${bet.profit.toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {bet.result === "pending" ? (
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => updateBet.mutate({ betId: bet.id, data: { result: "win" } })}
                            className="text-[10px] px-2 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20 hover:bg-green-500/20 transition-colors"
                            data-testid={`button-win-${bet.id}`}
                          >W</button>
                          <button
                            onClick={() => updateBet.mutate({ betId: bet.id, data: { result: "loss" } })}
                            className="text-[10px] px-2 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors"
                            data-testid={`button-loss-${bet.id}`}
                          >L</button>
                        </div>
                      ) : (
                        <span className={cn(
                          "text-[10px] font-bold px-2 py-0.5 rounded border",
                          bet.result === "win" ? "bg-green-500/10 text-green-400 border-green-500/20"
                            : bet.result === "loss" ? "bg-red-500/10 text-red-400 border-red-500/20"
                            : "bg-muted text-muted-foreground border-border"
                        )}>
                          {bet.result.toUpperCase()}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <button
                        onClick={() => deleteBet.mutate({ betId: bet.id })}
                        className="text-muted-foreground hover:text-destructive transition-colors"
                        data-testid={`button-delete-bet-${bet.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground text-center">
        For entertainment only. Bet responsibly. Past performance does not guarantee future results.
      </p>
    </div>
  );
}

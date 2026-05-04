import { useState } from "react";
import { useGetArbOpportunities } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Zap, ArrowRight, RefreshCw, Info, TrendingUp } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function formatOdds(o: number) {
  return o > 0 ? `+${o}` : `${o}`;
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n);
}

const SPORT_COLORS: Record<string, string> = {
  NBA: "text-orange-400",
  MLB: "text-blue-400",
  NHL: "text-cyan-400",
  NFL: "text-green-400",
};

export default function Arb() {
  const [stake, setStake] = useState("1000");
  const totalStake = parseFloat(stake) || 1000;

  const { data: opportunities = [], isLoading, refetch, isFetching } = useGetArbOpportunities(
    {},
    { query: { refetchInterval: 60_000 } },
  );

  const trueArbs = opportunities.filter((o) => o.isArb);
  const nearArbs = opportunities.filter((o) => !o.isArb);

  return (
    <div className="p-4 md:p-6 space-y-5 pb-20 md:pb-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-bold">Arbitrage Finder</h1>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Guaranteed profit by betting both sides at different books · updates every 60s
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", isFetching && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* Stake input */}
      <div className="bg-card border border-card-border rounded-lg px-4 py-3 flex items-center gap-4">
        <div className="flex items-center gap-3 flex-1">
          <Label className="text-xs text-muted-foreground whitespace-nowrap">Total Stake</Label>
          <div className="relative w-36">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
            <Input
              type="number"
              min="1"
              step="100"
              value={stake}
              onChange={(e) => setStake(e.target.value)}
              className="pl-7 font-mono text-sm"
              data-testid="input-stake"
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground hidden sm:block">
          Enter your total wager — we'll calculate the split across books automatically.
        </p>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 bg-primary/5 border border-primary/15 rounded-lg px-4 py-3">
        <Info className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          <strong className="text-foreground">How it works:</strong> An arb exists when the best available price on each
          outcome (across different books) sums to less than 100% implied probability. Bet each leg at the listed book
          for a risk-free return. Near-arbs have combined vig &lt;2% — still low cost, not guaranteed.
        </p>
      </div>

      {isLoading && (
        <div className="text-center py-16 text-muted-foreground text-sm">Scanning markets…</div>
      )}

      {!isLoading && opportunities.length === 0 && (
        <div className="text-center py-16 space-y-3">
          <TrendingUp className="h-10 w-10 text-muted-foreground/30 mx-auto" />
          <p className="text-sm font-medium text-muted-foreground">No opportunities found right now</p>
          <p className="text-xs text-muted-foreground/70">
            US books are highly efficient. True arbs are rare — check back after line moves.
          </p>
        </div>
      )}

      {/* True arbs */}
      {trueArbs.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-primary">True Arbs</h2>
            <Badge className="bg-primary/20 text-primary border-primary/30 text-[10px]">{trueArbs.length}</Badge>
            <span className="text-[10px] text-muted-foreground">guaranteed profit</span>
          </div>
          {trueArbs.map((opp) => (
            <ArbCard key={opp.id} opp={opp} totalStake={totalStake} highlight />
          ))}
        </section>
      )}

      {/* Near arbs */}
      {nearArbs.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">Low-Vig Opportunities</h2>
            <Badge variant="secondary" className="text-[10px]">{nearArbs.length}</Badge>
            <span className="text-[10px] text-muted-foreground">combined vig &lt;2%</span>
          </div>
          {nearArbs.map((opp) => (
            <ArbCard key={opp.id} opp={opp} totalStake={totalStake} highlight={false} />
          ))}
        </section>
      )}
    </div>
  );
}

interface ArbCardProps {
  opp: ReturnType<typeof useGetArbOpportunities>["data"][number];
  totalStake: number;
  highlight: boolean;
}

function ArbCard({ opp, totalStake, highlight }: ArbCardProps) {
  const profit = (totalStake / (opp.totalImplied / 100)) - totalStake;
  const vigorish = opp.totalImplied - 100;
  const marketLabel = opp.market === "h2h" ? "Moneyline" : "Over/Under";

  return (
    <Link href={`/games/${opp.gameId}`}>
      <div
        className={cn(
          "bg-card border rounded-lg p-4 space-y-3 cursor-pointer transition-colors hover:border-primary/40",
          highlight ? "border-primary/50 bg-primary/5" : "border-card-border",
        )}
        data-testid="arb-card"
      >
        {/* Game header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className={cn("text-[10px] font-bold uppercase tracking-wider", SPORT_COLORS[opp.sport] ?? "text-muted-foreground")}>
                {opp.sport}
              </span>
              <span className="text-[10px] text-muted-foreground">·</span>
              <span className="text-[10px] text-muted-foreground capitalize">{opp.status}</span>
              <span className="text-[10px] text-muted-foreground">·</span>
              <span className="text-[10px] text-muted-foreground">{marketLabel}</span>
            </div>
            <p className="text-sm font-semibold truncate">
              {opp.homeTeam} <span className="text-muted-foreground font-normal">vs</span> {opp.awayTeam}
            </p>
          </div>

          <div className="text-right flex-shrink-0">
            {highlight ? (
              <>
                <p className={cn("text-lg font-bold font-mono", profit > 0 ? "text-primary" : "text-muted-foreground")}>
                  {profit > 0 ? "+" : ""}{formatCurrency(profit)}
                </p>
                <p className="text-[10px] text-primary font-medium">{opp.profitPct > 0 ? "+" : ""}{opp.profitPct.toFixed(2)}% ROI</p>
              </>
            ) : (
              <>
                <p className="text-sm font-bold font-mono text-muted-foreground">
                  {vigorish.toFixed(2)}% vig
                </p>
                <p className="text-[10px] text-muted-foreground">{opp.totalImplied.toFixed(1)}% implied</p>
              </>
            )}
          </div>
        </div>

        {/* Legs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {opp.legs.map((leg, i) => {
            const legStake = totalStake * leg.stakeRatio;
            const legReturn = legStake / (leg.impliedProb / 100);
            return (
              <div
                key={i}
                className={cn(
                  "rounded-md px-3 py-2 space-y-1",
                  highlight ? "bg-primary/10 border border-primary/20" : "bg-muted/30 border border-border",
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium truncate flex-1">{leg.outcome}</span>
                  <span className={cn("text-xs font-mono font-bold ml-2", leg.odds > 0 ? "text-primary" : "text-foreground")}>
                    {formatOdds(leg.odds)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span className="truncate">{leg.bookmaker}</span>
                  <span className="font-mono ml-2">
                    {formatCurrency(legStake)}
                    <ArrowRight className="inline h-2.5 w-2.5 mx-0.5" />
                    {formatCurrency(legReturn)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between text-[10px] text-muted-foreground border-t border-border pt-2">
          <span>Total stake: <span className="font-mono text-foreground">{formatCurrency(totalStake)}</span></span>
          <span>
            Guaranteed return:{" "}
            <span className={cn("font-mono font-medium", highlight ? "text-primary" : "text-foreground")}>
              {formatCurrency(totalStake / (opp.totalImplied / 100))}
            </span>
          </span>
        </div>
      </div>
    </Link>
  );
}

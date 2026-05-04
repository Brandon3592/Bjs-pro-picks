import { useRoute } from "wouter";
import { useGetGame, getGetGameQueryKey } from "@workspace/api-client-react";
import { ArrowLeft, Wind, Thermometer, AlertTriangle } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

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

function ProbBar({ label, prob, color }: { label: string; prob: number; color: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium truncate pr-2">{label}</span>
        <span className="font-mono font-bold">{(prob * 100).toFixed(1)}%</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${prob * 100}%` }} />
      </div>
    </div>
  );
}

export default function GameDetail() {
  const [, params] = useRoute("/games/:gameId");
  const gameId = params?.gameId ?? "";

  const detail = useGetGame(gameId, { query: { enabled: !!gameId, queryKey: getGetGameQueryKey(gameId) } });

  if (detail.isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-4">
        <div className="h-8 w-48 bg-muted rounded animate-pulse" />
        <div className="h-32 bg-card border border-card-border rounded-lg animate-pulse" />
        <div className="h-48 bg-card border border-card-border rounded-lg animate-pulse" />
      </div>
    );
  }

  if (!detail.data) return <div className="p-6 text-muted-foreground">Game not found.</div>;

  const { game, odds, prediction, injuries } = detail.data;

  return (
    <div className="p-4 md:p-6 space-y-5 pb-20 md:pb-6">
      <Link href="/games">
        <div className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground cursor-pointer w-fit" data-testid="link-back">
          <ArrowLeft className="h-4 w-4" />
          Back to Games
        </div>
      </Link>

      {/* Game Header */}
      <div className="bg-card border border-card-border rounded-lg p-5">
        <div className="flex items-center gap-2 mb-4">
          <SportBadge sport={game.sport} />
          {game.status === "live" && (
            <span className="text-xs font-bold text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded">
              LIVE {game.quarter} {game.timeRemaining && `• ${game.timeRemaining}`}
            </span>
          )}
          {game.status === "upcoming" && (
            <span className="text-xs text-muted-foreground">{format(new Date(game.startTime), "MMM d, h:mm a")}</span>
          )}
          {game.status === "final" && (
            <span className="text-xs font-bold text-muted-foreground">FINAL</span>
          )}
        </div>

        <div className="grid grid-cols-3 gap-4 items-center">
          <div className="text-center">
            <p className="text-base font-bold leading-tight">{game.homeTeam}</p>
            <p className="text-xs text-muted-foreground mt-0.5">HOME</p>
            {game.homeScore !== null && game.homeScore !== undefined && (
              <p className="text-4xl font-bold font-mono mt-2">{game.homeScore}</p>
            )}
          </div>
          <div className="text-center">
            <span className="text-sm text-muted-foreground font-medium">VS</span>
          </div>
          <div className="text-center">
            <p className="text-base font-bold leading-tight">{game.awayTeam}</p>
            <p className="text-xs text-muted-foreground mt-0.5">AWAY</p>
            {game.awayScore !== null && game.awayScore !== undefined && (
              <p className="text-4xl font-bold font-mono mt-2">{game.awayScore}</p>
            )}
          </div>
        </div>

        {game.weather && (
          <div className="mt-4 flex items-center gap-3 text-xs text-muted-foreground border-t border-border pt-3">
            <Thermometer className="h-3.5 w-3.5" />
            <span>{game.weather.temp}°F</span>
            <Wind className="h-3.5 w-3.5" />
            <span>{game.weather.windSpeed} mph</span>
            <span>{game.weather.condition}</span>
            {game.weather.precipitation > 0 && <span>{game.weather.precipitation}% precip</span>}
            {game.venue && <span className="ml-auto">{game.venue}</span>}
          </div>
        )}
      </div>

      {/* Prediction */}
      {prediction && (
        <div className="bg-card border border-card-border rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold">Model Prediction</h2>
            <span className={cn(
              "text-xs font-bold px-2 py-0.5 rounded border",
              prediction.confidence === "high" ? "edge-bg-high" : prediction.confidence === "medium" ? "edge-bg-medium" : "edge-bg-low"
            )}>
              {prediction.confidence.toUpperCase()} CONFIDENCE
            </span>
          </div>
          <div className="space-y-3 mb-4">
            <ProbBar label={game.homeTeam} prob={prediction.homeWinProb} color="bg-primary" />
            <ProbBar label={game.awayTeam} prob={prediction.awayWinProb} color="bg-muted-foreground" />
          </div>
          {prediction.recommendedBet && (
            <div className="bg-primary/5 border border-primary/20 rounded p-3 text-sm">
              <div className="text-xs text-muted-foreground mb-1">Recommended Bet</div>
              <div className="font-semibold text-primary">{prediction.recommendedBet}</div>
              {prediction.recommendedBookmaker && (
                <div className="text-xs text-muted-foreground mt-0.5">Best at {prediction.recommendedBookmaker}</div>
              )}
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {prediction.modelFactors.map((f) => (
              <span key={f} className="text-[10px] bg-muted text-muted-foreground px-2 py-0.5 rounded border border-border">{f}</span>
            ))}
          </div>
        </div>
      )}

      {/* Odds Comparison */}
      <div className="bg-card border border-card-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold">Odds Comparison</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground bg-muted/30">
                <th className="text-left px-3 py-2 font-medium">Bookmaker</th>
                <th className="text-right px-3 py-2 font-medium">{game.homeTeam} ML</th>
                <th className="text-right px-3 py-2 font-medium">{game.awayTeam} ML</th>
                <th className="text-right px-3 py-2 font-medium hidden sm:table-cell">Spread</th>
                <th className="text-right px-3 py-2 font-medium hidden md:table-cell">O/U</th>
              </tr>
            </thead>
            <tbody>
              {(odds ?? []).map((o) => (
                <tr key={o.id} className="border-b border-border last:border-0 hover:bg-muted/20" data-testid={`row-odds-${o.bookmaker}`}>
                  <td className="px-3 py-2.5 font-medium">{o.bookmaker}</td>
                  <td className="px-3 py-2.5 text-right font-mono font-bold">
                    {o.homeMoneyline !== null && o.homeMoneyline !== undefined
                      ? (o.homeMoneyline > 0 ? `+${o.homeMoneyline}` : o.homeMoneyline)
                      : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono font-bold">
                    {o.awayMoneyline !== null && o.awayMoneyline !== undefined
                      ? (o.awayMoneyline > 0 ? `+${o.awayMoneyline}` : o.awayMoneyline)
                      : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right hidden sm:table-cell text-muted-foreground font-mono">
                    {o.homeSpread !== null && o.homeSpread !== undefined ? `${o.homeSpread > 0 ? "+" : ""}${o.homeSpread}` : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right hidden md:table-cell text-muted-foreground font-mono">
                    {o.overUnder ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Injuries */}
      {injuries && injuries.length > 0 && (
        <div className="bg-card border border-card-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-yellow-400" />
            <h2 className="text-sm font-semibold">Injury Report</h2>
          </div>
          <div className="divide-y divide-border">
            {injuries.map((inj) => (
              <div key={`${inj.player}-${inj.team}`} className="flex items-center justify-between px-4 py-2.5" data-testid={`injury-${inj.player}`}>
                <div>
                  <span className="text-sm font-medium">{inj.player}</span>
                  <span className="text-xs text-muted-foreground ml-2">{inj.position} · {inj.team}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{inj.status}</span>
                  <span className={cn(
                    "text-[10px] font-bold px-1.5 py-0.5 rounded border",
                    inj.impact === "high" ? "bg-red-500/10 text-red-400 border-red-500/20"
                      : inj.impact === "medium" ? "edge-bg-medium"
                      : "bg-muted text-muted-foreground border-border"
                  )}>
                    {inj.impact.toUpperCase()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

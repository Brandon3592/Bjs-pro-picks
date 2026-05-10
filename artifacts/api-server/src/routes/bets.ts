import { Router } from "express";
import { db } from "@workspace/db";
import { betsTable } from "@workspace/db";
import { CreateBetBody, UpdateBetBody, UpdateBetParams, GetBetsQueryParams } from "@workspace/api-zod";
import { eq, and, desc } from "drizzle-orm";

const router = Router();

function calcProfit(odds: number, stake: number, result: string): number | null {
  if (result === "pending") return null;
  if (result === "loss") return -stake;
  if (odds > 0) return (odds / 100) * stake;
  return (100 / Math.abs(odds)) * stake;
}

router.get("/bets/stats", async (req, res) => {
  const userId = req.user?.id ?? "anonymous";
  try {
    const bets = await db.select().from(betsTable).where(eq(betsTable.userId, userId));
    const settled = bets.filter((b) => b.result !== "pending");
    const wins = settled.filter((b) => b.result === "win").length;
    const losses = settled.filter((b) => b.result === "loss").length;
    const pending = bets.filter((b) => b.result === "pending").length;
    const totalStaked = bets.reduce((acc, b) => acc + b.stake, 0);
    const totalProfit = settled.reduce((acc, b) => acc + (b.profit ?? 0), 0);
    const roi = totalStaked > 0 ? (totalProfit / totalStaked) * 100 : 0;
    const winRate = settled.length > 0 ? wins / settled.length : 0;

    const sportProfits: Record<string, number> = {};
    for (const b of settled) {
      sportProfits[b.sport] = (sportProfits[b.sport] ?? 0) + (b.profit ?? 0);
    }
    const bestSport = Object.keys(sportProfits).length > 0
      ? Object.entries(sportProfits).sort((a, b) => b[1] - a[1])[0][0]
      : null;

    const bookmakerProfits: Record<string, number> = {};
    for (const b of settled) {
      bookmakerProfits[b.bookmaker] = (bookmakerProfits[b.bookmaker] ?? 0) + (b.profit ?? 0);
    }
    const bestBookmaker = Object.keys(bookmakerProfits).length > 0
      ? Object.entries(bookmakerProfits).sort((a, b) => b[1] - a[1])[0][0]
      : null;

    res.json({
      totalBets: bets.length,
      wins,
      losses,
      pending,
      winRate: parseFloat(winRate.toFixed(4)),
      roi: parseFloat(roi.toFixed(2)),
      totalStaked: parseFloat(totalStaked.toFixed(2)),
      totalProfit: parseFloat(totalProfit.toFixed(2)),
      currentBankroll: 1000 + totalProfit,
      bestSport,
      bestBookmaker,
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching bet stats");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/bets/chart", async (req, res) => {
  const userId = req.user?.id ?? "anonymous";
  try {
    const bets = await db.select().from(betsTable)
      .where(eq(betsTable.userId, userId))
      .orderBy(betsTable.gameDate);

    if (bets.length === 0) {
      const today = new Date();
      const points = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(today);
        d.setDate(d.getDate() - (6 - i));
        return {
          date: d.toISOString().split("T")[0],
          bankroll: 1000,
          profit: 0,
          cumulativeProfit: 0,
        };
      });
      return res.json(points);
    }

    let bankroll = 1000;
    let cumulative = 0;
    const points = bets
      .filter((b) => b.result !== "pending")
      .map((b) => {
        const profit = b.profit ?? 0;
        cumulative += profit;
        bankroll += profit;
        return {
          date: new Date(b.gameDate).toISOString().split("T")[0],
          bankroll: parseFloat(bankroll.toFixed(2)),
          profit: parseFloat(profit.toFixed(2)),
          cumulativeProfit: parseFloat(cumulative.toFixed(2)),
        };
      });

    return res.json(points);
  } catch (err) {
    req.log.error({ err }, "Error fetching bankroll chart");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/bets", async (req, res) => {
  const parsed = GetBetsQueryParams.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Invalid query params" });
  const { sport, result } = parsed.data;
  const userId = req.user?.id ?? "anonymous";

  try {
    const conditions = [eq(betsTable.userId, userId)];
    const all = await db.select().from(betsTable)
      .where(and(...conditions))
      .orderBy(desc(betsTable.createdAt));

    let filtered = all;
    if (sport !== "all") filtered = filtered.filter((b) => b.sport === sport);
    if (result !== "all") filtered = filtered.filter((b) => b.result === result);

    return res.json(filtered);
  } catch (err) {
    req.log.error({ err }, "Error fetching bets");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/bets", async (req, res) => {
  const parsed = CreateBetBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request body", message: parsed.error.message });
  const userId = req.user?.id ?? "anonymous";

  try {
    const [bet] = await db.insert(betsTable).values({
      userId,
      gameId: parsed.data.gameId ?? null,
      sport: parsed.data.sport,
      homeTeam: parsed.data.homeTeam,
      awayTeam: parsed.data.awayTeam,
      team: parsed.data.team,
      betType: parsed.data.betType,
      bookmaker: parsed.data.bookmaker,
      odds: parsed.data.odds,
      stake: parsed.data.stake,
      result: "pending",
      profit: null,
      gameDate: parsed.data.gameDate,
      notes: parsed.data.notes ?? null,
    }).returning();
    return res.status(201).json(bet);
  } catch (err) {
    req.log.error({ err }, "Error creating bet");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/bets/:betId", async (req, res) => {
  const params = UpdateBetParams.safeParse(req.params);
  if (!params.success) return res.status(400).json({ error: "Invalid bet ID" });
  const body = UpdateBetBody.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "Invalid request body" });
  const userId = req.user?.id ?? "anonymous";

  try {
    const existing = await db.select().from(betsTable)
      .where(and(eq(betsTable.id, params.data.betId), eq(betsTable.userId, userId)));
    if (existing.length === 0) return res.status(404).json({ error: "Bet not found" });

    const updates: Partial<typeof betsTable.$inferInsert> = {};
    if (body.data.result !== undefined) {
      updates.result = body.data.result;
      updates.profit = calcProfit(existing[0].odds, existing[0].stake, body.data.result) ?? undefined;
    }
    if (body.data.notes !== undefined) updates.notes = body.data.notes;

    const [updated] = await db.update(betsTable)
      .set(updates)
      .where(eq(betsTable.id, params.data.betId))
      .returning();
    return res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Error updating bet");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/bets/:betId", async (req, res) => {
  const betId = parseInt(req.params.betId);
  if (isNaN(betId)) return res.status(400).json({ error: "Invalid bet ID" });
  const userId = req.user?.id ?? "anonymous";

  try {
    const existing = await db.select().from(betsTable)
      .where(and(eq(betsTable.id, betId), eq(betsTable.userId, userId)));
    if (existing.length === 0) return res.status(404).json({ error: "Bet not found" });

    await db.delete(betsTable).where(eq(betsTable.id, betId));
    return res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Error deleting bet");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

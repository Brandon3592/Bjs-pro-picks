import { Router } from "express";
import { db } from "@workspace/db";
import { aiPickHistoryTable } from "@workspace/db";
import { desc, eq, gte, sql } from "drizzle-orm";

const router = Router();

interface LogPickBody {
  sport: string;
  gameId?: string | null;
  homeTeam: string;
  awayTeam: string;
  pick: string;
  player?: string | null;
  bookmaker: string;
  odds: number;
  confidence: number;
  reasoning?: string | null;
  betType?: string;
  gameStartTime: string;
}

interface UpdatePickBody {
  result: "win" | "loss" | "pending";
  profit?: number | null;
}

router.get("/pick-history", async (req, res) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const picks = await db
      .select()
      .from(aiPickHistoryTable)
      .where(gte(aiPickHistoryTable.createdAt, thirtyDaysAgo))
      .orderBy(desc(aiPickHistoryTable.createdAt))
      .limit(100);
    return res.json(picks);
  } catch (err) {
    req.log.error({ err }, "Error fetching pick history");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/pick-history/stats", async (req, res) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const result = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE result = 'win')   AS wins,
        COUNT(*) FILTER (WHERE result = 'loss')  AS losses,
        COUNT(*) FILTER (WHERE result = 'pending') AS pending,
        COUNT(*) AS total,
        COALESCE(SUM(profit) FILTER (WHERE result IN ('win','loss')), 0) AS total_profit
      FROM ${aiPickHistoryTable}
      WHERE created_at >= ${thirtyDaysAgo}
    `);
    const r = (result.rows[0] ?? { wins: "0", losses: "0", pending: "0", total: "0", total_profit: "0" }) as { wins: string; losses: string; pending: string; total: string; total_profit: string };
    const wins = parseInt(r.wins ?? "0");
    const losses = parseInt(r.losses ?? "0");
    const total = wins + losses;
    return res.json({
      wins,
      losses,
      pending: parseInt(r.pending ?? "0"),
      total,
      winRate: total > 0 ? wins / total : null,
      totalProfit: parseFloat(r.total_profit ?? "0"),
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching pick history stats");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/pick-history", async (req, res) => {
  const d = req.body as LogPickBody;
  if (!d?.sport || !d?.homeTeam || !d?.awayTeam || !d?.pick || !d?.bookmaker || d?.odds == null || d?.confidence == null || !d?.gameStartTime) {
    return res.status(400).json({ error: "Invalid pick data" });
  }
  try {
    const [pick] = await db.insert(aiPickHistoryTable).values({
      sport: d.sport,
      gameId: d.gameId ?? null,
      homeTeam: d.homeTeam,
      awayTeam: d.awayTeam,
      pick: d.pick,
      player: d.player ?? null,
      bookmaker: d.bookmaker,
      odds: d.odds,
      confidence: d.confidence,
      reasoning: d.reasoning ?? null,
      betType: d.betType ?? "moneyline",
      gameStartTime: new Date(d.gameStartTime),
      result: "pending",
    }).returning();
    return res.status(201).json(pick);
  } catch (err) {
    req.log.error({ err }, "Error logging pick");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/pick-history/:pickId", async (req, res) => {
  const pickId = parseInt(req.params.pickId, 10);
  if (isNaN(pickId)) return res.status(400).json({ error: "Invalid pick id" });
  const d = req.body as UpdatePickBody;
  if (!d?.result || !["win", "loss", "pending"].includes(d.result)) {
    return res.status(400).json({ error: "Invalid update data" });
  }
  try {
    const [updated] = await db
      .update(aiPickHistoryTable)
      .set({ result: d.result, profit: d.profit ?? null })
      .where(eq(aiPickHistoryTable.id, pickId))
      .returning();
    if (!updated) return res.status(404).json({ error: "Pick not found" });
    return res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Error updating pick result");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

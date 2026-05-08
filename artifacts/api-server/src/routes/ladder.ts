import { Router } from "express";
import { db } from "@workspace/db";
import { ladderProgressTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router = Router();

function todayET(): string {
  const nowET = new Date(Date.now() - 4 * 3600_000);
  return nowET.toISOString().slice(0, 10);
}

router.get("/ladder-progress", async (req, res) => {
  const sport = typeof req.query.sport === "string" ? req.query.sport : "all";
  const userId = (req as any).user?.id ?? "default";

  try {
    const rows = await db
      .select()
      .from(ladderProgressTable)
      .where(and(eq(ladderProgressTable.userId, userId), eq(ladderProgressTable.sport, sport)));

    const progress = rows[0];
    const today = todayET();
    const settledToday = progress?.lastSettledDate === today;

    return res.json({
      currentDay: progress?.currentDay ?? 1,
      currentStake: progress?.currentStake ?? 10,
      settled: settledToday,
      result: settledToday ? (progress?.lastResult ?? null) : null,
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching ladder progress");
    return res.status(500).json({ error: "Internal server error" });
  }
});

interface SettleBody {
  sport: string;
  won: boolean;
  payout?: number;
}

router.post("/ladder-progress/settle", async (req, res) => {
  const body = req.body as SettleBody;
  const { sport, won, payout } = body;
  if (!sport || typeof won !== "boolean") {
    return res.status(400).json({ error: "sport and won are required" });
  }

  const userId = (req as any).user?.id ?? "default";
  const today = todayET();

  try {
    const rows = await db
      .select()
      .from(ladderProgressTable)
      .where(and(eq(ladderProgressTable.userId, userId), eq(ladderProgressTable.sport, sport)));

    const existing = rows[0];

    if (existing?.lastSettledDate === today) {
      return res.json({ ok: false, message: "Already settled today", currentDay: existing.currentDay, currentStake: existing.currentStake });
    }

    const currentDay = existing?.currentDay ?? 1;
    const newDay = won ? Math.min(currentDay + 1, 10) : 1;
    const newStake = won ? (payout ?? (existing?.currentStake ?? 10) * 2) : 10;

    if (existing) {
      await db
        .update(ladderProgressTable)
        .set({
          currentDay: newDay,
          currentStake: parseFloat(newStake.toFixed(2)),
          lastSettledDate: today,
          lastResult: won ? "won" : "lost",
          updatedAt: new Date(),
        })
        .where(and(eq(ladderProgressTable.userId, userId), eq(ladderProgressTable.sport, sport)));
    } else {
      await db
        .insert(ladderProgressTable)
        .values({
          userId,
          sport,
          currentDay: newDay,
          currentStake: parseFloat(newStake.toFixed(2)),
          lastSettledDate: today,
          lastResult: won ? "won" : "lost",
        });
    }

    return res.json({
      ok: true,
      currentDay: newDay,
      currentStake: parseFloat(newStake.toFixed(2)),
      message: won
        ? `Day ${newDay} ready for tomorrow! Roll $${newStake.toFixed(0)} onto the next bet.`
        : "Reset to Day 1. Start fresh tomorrow with $10.",
    });
  } catch (err) {
    req.log.error({ err }, "Error settling ladder progress");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

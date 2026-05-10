import { Router } from "express";
import { SubscribeAlertsBody } from "@workspace/api-zod";
import { db } from "@workspace/db";
import { alertSubscriptionsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router = Router();

// Expose VAPID public key so the frontend can subscribe without hardcoding
router.get("/alerts/vapid-key", (_req, res) => {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  if (!publicKey) {
    return res.status(503).json({ error: "Push notifications not configured" });
  }
  return res.json({ publicKey });
});

router.post("/alerts/subscribe", async (req, res) => {
  const parsed = SubscribeAlertsBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid subscription data" });
  const userId = req.user?.id ?? "anonymous";

  try {
    // Upsert by endpoint to avoid duplicates
    const existing = await db
      .select({ id: alertSubscriptionsTable.id })
      .from(alertSubscriptionsTable)
      .where(eq(alertSubscriptionsTable.endpoint, parsed.data.endpoint))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(alertSubscriptionsTable)
        .set({ active: true, minEdge: parsed.data.minEdge ?? 3 })
        .where(eq(alertSubscriptionsTable.id, existing[0].id));

      return res.json({
        id: existing[0].id,
        status: "active",
        message: "Push alerts updated.",
      });
    }

    const [sub] = await db.insert(alertSubscriptionsTable).values({
      userId,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
      minEdge: parsed.data.minEdge ?? 3,
      sports: parsed.data.sports ?? null,
      active: true,
    }).returning();

    return res.json({
      id: sub.id,
      status: "active",
      message: "Push alerts enabled. You will be notified when steam moves are detected.",
    });
  } catch (err) {
    req.log.error({ err }, "Error creating alert subscription");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/alerts/subscribe", async (req, res) => {
  const { endpoint } = req.body as { endpoint?: string };
  if (!endpoint) return res.status(400).json({ error: "endpoint required" });

  try {
    await db
      .update(alertSubscriptionsTable)
      .set({ active: false })
      .where(eq(alertSubscriptionsTable.endpoint, endpoint));
    return res.json({ status: "unsubscribed" });
  } catch (err) {
    req.log.error({ err }, "Error unsubscribing");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

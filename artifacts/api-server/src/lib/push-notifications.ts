import webpush from "web-push";
import { db, alertSubscriptionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

let initialized = false;

export function initWebPush() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    logger.warn("VAPID keys not set — push notifications disabled");
    return;
  }
  const subject = process.env.VAPID_SUBJECT ?? "mailto:alerts@edgefinder.app";
  webpush.setVapidDetails(subject, publicKey, privateKey);
  initialized = true;
  logger.info("Web push initialized");
}

export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  tag?: string;
  data?: Record<string, unknown>;
}

export async function sendPushToAll(payload: PushPayload): Promise<void> {
  if (!initialized) return;

  const subs = await db
    .select()
    .from(alertSubscriptionsTable)
    .where(eq(alertSubscriptionsTable.active, true));

  if (subs.length === 0) return;

  const message = JSON.stringify(payload);
  let sent = 0;
  const expired: number[] = [];

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          message,
        );
        sent++;
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          // Subscription expired or unregistered
          expired.push(sub.id);
        } else {
          logger.error({ err, subId: sub.id }, "Failed to send push notification");
        }
      }
    }),
  );

  // Clean up expired subscriptions
  if (expired.length > 0) {
    await Promise.all(
      expired.map((id) =>
        db
          .update(alertSubscriptionsTable)
          .set({ active: false })
          .where(eq(alertSubscriptionsTable.id, id)),
      ),
    );
  }

  logger.info({ sent, expired: expired.length, total: subs.length }, "Push notifications sent");
}

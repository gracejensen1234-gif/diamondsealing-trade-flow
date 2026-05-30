import webpush from "web-push";
import { db } from "@workspace/db";
import {
  notificationsTable,
  pushSubscriptionsTable,
  vapidConfigTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

let vapidInitialised = false;

export async function ensureVapid(): Promise<string> {
  if (vapidInitialised) {
    const [row] = await db.select().from(vapidConfigTable).limit(1);
    return row.publicKey;
  }

  const rows = await db.select().from(vapidConfigTable).limit(1);
  if (rows.length > 0) {
    const row = rows[0];
    webpush.setVapidDetails(row.subject, row.publicKey, row.privateKey);
    vapidInitialised = true;
    return row.publicKey;
  }

  // First run — generate and persist VAPID keys
  const keys = webpush.generateVAPIDKeys();
  const subject = "mailto:admin@diamondsealing.com.au";
  webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);

  await db.insert(vapidConfigTable).values({
    publicKey: keys.publicKey,
    privateKey: keys.privateKey,
    subject,
  });

  logger.info("Generated and saved new VAPID keys");
  vapidInitialised = true;
  return keys.publicKey;
}

export type NotificationType =
  | "new_job"
  | "job_changed"
  | "forgotten_action"
  | "missing_photos"
  | "missing_metres"
  | "missing_stock"
  | "stock_pickup_ready"
  | "upcoming_job"
  | "clock_on_reminder"
  | "break_reminder"
  | "weekly_performance"
  | "bonus_update"
  | "safety_reminder"
  | "audit_fix_request"
  | "general";

export type NotificationPriority = "urgent" | "high" | "normal" | "low";

export interface CreateNotificationOptions {
  subcontractorId: number;
  type: NotificationType;
  title: string;
  body: string;
  priority?: NotificationPriority;
  actionUrl?: string;
  linkedEntityType?: string;
  linkedEntityId?: number;
}

export async function createAndSendNotification(opts: CreateNotificationOptions) {
  await ensureVapid();

  const [notification] = await db
    .insert(notificationsTable)
    .values({
      subcontractorId: opts.subcontractorId,
      type: opts.type,
      title: opts.title,
      body: opts.body,
      priority: opts.priority ?? "normal",
      actionUrl: opts.actionUrl ?? null,
      linkedEntityType: opts.linkedEntityType ?? null,
      linkedEntityId: opts.linkedEntityId ?? null,
    })
    .returning();

  // Send push to all subscriptions for this sub
  const subscriptions = await db
    .select()
    .from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.subcontractorId, opts.subcontractorId));

  const pushPayload = JSON.stringify({
    title: opts.title,
    body: opts.body,
    type: opts.type,
    priority: opts.priority ?? "normal",
    actionUrl: opts.actionUrl ?? "/field",
    actionLabel: actionLabel(opts.type),
    tag: `ds-${opts.type}-${opts.linkedEntityId ?? notification.id}`,
    notificationId: notification.id,
  });

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        pushPayload
      );
    } catch (err: any) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        // Subscription expired — clean it up
        await db
          .delete(pushSubscriptionsTable)
          .where(eq(pushSubscriptionsTable.endpoint, sub.endpoint));
        logger.info({ endpoint: sub.endpoint }, "Removed expired push subscription");
      } else {
        logger.warn({ err, endpoint: sub.endpoint }, "Push send failed");
      }
    }
  }

  return notification;
}

function actionLabel(type: NotificationType): string {
  const labels: Record<NotificationType, string> = {
    new_job: "View Job",
    job_changed: "View Job",
    forgotten_action: "Take Action",
    missing_photos: "Submit Report",
    missing_metres: "Submit Report",
    missing_stock: "Submit Report",
    stock_pickup_ready: "View Stock",
    upcoming_job: "View Job",
    clock_on_reminder: "Clock On",
    break_reminder: "Start Break",
    weekly_performance: "View Stats",
    bonus_update: "View Bonus",
    safety_reminder: "Read Notice",
    audit_fix_request: "View Audit",
    general: "Open App",
  };
  return labels[type] ?? "Open";
}

import { Router } from "express";
import { db } from "@workspace/db";
import {
  notificationsTable,
  pushSubscriptionsTable,
} from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { ensureVapid, createAndSendNotification } from "../lib/notificationService";

const router = Router();

// GET /notifications?subcontractorId=&unreadOnly=&limit=
router.get("/notifications", async (req, res) => {
  const subId = parseInt(req.query.subcontractorId as string);
  if (isNaN(subId)) return res.status(400).json({ error: "subcontractorId required" });

  const unreadOnly = req.query.unreadOnly === "true";
  const limit = Math.min(parseInt(req.query.limit as string) || 100, 200);

  const conditions = unreadOnly
    ? and(eq(notificationsTable.subcontractorId, subId), eq(notificationsTable.isRead, false))
    : eq(notificationsTable.subcontractorId, subId);

  const rows = await db
    .select()
    .from(notificationsTable)
    .where(conditions)
    .orderBy(desc(notificationsTable.createdAt))
    .limit(limit);

  return res.json(rows);
});

// GET /notifications/unread-count?subcontractorId=
router.get("/notifications/unread-count", async (req, res) => {
  const subId = parseInt(req.query.subcontractorId as string);
  if (isNaN(subId)) return res.status(400).json({ error: "subcontractorId required" });

  const [row] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(notificationsTable)
    .where(and(eq(notificationsTable.subcontractorId, subId), eq(notificationsTable.isRead, false)));

  return res.json({ count: row?.count ?? 0 });
});

// POST /notifications/read-all
router.post("/notifications/read-all", async (req, res) => {
  const { subcontractorId } = req.body;
  if (!subcontractorId) return res.status(400).json({ error: "subcontractorId required" });

  const result = await db
    .update(notificationsTable)
    .set({ isRead: true, readAt: new Date() })
    .where(and(eq(notificationsTable.subcontractorId, subcontractorId), eq(notificationsTable.isRead, false)));

  return res.json({ updated: result.rowCount ?? 0 });
});

// PATCH /notifications/:id/read
router.patch("/notifications/:id/read", async (req, res) => {
  const id = parseInt(req.params.id);
  const [row] = await db
    .update(notificationsTable)
    .set({ isRead: true, readAt: new Date() })
    .where(eq(notificationsTable.id, id))
    .returning();

  if (!row) return res.status(404).json({ error: "Not found" });
  return res.json(row);
});

// DELETE /notifications/:id
router.delete("/notifications/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  await db.delete(notificationsTable).where(eq(notificationsTable.id, id));
  return res.status(204).send();
});

// POST /notifications  (admin create + push)
router.post("/notifications", async (req, res) => {
  const { subcontractorId, type, title, body, priority, actionUrl, linkedEntityType, linkedEntityId } = req.body;

  if (!subcontractorId || !type || !title || !body) {
    return res.status(400).json({ error: "subcontractorId, type, title, body required" });
  }

  const notification = await createAndSendNotification({
    subcontractorId,
    type,
    title,
    body,
    priority,
    actionUrl,
    linkedEntityType,
    linkedEntityId,
  });

  return res.status(201).json(notification);
});

// GET /push-subscriptions/vapid-public-key
router.get("/push-subscriptions/vapid-public-key", async (_req, res) => {
  const publicKey = await ensureVapid();
  return res.json({ publicKey });
});

// GET /push-subscriptions/status?subcontractorId=
router.get("/push-subscriptions/status", async (req, res) => {
  const subId = parseInt(req.query.subcontractorId as string);
  if (isNaN(subId)) return res.status(400).json({ error: "subcontractorId required" });

  const subscriptions = await db
    .select()
    .from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.subcontractorId, subId));

  return res.json({
    enabled: subscriptions.length > 0,
    subscriptionCount: subscriptions.length,
  });
});

// POST /push-subscriptions
router.post("/push-subscriptions", async (req, res) => {
  const { subcontractorId, endpoint, p256dh, auth, userAgent } = req.body;

  if (!subcontractorId || !endpoint || !p256dh || !auth) {
    return res.status(400).json({ error: "subcontractorId, endpoint, p256dh, auth required" });
  }

  // Upsert — if this endpoint already exists, update the subcontractor link
  const existing = await db
    .select()
    .from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.endpoint, endpoint))
    .limit(1);

  if (existing.length > 0) {
    const [row] = await db
      .update(pushSubscriptionsTable)
      .set({ subcontractorId, p256dh, auth, userAgent: userAgent ?? null })
      .where(eq(pushSubscriptionsTable.endpoint, endpoint))
      .returning();
    return res.status(201).json({ id: row.id });
  }

  const [row] = await db
    .insert(pushSubscriptionsTable)
    .values({ subcontractorId, endpoint, p256dh, auth, userAgent: userAgent ?? null })
    .returning();

  return res.status(201).json({ id: row.id });
});

// DELETE /push-subscriptions
router.delete("/push-subscriptions", async (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ error: "endpoint required" });

  await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.endpoint, endpoint));
  return res.status(204).send();
});

export default router;

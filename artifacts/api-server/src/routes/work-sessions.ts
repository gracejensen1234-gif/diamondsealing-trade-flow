import { Router } from "express";
import { db } from "@workspace/db";
import { workSessionsTable, subcontractorsTable, gpsTracksTable, activityTable } from "@workspace/db";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import {
  ClockOnBody,
  ClockOffBody,
  StartBreakBody,
  EndBreakBody,
  GetWorkSessionParams,
  UpdateWorkSessionParams,
  UpdateWorkSessionBody,
} from "@workspace/api-zod";
import {
  canAccessSubcontractor,
  companyId,
  requireAdmin,
  requireSubcontractorAccess,
  workerSubcontractorId,
} from "../lib/auth.js";

const router = Router();

function calcWorkMinutes(session: typeof workSessionsTable.$inferSelect): number | null {
  if (!session.clockedOnAt || !session.clockedOffAt) return null;
  const totalMs = new Date(session.clockedOffAt).getTime() - new Date(session.clockedOnAt).getTime();
  const workMs = totalMs - session.totalBreakMinutes * 60000;
  return Math.max(0, Math.round(workMs / 60000));
}

function enrichSession(session: typeof workSessionsTable.$inferSelect, subName: string) {
  return {
    ...session,
    subcontractorName: subName,
    totalWorkMinutes: calcWorkMinutes(session),
  };
}

router.post("/work-sessions/clock-on", async (req, res) => {
  const parsed = ClockOnBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid body" });
  if (!requireSubcontractorAccess(req, res, parsed.data.subcontractorId)) return;

  const today = new Date().toISOString().split("T")[0];
  const existing = await db.select().from(workSessionsTable).where(
    and(
      eq(workSessionsTable.companyId, companyId(req)),
      eq(workSessionsTable.subcontractorId, parsed.data.subcontractorId),
      eq(workSessionsTable.date, today),
    ),
  );
  if (existing[0]) return res.status(400).json({ error: "Already clocked on today" });

  const [sub] = await db
    .select()
    .from(subcontractorsTable)
    .where(and(eq(subcontractorsTable.id, parsed.data.subcontractorId), eq(subcontractorsTable.companyId, companyId(req))));
  if (!sub) return res.status(404).json({ error: "Subcontractor not found" });

  const [session] = await db.insert(workSessionsTable).values({
    subcontractorId: parsed.data.subcontractorId,
    companyId: companyId(req),
    date: today,
    status: "active",
    gpsEnabled: parsed.data.gpsEnabled ?? true,
    gpsDisabledOnBreak: parsed.data.gpsDisabledOnBreak ?? true,
    clockedOnAt: new Date(),
  }).returning();

  await db.insert(activityTable).values({
    companyId: companyId(req),
    type: "clocked_on",
    description: `${sub.name} clocked on`,
    entityId: session.id,
    entityType: "work_session",
  });

  return res.status(201).json(enrichSession(session, sub.name));
});

router.post("/work-sessions/clock-off", async (req, res) => {
  const parsed = ClockOffBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid body" });
  if (!requireSubcontractorAccess(req, res, parsed.data.subcontractorId)) return;

  const today = new Date().toISOString().split("T")[0];
  const [session] = await db.select().from(workSessionsTable).where(
    and(
      eq(workSessionsTable.companyId, companyId(req)),
      eq(workSessionsTable.subcontractorId, parsed.data.subcontractorId),
      eq(workSessionsTable.date, today),
    ),
  );
  if (!session) return res.status(404).json({ error: "No active session today" });
  if (session.status === "clocked_off") {
    return res.status(400).json({ error: "Already clocked off today" });
  }

  let totalBreakMinutes = session.totalBreakMinutes;
  if (session.status === "on_break" && session.breakStartAt) {
    const extraBreakMs = Date.now() - new Date(session.breakStartAt).getTime();
    totalBreakMinutes += Math.round(extraBreakMs / 60000);
  }

  const [updated] = await db.update(workSessionsTable).set({
    status: "clocked_off",
    clockedOffAt: new Date(),
    totalBreakMinutes,
    breakEndAt: session.status === "on_break" ? new Date() : session.breakEndAt,
  }).where(eq(workSessionsTable.id, session.id)).returning();

  const [sub] = await db
    .select()
    .from(subcontractorsTable)
    .where(and(eq(subcontractorsTable.id, parsed.data.subcontractorId), eq(subcontractorsTable.companyId, companyId(req))));

  await db.insert(activityTable).values({
    companyId: companyId(req),
    type: "clocked_off",
    description: `${sub?.name ?? "Subcontractor"} clocked off`,
    entityId: session.id,
    entityType: "work_session",
  });

  return res.json(enrichSession(updated, sub?.name ?? ""));
});

router.post("/work-sessions/break-start", async (req, res) => {
  const parsed = StartBreakBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid body" });
  if (!requireSubcontractorAccess(req, res, parsed.data.subcontractorId)) return;

  const today = new Date().toISOString().split("T")[0];
  const [session] = await db.select().from(workSessionsTable).where(
    and(
      eq(workSessionsTable.companyId, companyId(req)),
      eq(workSessionsTable.subcontractorId, parsed.data.subcontractorId),
      eq(workSessionsTable.date, today),
    ),
  );
  if (!session || session.status !== "active") return res.status(400).json({ error: "No active session" });

  const [updated] = await db.update(workSessionsTable).set({
    status: "on_break",
    breakStartAt: new Date(),
  }).where(eq(workSessionsTable.id, session.id)).returning();

  const [sub] = await db
    .select()
    .from(subcontractorsTable)
    .where(and(eq(subcontractorsTable.id, parsed.data.subcontractorId), eq(subcontractorsTable.companyId, companyId(req))));
  return res.json(enrichSession(updated, sub?.name ?? ""));
});

router.post("/work-sessions/break-end", async (req, res) => {
  const parsed = EndBreakBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid body" });
  if (!requireSubcontractorAccess(req, res, parsed.data.subcontractorId)) return;

  const today = new Date().toISOString().split("T")[0];
  const [session] = await db.select().from(workSessionsTable).where(
    and(
      eq(workSessionsTable.companyId, companyId(req)),
      eq(workSessionsTable.subcontractorId, parsed.data.subcontractorId),
      eq(workSessionsTable.date, today),
    ),
  );
  if (!session || session.status !== "on_break") return res.status(400).json({ error: "Not on break" });

  let extraMinutes = 0;
  if (session.breakStartAt) {
    extraMinutes = Math.round((Date.now() - new Date(session.breakStartAt).getTime()) / 60000);
  }

  const [updated] = await db.update(workSessionsTable).set({
    status: "active",
    breakEndAt: new Date(),
    totalBreakMinutes: session.totalBreakMinutes + extraMinutes,
  }).where(eq(workSessionsTable.id, session.id)).returning();

  const [sub] = await db
    .select()
    .from(subcontractorsTable)
    .where(and(eq(subcontractorsTable.id, parsed.data.subcontractorId), eq(subcontractorsTable.companyId, companyId(req))));
  return res.json(enrichSession(updated, sub?.name ?? ""));
});

router.get("/work-sessions/today", async (req, res) => {
  const subcontractorId = Number(req.query.subcontractorId);
  if (!subcontractorId) return res.status(400).json({ error: "subcontractorId required" });
  if (!requireSubcontractorAccess(req, res, subcontractorId)) return;

  const today = new Date().toISOString().split("T")[0];
  const [session] = await db.select().from(workSessionsTable).where(
    and(eq(workSessionsTable.companyId, companyId(req)), eq(workSessionsTable.subcontractorId, subcontractorId), eq(workSessionsTable.date, today)),
  );
  if (!session) return res.status(404).json({ error: "No session today" });

  const [sub] = await db
    .select()
    .from(subcontractorsTable)
    .where(and(eq(subcontractorsTable.id, subcontractorId), eq(subcontractorsTable.companyId, companyId(req))));
  return res.json(enrichSession(session, sub?.name ?? ""));
});

router.get("/work-sessions", async (req, res) => {
  const ownSubcontractorId = workerSubcontractorId(req);
  const subcontractorId = ownSubcontractorId ?? (req.query.subcontractorId ? Number(req.query.subcontractorId) : undefined);
  const date = req.query.date as string | undefined;
  const weekStart = req.query.weekStart as string | undefined;

  const conditions = [eq(workSessionsTable.companyId, companyId(req))];
  if (subcontractorId) conditions.push(eq(workSessionsTable.subcontractorId, subcontractorId));
  if (date) conditions.push(eq(workSessionsTable.date, date));
  if (weekStart) {
    const end = new Date(weekStart);
    end.setDate(end.getDate() + 6);
    conditions.push(gte(workSessionsTable.date, weekStart));
    conditions.push(lte(workSessionsTable.date, end.toISOString().split("T")[0]));
  }

  const sessions = await db.select().from(workSessionsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(workSessionsTable.date));

  const subs = await db.select().from(subcontractorsTable).where(eq(subcontractorsTable.companyId, companyId(req)));
  const subMap = new Map(subs.map((s) => [s.id, s.name]));

  return res.json(sessions.map((s) => enrichSession(s, subMap.get(s.subcontractorId) ?? "")));
});

router.get("/work-sessions/:id", async (req, res) => {
  const parsed = GetWorkSessionParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });

  const [session] = await db
    .select()
    .from(workSessionsTable)
    .where(and(eq(workSessionsTable.id, parsed.data.id), eq(workSessionsTable.companyId, companyId(req))));
  if (!session) return res.status(404).json({ error: "Not found" });
  if (!canAccessSubcontractor(req, session.subcontractorId)) {
    return res.status(403).json({ error: "You can only view your own timesheets" });
  }

  const [sub] = await db
    .select()
    .from(subcontractorsTable)
    .where(and(eq(subcontractorsTable.id, session.subcontractorId), eq(subcontractorsTable.companyId, companyId(req))));
  const gpsTrack = await db.select().from(gpsTracksTable)
    .where(and(eq(gpsTracksTable.companyId, companyId(req)), eq(gpsTracksTable.workSessionId, session.id)))
    .orderBy(gpsTracksTable.recordedAt);

  return res.json({
    ...enrichSession(session, sub?.name ?? ""),
    gpsTrack: gpsTrack.map((g) => ({
      ...g,
      latitude: Number(g.latitude),
      longitude: Number(g.longitude),
      accuracy: g.accuracy ? Number(g.accuracy) : null,
    })),
  });
});

router.patch("/work-sessions/:id", requireAdmin, async (req, res) => {
  const params = UpdateWorkSessionParams.safeParse({ id: Number(req.params.id) });
  const body = UpdateWorkSessionBody.safeParse(req.body);
  if (!params.success || !body.success) return res.status(400).json({ error: "Invalid request" });

  const updates: Record<string, unknown> = {};
  if (body.data.clockedOnAt !== undefined) updates.clockedOnAt = new Date(body.data.clockedOnAt);
  if (body.data.clockedOffAt !== undefined) updates.clockedOffAt = new Date(body.data.clockedOffAt);
  if (body.data.totalBreakMinutes !== undefined) updates.totalBreakMinutes = body.data.totalBreakMinutes;
  if (body.data.gpsEnabled !== undefined) updates.gpsEnabled = body.data.gpsEnabled;
  if (body.data.gpsDisabledOnBreak !== undefined) updates.gpsDisabledOnBreak = body.data.gpsDisabledOnBreak;

  const [session] = await db
    .update(workSessionsTable)
    .set(updates)
    .where(and(eq(workSessionsTable.id, params.data.id), eq(workSessionsTable.companyId, companyId(req))))
    .returning();
  if (!session) return res.status(404).json({ error: "Not found" });

  const [sub] = await db
    .select()
    .from(subcontractorsTable)
    .where(and(eq(subcontractorsTable.id, session.subcontractorId), eq(subcontractorsTable.companyId, companyId(req))));
  return res.json(enrichSession(session, sub?.name ?? ""));
});

export default router;

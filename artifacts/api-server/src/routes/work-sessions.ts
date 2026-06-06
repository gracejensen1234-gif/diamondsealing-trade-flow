import { Router } from "express";
import { db } from "@workspace/db";
import {
  activityTable,
  gpsTracksTable,
  jobAssignmentsTable,
  jobsTable,
  locationVerificationsTable,
  subcontractorsTable,
  workSessionsTable,
} from "@workspace/db";
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
  isAdmin,
  requireAdmin,
  requireSubcontractorAccess,
  workerSubcontractorId,
} from "../lib/auth.js";
import { runJobAssignmentTriggers } from "../lib/assignmentTriggers.js";

const router = Router();
const MAX_BREAK_MINUTES = 60;

function clampBreakMinutes(minutes: number) {
  return Math.min(MAX_BREAK_MINUTES, Math.max(0, Math.round(minutes)));
}

function elapsedBreakMinutes(startedAt: Date | string | null | undefined) {
  if (!startedAt) return 0;
  return Math.max(
    0,
    Math.round((Date.now() - new Date(startedAt).getTime()) / 60000),
  );
}

function sessionBreakMinutes(session: typeof workSessionsTable.$inferSelect) {
  const base = clampBreakMinutes(session.totalBreakMinutes ?? 0);
  if (session.status !== "on_break") return base;
  const remaining = Math.max(0, MAX_BREAK_MINUTES - base);
  return clampBreakMinutes(base + Math.min(remaining, elapsedBreakMinutes(session.breakStartAt)));
}

function calcWorkMinutes(session: typeof workSessionsTable.$inferSelect): number | null {
  if (!session.clockedOnAt || !session.clockedOffAt) return null;
  const totalMs = new Date(session.clockedOffAt).getTime() - new Date(session.clockedOnAt).getTime();
  const workMs = totalMs - sessionBreakMinutes(session) * 60000;
  return Math.max(0, Math.round(workMs / 60000));
}

function enrichSession(session: typeof workSessionsTable.$inferSelect, subName: string) {
  return {
    ...session,
    subcontractorName: subName,
    totalWorkMinutes: calcWorkMinutes(session),
  };
}

function appendNote(existing: string | null | undefined, note: string) {
  return [existing, note].filter(Boolean).join("\n");
}

function parseAdminClockOffEarlyBody(body: unknown) {
  if (!body || typeof body !== "object") return null;
  const raw = body as { subcontractorId?: unknown; reason?: unknown };
  const subcontractorId = Number(raw.subcontractorId);
  if (!Number.isInteger(subcontractorId) || subcontractorId <= 0) return null;
  const reason = typeof raw.reason === "string" ? raw.reason.slice(0, 500) : undefined;
  return { subcontractorId, reason };
}

router.post("/work-sessions/clock-on", async (req, res) => {
  const parsed = ClockOnBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid body" });
  if (!requireSubcontractorAccess(req, res, parsed.data.subcontractorId)) return;
  const currentCompanyId = companyId(req);

  const today = new Date().toISOString().split("T")[0];
  const existing = await db.select().from(workSessionsTable).where(
    and(
      eq(workSessionsTable.companyId, currentCompanyId),
      eq(workSessionsTable.subcontractorId, parsed.data.subcontractorId),
      eq(workSessionsTable.date, today),
    ),
  );
  if (existing[0]) return res.status(400).json({ error: "Already clocked on today" });

  const [sub] = await db
    .select()
    .from(subcontractorsTable)
    .where(and(eq(subcontractorsTable.id, parsed.data.subcontractorId), eq(subcontractorsTable.companyId, currentCompanyId)));
  if (!sub) return res.status(404).json({ error: "Subcontractor not found" });

  const locationVerificationId = parsed.data.locationVerificationId ?? null;
  if (!isAdmin(req)) {
    if (!locationVerificationId) {
      return res.status(400).json({ error: "Location is required before clocking on" });
    }

    const [verification] = await db
      .select()
      .from(locationVerificationsTable)
      .where(
        and(
          eq(locationVerificationsTable.id, locationVerificationId),
          eq(locationVerificationsTable.companyId, currentCompanyId),
          eq(locationVerificationsTable.subcontractorId, parsed.data.subcontractorId),
        ),
      );

    const isFresh = verification ? Date.now() - new Date(verification.createdAt).getTime() <= 15 * 60 * 1000 : false;
    const hasCapturedLocation =
      verification?.reportedLat != null &&
      verification?.reportedLng != null &&
      verification.workerConsented;
    const validStatus = verification?.status !== "skipped" && verification?.status !== "location_error";

    if (
      !verification ||
      verification.eventType !== "clock_on" ||
      verification.workSessionId ||
      !isFresh ||
      !hasCapturedLocation ||
      !validStatus
    ) {
      return res.status(400).json({ error: "A fresh location check is required before clocking on" });
    }
  }

  const [session] = await db.insert(workSessionsTable).values({
    subcontractorId: parsed.data.subcontractorId,
    companyId: currentCompanyId,
    date: today,
    status: "active",
    gpsEnabled: parsed.data.gpsEnabled ?? true,
    gpsDisabledOnBreak: parsed.data.gpsDisabledOnBreak ?? true,
    clockedOnAt: new Date(),
  }).returning();

  if (locationVerificationId) {
    await db
      .update(locationVerificationsTable)
      .set({ workSessionId: session.id })
      .where(and(eq(locationVerificationsTable.id, locationVerificationId), eq(locationVerificationsTable.companyId, currentCompanyId)));
  }

  await db.insert(activityTable).values({
    companyId: currentCompanyId,
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

  const totalBreakMinutes = sessionBreakMinutes(session);

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

router.post("/work-sessions/admin-clock-off-early", requireAdmin, async (req, res) => {
  const parsed = parseAdminClockOffEarlyBody(req.body);
  if (!parsed) return res.status(400).json({ error: "Invalid body" });

  const tenantId = companyId(req);
  const today = new Date().toISOString().split("T")[0];
  const reason = parsed.reason?.trim() || "admin early clock-off";

  const [sub] = await db
    .select()
    .from(subcontractorsTable)
    .where(and(eq(subcontractorsTable.id, parsed.subcontractorId), eq(subcontractorsTable.companyId, tenantId)));
  if (!sub) return res.status(404).json({ error: "Employee/subcontractor not found" });

  const [session] = await db
    .select()
    .from(workSessionsTable)
    .where(
      and(
        eq(workSessionsTable.companyId, tenantId),
        eq(workSessionsTable.subcontractorId, parsed.subcontractorId),
        eq(workSessionsTable.date, today),
      ),
    );

  let updatedSession: typeof workSessionsTable.$inferSelect | null = session ?? null;
  if (session && session.status !== "clocked_off") {
    const totalBreakMinutes = sessionBreakMinutes(session);
    [updatedSession] = await db
      .update(workSessionsTable)
      .set({
        status: "clocked_off",
        clockedOffAt: new Date(),
        totalBreakMinutes,
        breakEndAt: session.status === "on_break" ? new Date() : session.breakEndAt,
      })
      .where(and(eq(workSessionsTable.id, session.id), eq(workSessionsTable.companyId, tenantId)))
      .returning();
  }

  const remainingAssignments = await db
    .select()
    .from(jobAssignmentsTable)
    .where(
      and(
        eq(jobAssignmentsTable.companyId, tenantId),
        eq(jobAssignmentsTable.subcontractorId, parsed.subcontractorId),
        eq(jobAssignmentsTable.dispatchDate, today),
        eq(jobAssignmentsTable.status, "pending"),
      ),
    )
    .orderBy(jobAssignmentsTable.scheduledOrder);

  const results: Array<{
    assignmentId: number;
    jobId: number | null;
    status: string;
    reason: string;
    selectedSubcontractorId?: number;
    replacementSubcontractorName?: string | null;
  }> = [];

  for (const assignment of remainingAssignments) {
    if (!assignment.jobId) {
      await db
        .update(jobAssignmentsTable)
        .set({
          subcontractorId: null,
          notes: appendNote(assignment.notes, `Released because ${sub.name} was clocked off early by admin: ${reason}.`),
        })
        .where(and(eq(jobAssignmentsTable.id, assignment.id), eq(jobAssignmentsTable.companyId, tenantId)));
      results.push({
        assignmentId: assignment.id,
        jobId: null,
        status: "released_unassigned",
        reason: "Work block has no linked job, so it was released for manual review",
      });
      continue;
    }

    const [job] = await db
      .select()
      .from(jobsTable)
      .where(and(eq(jobsTable.id, assignment.jobId), eq(jobsTable.companyId, tenantId)));

    if (!job) {
      await db
        .update(jobAssignmentsTable)
        .set({
          subcontractorId: null,
          notes: appendNote(assignment.notes, `Released because ${sub.name} was clocked off early by admin: ${reason}.`),
        })
        .where(and(eq(jobAssignmentsTable.id, assignment.id), eq(jobAssignmentsTable.companyId, tenantId)));
      results.push({
        assignmentId: assignment.id,
        jobId: assignment.jobId,
        status: "released_unassigned",
        reason: "Linked job could not be found, so the work block was released for manual review",
      });
      continue;
    }

    try {
      const triggerResult = await runJobAssignmentTriggers({
        tenantId,
        job,
        trigger: "updated",
        options: {
          reassignAssignmentId: assignment.id,
          excludeSubcontractorIds: [parsed.subcontractorId],
          requireNotClockedOffOnDate: true,
          allowBestAvailable: true,
          reason: `${sub.name} clocked off early`,
        },
      });

      let replacementName: string | null = null;
      if (triggerResult.selectedSubcontractorId) {
        const [replacement] = await db
          .select({ name: subcontractorsTable.name })
          .from(subcontractorsTable)
          .where(
            and(
              eq(subcontractorsTable.id, triggerResult.selectedSubcontractorId),
              eq(subcontractorsTable.companyId, tenantId),
            ),
          );
        replacementName = replacement?.name ?? null;
      }

      if (!triggerResult.jobAssignmentId || triggerResult.status !== "auto_assigned") {
        await db
          .update(jobAssignmentsTable)
          .set({
            subcontractorId: null,
            notes: appendNote(assignment.notes, `Released because ${sub.name} was clocked off early by admin: ${reason}. Review trigger recommendation before assigning.`),
          })
          .where(and(eq(jobAssignmentsTable.id, assignment.id), eq(jobAssignmentsTable.companyId, tenantId)));
      }

      results.push({
        assignmentId: assignment.id,
        jobId: assignment.jobId,
        status: triggerResult.status,
        reason: triggerResult.reason,
        selectedSubcontractorId: triggerResult.selectedSubcontractorId,
        replacementSubcontractorName: replacementName,
      });
    } catch (err) {
      req.log.warn({ err, assignmentId: assignment.id }, "Early clock-off reassignment failed");
      await db
        .update(jobAssignmentsTable)
        .set({
          subcontractorId: null,
          notes: appendNote(assignment.notes, `Released because ${sub.name} was clocked off early by admin: ${reason}. Automatic reassignment failed.`),
        })
        .where(and(eq(jobAssignmentsTable.id, assignment.id), eq(jobAssignmentsTable.companyId, tenantId)));
      results.push({
        assignmentId: assignment.id,
        jobId: assignment.jobId,
        status: "released_unassigned",
        reason: "Automatic reassignment failed, so the work block was released for manual review",
      });
    }
  }

  await db.insert(activityTable).values({
    companyId: tenantId,
    type: "clocked_off",
    description: `${sub.name} was clocked off early by admin; ${results.length} remaining work block(s) reviewed for reassignment`,
    entityId: updatedSession?.id ?? sub.id,
    entityType: updatedSession ? "work_session" : "subcontractor",
  });

  return res.json({
    session: updatedSession ? enrichSession(updatedSession, sub.name) : null,
    remainingAssignmentsChecked: remainingAssignments.length,
    reassignedCount: results.filter((result) => result.status === "auto_assigned").length,
    reviewRequiredCount: results.filter((result) => result.status !== "auto_assigned").length,
    results,
  });
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
  if (clampBreakMinutes(session.totalBreakMinutes ?? 0) >= MAX_BREAK_MINUTES) {
    return res.status(400).json({ error: "Daily break limit reached" });
  }

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

  const remainingBreakMinutes = Math.max(
    0,
    MAX_BREAK_MINUTES - clampBreakMinutes(session.totalBreakMinutes ?? 0),
  );
  const extraMinutes = Math.min(
    remainingBreakMinutes,
    elapsedBreakMinutes(session.breakStartAt),
  );

  const [updated] = await db.update(workSessionsTable).set({
    status: "active",
    breakEndAt: new Date(),
    totalBreakMinutes: clampBreakMinutes((session.totalBreakMinutes ?? 0) + extraMinutes),
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
  if (body.data.totalBreakMinutes !== undefined) updates.totalBreakMinutes = clampBreakMinutes(body.data.totalBreakMinutes);
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

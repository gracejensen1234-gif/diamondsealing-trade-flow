import { Router } from "express";
import { db } from "@workspace/db";
import {
  subcontractorsTable, workSessionsTable, jobAssignmentsTable,
  jobReportsTable, gpsTracksTable, jobsTable
} from "@workspace/db";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { companyId } from "../lib/auth.js";

const router = Router();

router.get("/admin/live", async (req, res) => {
  const today = new Date().toISOString().split("T")[0];
  const tenantId = companyId(req);

  const subs = await db.select().from(subcontractorsTable).where(and(eq(subcontractorsTable.companyId, tenantId), eq(subcontractorsTable.active, true)));
  const sessions = await db.select().from(workSessionsTable).where(and(eq(workSessionsTable.companyId, tenantId), eq(workSessionsTable.date, today)));
  const assignments = await db.select().from(jobAssignmentsTable).where(and(eq(jobAssignmentsTable.companyId, tenantId), eq(jobAssignmentsTable.dispatchDate, today)));
  const reports = await db.select().from(jobReportsTable).where(and(eq(jobReportsTable.companyId, tenantId), eq(jobReportsTable.dispatchDate, today)));

  const result = await Promise.all(subs.map(async (sub) => {
    const session = sessions.find((s) => s.subcontractorId === sub.id);
    const subReports = reports.filter((r) => r.subcontractorId === sub.id);
    const totalMetresToday = subReports.reduce((sum, r) => sum + Number(r.metersCompleted), 0);
    const completedAssignments = assignments.filter(
      (a) => a.subcontractorId === sub.id && a.status === "completed"
    );

    const activeAssignment = assignments.find(
      (a) => a.subcontractorId === sub.id && (a.status === "arrived" || a.status === "in_progress")
    );
    let currentJobTitle: string | null = null;
    let currentJobAddress: string | null = null;
    if (activeAssignment?.jobId) {
      const [job] = await db.select().from(jobsTable).where(and(eq(jobsTable.id, activeAssignment.jobId), eq(jobsTable.companyId, tenantId)));
      currentJobTitle = job?.title ?? null;
      currentJobAddress = job?.address ?? null;
    }

    let lastLocation = null;
    if (session) {
      const [track] = await db.select().from(gpsTracksTable)
        .where(and(eq(gpsTracksTable.companyId, tenantId), eq(gpsTracksTable.workSessionId, session.id)))
        .orderBy(desc(gpsTracksTable.recordedAt))
        .limit(1);
      if (track) {
        lastLocation = {
          latitude: Number(track.latitude),
          longitude: Number(track.longitude),
          recordedAt: track.recordedAt,
        };
      }
    }

    return {
      subcontractorId: sub.id,
      subcontractorName: sub.name,
      sessionStatus: session?.status === "active" ? "active"
        : session?.status === "on_break" ? "on_break"
        : session?.status === "clocked_off" ? "clocked_off"
        : "not_started",
      clockedOnAt: session?.clockedOnAt ?? null,
      currentJobTitle,
      currentJobAddress,
      jobsCompleted: completedAssignments.length,
      totalMetresToday,
      lastLocation,
    };
  }));

  return res.json(result);
});

router.get("/admin/timesheets", async (req, res) => {
  const weekStart = req.query.weekStart as string | undefined;
  const subcontractorId = req.query.subcontractorId ? Number(req.query.subcontractorId) : undefined;
  const tenantId = companyId(req);

  const today = new Date().toISOString().split("T")[0];
  const startDate = weekStart ?? (() => {
    const d = new Date();
    d.setDate(d.getDate() - d.getDay() + 1);
    return d.toISOString().split("T")[0];
  })();
  const endDate = (() => {
    const d = new Date(startDate);
    d.setDate(d.getDate() + 6);
    return d.toISOString().split("T")[0];
  })();

  const conditions = [
    eq(workSessionsTable.companyId, tenantId),
    gte(workSessionsTable.date, startDate),
    lte(workSessionsTable.date, endDate),
  ];
  if (subcontractorId) conditions.push(eq(workSessionsTable.subcontractorId, subcontractorId));

  const sessions = await db.select().from(workSessionsTable).where(and(...conditions)).orderBy(workSessionsTable.date);
  const subs = await db.select().from(subcontractorsTable).where(eq(subcontractorsTable.companyId, tenantId));
  const subMap = new Map(subs.map((s) => [s.id, s.name]));

  const reports = await db.select().from(jobReportsTable)
    .where(and(eq(jobReportsTable.companyId, tenantId), gte(jobReportsTable.dispatchDate, startDate), lte(jobReportsTable.dispatchDate, endDate)));

  const result = sessions.map((session) => {
    const dayReports = reports.filter(
      (r) => r.subcontractorId === session.subcontractorId && r.dispatchDate === session.date
    );
    const totalMetres = dayReports.reduce((s, r) => s + Number(r.metersCompleted), 0);

    let totalWorkMinutes: number | null = null;
    if (session.clockedOnAt && session.clockedOffAt) {
      const totalMs = new Date(session.clockedOffAt).getTime() - new Date(session.clockedOnAt).getTime();
      totalWorkMinutes = Math.max(0, Math.round(totalMs / 60000) - session.totalBreakMinutes);
    }

    return {
      sessionId: session.id,
      subcontractorId: session.subcontractorId,
      subcontractorName: subMap.get(session.subcontractorId) ?? "",
      date: session.date,
      status: session.status,
      clockedOnAt: session.clockedOnAt,
      clockedOffAt: session.clockedOffAt,
      totalWorkMinutes,
      totalBreakMinutes: session.totalBreakMinutes,
      jobsCompleted: dayReports.length,
      totalMetres,
    };
  });

  return res.json(result);
});

export default router;

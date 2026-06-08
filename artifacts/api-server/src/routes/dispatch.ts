import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { jobAssignmentsTable, jobReportsTable, jobsTable, subcontractorsTable, workSessionsTable, customersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  CreateDispatchBody,
  UpdateJobAssignmentParams,
  UpdateJobAssignmentBody,
  DeleteJobAssignmentParams,
  MarkArrivedParams,
  MarkDepartedParams,
} from "@workspace/api-zod";
import { dateOnlyOrToday } from "../lib/date-utils.js";
import { createAndSendNotification } from "../lib/notificationService.js";
import { canAccessSubcontractor, companyId, isAdmin, requireAdmin, workerSubcontractorId } from "../lib/auth.js";

const router = Router();

type AssignmentProgress = Pick<
  typeof jobAssignmentsTable.$inferSelect,
  "id" | "dispatchDate" | "scheduledOrder" | "subcontractorId" | "status"
>;

type AssignmentVisibilityContext = {
  workerSubcontractorId?: number | null;
  dayAssignments?: AssignmentProgress[];
};

function deriveSuburb(address?: string | null) {
  if (!address) return null;
  const statePostcodeMatch = address.match(
    /(?:^|,|\s)([A-Za-z][A-Za-z\s'’-]+?)\s+(?:QLD|NSW|VIC|ACT|SA|WA|TAS|NT)\s+\d{4}(?:\s|$)/i,
  );
  if (statePostcodeMatch?.[1]) return statePostcodeMatch[1].trim();

  const parts = address
    .split(",")
    .map((part) =>
      part
        .replace(/\b(QLD|NSW|VIC|ACT|SA|WA|TAS|NT|Australia)\b/gi, "")
        .replace(/\b\d{4}\b/g, "")
        .trim(),
    )
    .filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 1];
  return null;
}

function canShowWorkerAddress(
  assignment: AssignmentProgress,
  context: AssignmentVisibilityContext,
) {
  const workerSubcontractorId = context.workerSubcontractorId;
  if (!workerSubcontractorId) return true;
  if (assignment.subcontractorId !== workerSubcontractorId) return false;
  if (assignment.status !== "pending") return true;

  const sameDayAssignments = (context.dayAssignments ?? [])
    .filter(
      (item) =>
        item.subcontractorId === assignment.subcontractorId &&
        item.dispatchDate === assignment.dispatchDate,
    )
    .sort((a, b) => a.scheduledOrder - b.scheduledOrder);
  const previousAssignments = sameDayAssignments.filter(
    (item) => item.scheduledOrder < assignment.scheduledOrder,
  );

  return (
    previousAssignments.length === 0 ||
    previousAssignments.every((item) => item.status === "completed")
  );
}

function addressVisibilityReason(
  assignment: AssignmentProgress,
  context: AssignmentVisibilityContext,
) {
  if (!context.workerSubcontractorId) return "admin";
  if (assignment.status !== "pending") return "current_or_completed";
  return canShowWorkerAddress(assignment, context)
    ? "next_job_unlocked"
    : "locked_until_previous_job_completed";
}

async function requireOpenWorkdayForWorker(req: Request, res: Response, subcontractorId: number | null | undefined) {
  if (isAdmin(req)) return true;
  if (!subcontractorId) {
    res.status(400).json({ error: "Assigned employee/subcontractor is required" });
    return false;
  }

  const today = new Date().toISOString().split("T")[0];
  const [session] = await db
    .select()
    .from(workSessionsTable)
    .where(
      and(
        eq(workSessionsTable.companyId, companyId(req)),
        eq(workSessionsTable.subcontractorId, subcontractorId),
        eq(workSessionsTable.date, today),
      ),
    );

  if (!session || session.status === "clocked_off") {
    res.status(400).json({ error: "Clock on for the day before checking in to jobs" });
    return false;
  }
  if (session.status === "on_break") {
    res.status(400).json({ error: "End break before continuing job steps" });
    return false;
  }

  return true;
}

async function requirePreviousJobsCompleted(
  req: Request,
  res: Response,
  assignment: typeof jobAssignmentsTable.$inferSelect,
) {
  if (isAdmin(req)) return true;
  if (!assignment.subcontractorId) {
    res.status(400).json({ error: "Assigned employee/subcontractor is required" });
    return false;
  }

  const previousAssignments = await db
    .select({
      id: jobAssignmentsTable.id,
      status: jobAssignmentsTable.status,
      scheduledOrder: jobAssignmentsTable.scheduledOrder,
    })
    .from(jobAssignmentsTable)
    .where(
      and(
        eq(jobAssignmentsTable.companyId, companyId(req)),
        eq(jobAssignmentsTable.subcontractorId, assignment.subcontractorId),
        eq(jobAssignmentsTable.dispatchDate, assignment.dispatchDate),
      ),
    );

  const unfinishedPrevious = previousAssignments
    .filter((item) => item.scheduledOrder < assignment.scheduledOrder)
    .some((item) => item.status !== "completed");
  if (unfinishedPrevious) {
    res.status(400).json({
      error: "Complete the previous job report before checking in to this job",
    });
    return false;
  }

  return true;
}

async function enrichAssignment(
  a: typeof jobAssignmentsTable.$inferSelect,
  context: AssignmentVisibilityContext = {},
) {
  const tenantId = a.companyId ?? 0;
  let jobTitle: string | null = null;
  let fullJobAddress: string | null = null;
  let jobDescription: string | null = null;
  let jobSuburb: string | null = null;
  let clientName: string | null = null;
  let jobBuilderCompanyName: string | null = null;
  let jobBuilderContactName: string | null = null;
  let jobBuilderContactPhone: string | null = null;
  let jobRequiredColours: string[] = [];
  let subcontractorName: string | null = null;

  if (a.jobId) {
    const [row] = await db
      .select({
        job: jobsTable,
        customerName: customersTable.name,
        customerSuburb: customersTable.suburb,
      })
      .from(jobsTable)
      .leftJoin(
        customersTable,
        and(
          eq(jobsTable.customerId, customersTable.id),
          eq(customersTable.companyId, tenantId),
        ),
      )
      .where(and(eq(jobsTable.id, a.jobId), eq(jobsTable.companyId, tenantId)));
    const j = row?.job;
    jobTitle = j?.title ?? null;
    fullJobAddress = j?.address ?? null;
    jobDescription = j?.description ?? null;
    jobSuburb = row?.customerSuburb ?? deriveSuburb(j?.address) ?? null;
    clientName = row?.customerName ?? null;
    jobBuilderCompanyName = j?.builderCompanyName ?? null;
    jobBuilderContactName = j?.builderContactName ?? null;
    jobBuilderContactPhone = j?.builderContactPhone ?? null;
    jobRequiredColours = Array.isArray(j?.requiredColours)
      ? (j.requiredColours as string[])
      : [];
  }
  if (a.subcontractorId) {
    const [s] = await db
      .select()
      .from(subcontractorsTable)
      .where(and(eq(subcontractorsTable.id, a.subcontractorId), eq(subcontractorsTable.companyId, tenantId)));
    subcontractorName = s?.name ?? null;
  }
  const [report] = await db
    .select({ id: jobReportsTable.id, photos: jobReportsTable.photos })
    .from(jobReportsTable)
    .where(and(eq(jobReportsTable.jobAssignmentId, a.id), eq(jobReportsTable.companyId, tenantId)))
    .limit(1);
  const reportPhotos = Array.isArray(report?.photos) ? report.photos : [];
  const jobAddressVisible = canShowWorkerAddress(a, context);

  return {
    ...a,
    jobTitle,
    jobAddress: jobAddressVisible ? fullJobAddress : null,
    jobSuburb,
    jobAddressVisible,
    addressVisibilityReason: addressVisibilityReason(a, context),
    jobDescription: jobAddressVisible ? jobDescription : null,
    clientName,
    subcontractorName,
    workArea: a.workArea,
    timeWindow: a.timeWindow ?? "full_day",
    plannedStartTime: a.plannedStartTime,
    plannedEndTime: a.plannedEndTime,
    estimatedMetres: a.estimatedMetres ? Number(a.estimatedMetres) : null,
    builderCompanyName: a.builderCompanyName ?? jobBuilderCompanyName,
    builderContactName: a.builderContactName ?? jobBuilderContactName,
    builderContactPhone: a.builderContactPhone ?? jobBuilderContactPhone,
    requiredColours:
      Array.isArray(a.requiredColours) && a.requiredColours.length > 0
        ? a.requiredColours
        : jobRequiredColours,
    notes: jobAddressVisible ? a.notes : null,
    hasJobReport: Boolean(report),
    jobReportPhotoCount: reportPhotos.length,
  };
}

router.get("/dispatch", async (req, res) => {
  const date = req.query.date as string | undefined;
  const tenantId = companyId(req);
  const subcontractorId = workerSubcontractorId(req) ?? (req.query.subcontractorId ? Number(req.query.subcontractorId) : undefined);

  const conditions = [eq(jobAssignmentsTable.companyId, tenantId)];
  if (date) conditions.push(eq(jobAssignmentsTable.dispatchDate, date));
  if (subcontractorId) conditions.push(eq(jobAssignmentsTable.subcontractorId, subcontractorId));

  const assignments = await db.select().from(jobAssignmentsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(jobAssignmentsTable.scheduledOrder);

  const enriched = await Promise.all(
    assignments.map((assignment) =>
      enrichAssignment(assignment, {
        workerSubcontractorId: workerSubcontractorId(req),
        dayAssignments: assignments,
      }),
    ),
  );
  return res.json(enriched);
});

router.post("/dispatch", requireAdmin, async (req, res) => {
  const parsed = CreateDispatchBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid body" });
  const tenantId = companyId(req);

  const inserted = await db.insert(jobAssignmentsTable).values(
    parsed.data.assignments.map((a) => ({
      companyId: tenantId,
      dispatchDate: dateOnlyOrToday(parsed.data.dispatchDate),
      scheduledOrder: a.scheduledOrder,
      jobId: a.jobId,
      subcontractorId: a.subcontractorId ?? null,
      workArea: a.workArea ?? null,
      timeWindow: a.timeWindow ?? "full_day",
      plannedStartTime: a.plannedStartTime ?? null,
      plannedEndTime: a.plannedEndTime ?? null,
      estimatedMetres: a.estimatedMetres != null ? String(a.estimatedMetres) : null,
      builderCompanyName: a.builderCompanyName ?? null,
      builderContactName: a.builderContactName ?? null,
      builderContactPhone: a.builderContactPhone ?? null,
      requiredColours: a.requiredColours ?? [],
      notes: a.notes ?? null,
      status: "pending",
    }))
  ).returning();

  const enriched = await Promise.all(inserted.map((assignment) => enrichAssignment(assignment)));

  await Promise.all(
    enriched.map(async (assignment) => {
      if (!assignment.subcontractorId) return;
      try {
        await createAndSendNotification({
          subcontractorId: assignment.subcontractorId,
          type: "new_job",
          title: "New job assigned",
          body: `${assignment.jobTitle ?? "Job"}${assignment.workArea ? ` - ${assignment.workArea}` : ""}${assignment.jobSuburb ? ` in ${assignment.jobSuburb}` : ""}${assignment.clientName ? ` · Through ${assignment.clientName}` : ""}`,
          priority: "high",
          actionUrl: "/field",
          linkedEntityType: "job_assignment",
          linkedEntityId: assignment.id,
        });
      } catch (err) {
        req.log.warn({ err, assignmentId: assignment.id }, "Failed to send new job notification");
      }
    }),
  );

  return res.status(201).json(enriched);
});

router.patch("/dispatch/:id", async (req, res) => {
  const params = UpdateJobAssignmentParams.safeParse({ id: Number(req.params.id) });
  const body = UpdateJobAssignmentBody.safeParse(req.body);
  if (!params.success || !body.success) return res.status(400).json({ error: "Invalid request" });

  const [existing] = await db
    .select()
    .from(jobAssignmentsTable)
    .where(and(eq(jobAssignmentsTable.id, params.data.id), eq(jobAssignmentsTable.companyId, companyId(req))));
  if (!existing) return res.status(404).json({ error: "Not found" });

  if (!isAdmin(req)) {
    const changedKeys = Object.entries(body.data)
      .filter(([, value]) => value !== undefined)
      .map(([key]) => key);

    if (!canAccessSubcontractor(req, existing.subcontractorId)) {
      return res.status(403).json({ error: "You can only update your own assigned jobs" });
    }

    if (changedKeys.length !== 1 || body.data.status !== "in_progress") {
      return res.status(403).json({ error: "Employees/subcontractors can only start their assigned job from the field view" });
    }
    if (!(await requireOpenWorkdayForWorker(req, res, existing.subcontractorId))) return;
    if (existing.status !== "arrived") {
      return res.status(400).json({ error: "Check in to this job before starting work" });
    }
  }

  const updates: Record<string, unknown> = {};
  if (body.data.scheduledOrder !== undefined) updates.scheduledOrder = body.data.scheduledOrder;
  if (body.data.subcontractorId !== undefined) updates.subcontractorId = body.data.subcontractorId;
  if (body.data.workArea !== undefined) updates.workArea = body.data.workArea || null;
  if (body.data.timeWindow !== undefined) updates.timeWindow = body.data.timeWindow || "full_day";
  if (body.data.plannedStartTime !== undefined) updates.plannedStartTime = body.data.plannedStartTime || null;
  if (body.data.plannedEndTime !== undefined) updates.plannedEndTime = body.data.plannedEndTime || null;
  if (body.data.estimatedMetres !== undefined) {
    updates.estimatedMetres = body.data.estimatedMetres != null ? String(body.data.estimatedMetres) : null;
  }
  if (body.data.requiredColours !== undefined) updates.requiredColours = body.data.requiredColours;
  if (body.data.builderCompanyName !== undefined) updates.builderCompanyName = body.data.builderCompanyName;
  if (body.data.builderContactName !== undefined) updates.builderContactName = body.data.builderContactName;
  if (body.data.builderContactPhone !== undefined) updates.builderContactPhone = body.data.builderContactPhone;
  if (body.data.notes !== undefined) updates.notes = body.data.notes;
  if (body.data.status !== undefined) updates.status = body.data.status;

  const [a] = await db
    .update(jobAssignmentsTable)
    .set(updates)
    .where(and(eq(jobAssignmentsTable.id, params.data.id), eq(jobAssignmentsTable.companyId, companyId(req))))
    .returning();
  if (!a) return res.status(404).json({ error: "Not found" });

  const enriched = await enrichAssignment(a, {
    workerSubcontractorId: workerSubcontractorId(req),
    dayAssignments: [a],
  });

  if (
    enriched.subcontractorId &&
    (
      body.data.subcontractorId !== undefined ||
      body.data.scheduledOrder !== undefined ||
      body.data.workArea !== undefined ||
      body.data.timeWindow !== undefined ||
      body.data.plannedStartTime !== undefined ||
      body.data.plannedEndTime !== undefined ||
      body.data.estimatedMetres !== undefined ||
      body.data.notes !== undefined ||
      body.data.requiredColours !== undefined
    )
  ) {
    try {
      await createAndSendNotification({
        subcontractorId: enriched.subcontractorId,
        type: "job_changed",
        title: "Job assignment updated",
        body: `${enriched.jobTitle ?? "Job"} has been updated. Check the field view before attending site.`,
        priority: "normal",
        actionUrl: "/field",
        linkedEntityType: "job_assignment",
        linkedEntityId: enriched.id,
      });
    } catch (err) {
      req.log.warn({ err, assignmentId: enriched.id }, "Failed to send job update notification");
    }
  }

  return res.json(enriched);
});

router.delete("/dispatch/:id", requireAdmin, async (req, res) => {
  const parsed = DeleteJobAssignmentParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });

  const tenantId = companyId(req);
  const [existing] = await db
    .select()
    .from(jobAssignmentsTable)
    .where(and(eq(jobAssignmentsTable.id, parsed.data.id), eq(jobAssignmentsTable.companyId, tenantId)));
  if (!existing) return res.status(404).json({ error: "Assignment not found" });

  const [report] = await db
    .select({ id: jobReportsTable.id })
    .from(jobReportsTable)
    .where(and(eq(jobReportsTable.jobAssignmentId, existing.id), eq(jobReportsTable.companyId, tenantId)))
    .limit(1);

  if (existing.status !== "pending" || existing.arrivedAt || existing.departedAt || report) {
    return res.status(409).json({
      error: "This work block has already been worked. Keep it for timesheets and invoices, or create a replacement block.",
    });
  }

  const [deleted] = await db
    .delete(jobAssignmentsTable)
    .where(and(eq(jobAssignmentsTable.id, existing.id), eq(jobAssignmentsTable.companyId, tenantId)))
    .returning({ id: jobAssignmentsTable.id });
  if (!deleted) return res.status(404).json({ error: "Assignment not found" });

  return res.status(204).send();
});

router.post("/dispatch/:id/arrive", async (req, res) => {
  const parsed = MarkArrivedParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });

  const [existing] = await db
    .select()
    .from(jobAssignmentsTable)
    .where(and(eq(jobAssignmentsTable.id, parsed.data.id), eq(jobAssignmentsTable.companyId, companyId(req))));
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (!canAccessSubcontractor(req, existing.subcontractorId)) {
    return res.status(403).json({ error: "You can only mark your own assigned jobs" });
  }
  if (!(await requireOpenWorkdayForWorker(req, res, existing.subcontractorId))) return;
  if (!(await requirePreviousJobsCompleted(req, res, existing))) return;
  if (!isAdmin(req) && existing.status !== "pending") {
    return res.status(400).json({ error: "Only pending jobs can be checked in" });
  }

  const [a] = await db.update(jobAssignmentsTable).set({
    status: "arrived",
    arrivedAt: new Date(),
  }).where(and(eq(jobAssignmentsTable.id, parsed.data.id), eq(jobAssignmentsTable.companyId, companyId(req)))).returning();
  return res.json(
    await enrichAssignment(a, {
      workerSubcontractorId: workerSubcontractorId(req),
      dayAssignments: [a],
    }),
  );
});

router.post("/dispatch/:id/depart", async (req, res) => {
  const parsed = MarkDepartedParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });

  const [existing] = await db
    .select()
    .from(jobAssignmentsTable)
    .where(and(eq(jobAssignmentsTable.id, parsed.data.id), eq(jobAssignmentsTable.companyId, companyId(req))));
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (!canAccessSubcontractor(req, existing.subcontractorId)) {
    return res.status(403).json({ error: "You can only mark your own assigned jobs" });
  }
  if (!(await requireOpenWorkdayForWorker(req, res, existing.subcontractorId))) return;
  if (!isAdmin(req) && existing.status !== "arrived" && existing.status !== "in_progress") {
    return res.status(400).json({ error: "Check in to this job before checking out" });
  }
  if (!isAdmin(req)) {
    const [report] = await db
      .select({ id: jobReportsTable.id, photos: jobReportsTable.photos })
      .from(jobReportsTable)
      .where(and(eq(jobReportsTable.jobAssignmentId, existing.id), eq(jobReportsTable.companyId, companyId(req))))
      .limit(1);
    const photos = Array.isArray(report?.photos) ? report.photos : [];
    if (!report || photos.length === 0) {
      return res.status(400).json({
        error: "Submit the job report with at least one completion photo before checking out of this job",
      });
    }
  }

  const [a] = await db.update(jobAssignmentsTable).set({
    status: "completed",
    departedAt: new Date(),
  }).where(and(eq(jobAssignmentsTable.id, parsed.data.id), eq(jobAssignmentsTable.companyId, companyId(req)))).returning();
  return res.json(
    await enrichAssignment(a, {
      workerSubcontractorId: workerSubcontractorId(req),
      dayAssignments: [a],
    }),
  );
});

export default router;

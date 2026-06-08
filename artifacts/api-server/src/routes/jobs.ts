import { Router } from "express";
import { db } from "@workspace/db";
import { jobsTable, customersTable, activityTable, jobAssignmentsTable } from "@workspace/db";
import { eq, ilike, and, or } from "drizzle-orm";
import {
  ListJobsQueryParams,
  CreateJobBody,
  GetJobParams,
  UpdateJobParams,
  UpdateJobBody,
  DeleteJobParams,
} from "@workspace/api-zod";
import { dateOnly } from "../lib/date-utils.js";
import { companyId } from "../lib/auth.js";
import { runJobAssignmentTriggers, type AssignmentTriggerResult } from "../lib/assignmentTriggers.js";
import { logger } from "../lib/logger.js";

const router = Router();

async function enrichJob(job: typeof jobsTable.$inferSelect) {
  const tenantId = job.companyId ?? 0;
  let customerName: string | null = null;
  if (job.customerId) {
    const [c] = await db
      .select({ name: customersTable.name })
      .from(customersTable)
      .where(and(eq(customersTable.id, job.customerId), eq(customersTable.companyId, tenantId)));
    customerName = c?.name ?? null;
  }
  return { ...job, customerName };
}

async function runAssignmentTriggerSafely(
  tenantId: number,
  job: typeof jobsTable.$inferSelect,
  trigger: "created" | "updated",
): Promise<AssignmentTriggerResult> {
  try {
    return await runJobAssignmentTriggers({ tenantId, job, trigger });
  } catch (err) {
    logger.warn({ err, jobId: job.id, trigger }, "Job assignment trigger failed");
    return {
      status: "skipped",
      reason: "Assignment trigger failed; job was saved but needs manual allocation review",
    };
  }
}

router.get("/jobs", async (req, res) => {
  const parsed = ListJobsQueryParams.safeParse({
    ...req.query,
    customerId: req.query.customerId ? Number(req.query.customerId) : undefined,
  });
  if (!parsed.success) return res.status(400).json({ error: "Invalid query" });

  const { status, customerId, search } = parsed.data;
  const tenantId = companyId(req);

  const conditions = [eq(jobsTable.companyId, tenantId)];
  if (status) conditions.push(eq(jobsTable.status, status));
  if (customerId) conditions.push(eq(jobsTable.customerId, customerId));

  let jobs;
  if (search) {
    const searchCondition = or(
      ilike(jobsTable.title, `%${search}%`),
      ilike(jobsTable.description, `%${search}%`),
    );
    jobs = await db
      .select()
      .from(jobsTable)
      .where(conditions.length ? and(...conditions, searchCondition) : searchCondition)
      .orderBy(jobsTable.createdAt);
  } else {
    jobs = await db
      .select()
      .from(jobsTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(jobsTable.createdAt);
  }

  const enriched = await Promise.all(jobs.map(enrichJob));
  return res.json(enriched);
});

router.post("/jobs", async (req, res) => {
  const parsed = CreateJobBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid body" });
  const tenantId = companyId(req);

  if (parsed.data.customerId) {
    const [customer] = await db
      .select({ id: customersTable.id })
      .from(customersTable)
      .where(and(eq(customersTable.id, parsed.data.customerId), eq(customersTable.companyId, tenantId)));
    if (!customer) return res.status(400).json({ error: "Client does not belong to this company account" });
  }

  const [job] = await db.insert(jobsTable).values({
    companyId: tenantId,
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    status: parsed.data.status ?? "pending",
    priority: parsed.data.priority ?? "medium",
    customerId: parsed.data.customerId ?? null,
    address: parsed.data.address ?? null,
    builderCompanyName: parsed.data.builderCompanyName ?? null,
    builderContactName: parsed.data.builderContactName ?? null,
    builderContactPhone: parsed.data.builderContactPhone ?? null,
    requiredColours: parsed.data.requiredColours ?? [],
    scheduledDate: dateOnly(parsed.data.scheduledDate),
    dueDate: dateOnly(parsed.data.dueDate),
    notes: parsed.data.notes ?? null,
  }).returning();

  await db.insert(activityTable).values({
    companyId: tenantId,
    type: "job_created",
    description: `Job "${job.title}" created`,
    entityId: job.id,
    entityType: "job",
  });

  const [enriched, assignmentTrigger] = await Promise.all([
    enrichJob(job),
    runAssignmentTriggerSafely(tenantId, job, "created"),
  ]);
  return res.status(201).json({ ...enriched, assignmentTrigger });
});

router.get("/jobs/:id", async (req, res) => {
  const parsed = GetJobParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });

  const [job] = await db
    .select()
    .from(jobsTable)
    .where(and(eq(jobsTable.id, parsed.data.id), eq(jobsTable.companyId, companyId(req))));
  if (!job) return res.status(404).json({ error: "Not found" });

  const enriched = await enrichJob(job);
  return res.json(enriched);
});

router.patch("/jobs/:id", async (req, res) => {
  const params = UpdateJobParams.safeParse({ id: Number(req.params.id) });
  const body = UpdateJobBody.safeParse(req.body);
  if (!params.success || !body.success) return res.status(400).json({ error: "Invalid request" });

  const tenantId = companyId(req);
  const prevJob = await db
    .select()
    .from(jobsTable)
    .where(and(eq(jobsTable.id, params.data.id), eq(jobsTable.companyId, tenantId)));
  if (!prevJob[0]) return res.status(404).json({ error: "Not found" });

  if (body.data.customerId) {
    const [customer] = await db
      .select({ id: customersTable.id })
      .from(customersTable)
      .where(and(eq(customersTable.id, body.data.customerId), eq(customersTable.companyId, tenantId)));
    if (!customer) return res.status(400).json({ error: "Client does not belong to this company account" });
  }

  const updates: Partial<typeof jobsTable.$inferInsert> = { updatedAt: new Date() };
  if (body.data.title !== undefined) updates.title = body.data.title;
  if (body.data.description !== undefined) updates.description = body.data.description;
  if (body.data.status !== undefined) updates.status = body.data.status;
  if (body.data.priority !== undefined) updates.priority = body.data.priority;
  if (body.data.customerId !== undefined) updates.customerId = body.data.customerId;
  if (body.data.address !== undefined) updates.address = body.data.address;
  if (body.data.builderCompanyName !== undefined) updates.builderCompanyName = body.data.builderCompanyName;
  if (body.data.builderContactName !== undefined) updates.builderContactName = body.data.builderContactName;
  if (body.data.builderContactPhone !== undefined) updates.builderContactPhone = body.data.builderContactPhone;
  if (body.data.requiredColours !== undefined) updates.requiredColours = body.data.requiredColours;
  if (body.data.scheduledDate !== undefined) updates.scheduledDate = dateOnly(body.data.scheduledDate);
  if (body.data.dueDate !== undefined) updates.dueDate = dateOnly(body.data.dueDate);
  if (body.data.completedDate !== undefined) updates.completedDate = dateOnly(body.data.completedDate);
  if (body.data.notes !== undefined) updates.notes = body.data.notes;

  const [job] = await db
    .update(jobsTable)
    .set(updates)
    .where(and(eq(jobsTable.id, params.data.id), eq(jobsTable.companyId, tenantId)))
    .returning();

  if (body.data.status && body.data.status !== prevJob[0].status) {
    await db.insert(activityTable).values({
      companyId: tenantId,
      type: "job_updated",
      description: `Job "${job.title}" status changed to ${body.data.status}`,
      entityId: job.id,
      entityType: "job",
    });

    if (body.data.status === "cancelled") {
      const deletedPendingAssignments = await db
        .delete(jobAssignmentsTable)
        .where(
          and(
            eq(jobAssignmentsTable.companyId, tenantId),
            eq(jobAssignmentsTable.jobId, job.id),
            eq(jobAssignmentsTable.status, "pending"),
          ),
        )
        .returning({ id: jobAssignmentsTable.id });

      if (deletedPendingAssignments.length > 0) {
        await db.insert(activityTable).values({
          companyId: tenantId,
          type: "job_updated",
          description: `Cancelled job "${job.title}" and removed ${deletedPendingAssignments.length} pending dispatch block(s)`,
          entityId: job.id,
          entityType: "job",
        });
      }
    }
  }

  const triggerFieldsChanged = [
    "title",
    "description",
    "status",
    "customerId",
    "address",
    "builderCompanyName",
    "builderContactName",
    "builderContactPhone",
    "requiredColours",
    "scheduledDate",
    "dueDate",
    "notes",
  ].some((field) => Object.prototype.hasOwnProperty.call(body.data, field));

  const [enriched, assignmentTrigger] = await Promise.all([
    enrichJob(job),
    triggerFieldsChanged
      ? runAssignmentTriggerSafely(tenantId, job, "updated")
      : Promise.resolve<AssignmentTriggerResult>({
          status: "skipped",
          reason: "No assignment trigger fields changed",
        }),
  ]);
  return res.json({ ...enriched, assignmentTrigger });
});

router.delete("/jobs/:id", async (req, res) => {
  const parsed = DeleteJobParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });

  await db
    .delete(jobsTable)
    .where(and(eq(jobsTable.id, parsed.data.id), eq(jobsTable.companyId, companyId(req))));
  return res.status(204).send();
});

export default router;

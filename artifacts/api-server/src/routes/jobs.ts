import { Router } from "express";
import { db } from "@workspace/db";
import { jobsTable, customersTable, activityTable } from "@workspace/db";
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

const router = Router();

async function enrichJob(job: typeof jobsTable.$inferSelect) {
  let customerName: string | null = null;
  if (job.customerId) {
    const [c] = await db.select({ name: customersTable.name }).from(customersTable).where(eq(customersTable.id, job.customerId));
    customerName = c?.name ?? null;
  }
  return { ...job, customerName };
}

router.get("/jobs", async (req, res) => {
  const parsed = ListJobsQueryParams.safeParse({
    ...req.query,
    customerId: req.query.customerId ? Number(req.query.customerId) : undefined,
  });
  if (!parsed.success) return res.status(400).json({ error: "Invalid query" });

  const { status, customerId, search } = parsed.data;

  const conditions = [];
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

  const [job] = await db.insert(jobsTable).values({
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    status: parsed.data.status ?? "pending",
    priority: parsed.data.priority ?? "medium",
    customerId: parsed.data.customerId ?? null,
    address: parsed.data.address ?? null,
    scheduledDate: dateOnly(parsed.data.scheduledDate),
    dueDate: dateOnly(parsed.data.dueDate),
    notes: parsed.data.notes ?? null,
  }).returning();

  await db.insert(activityTable).values({
    type: "job_created",
    description: `Job "${job.title}" created`,
    entityId: job.id,
    entityType: "job",
  });

  const enriched = await enrichJob(job);
  return res.status(201).json(enriched);
});

router.get("/jobs/:id", async (req, res) => {
  const parsed = GetJobParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });

  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, parsed.data.id));
  if (!job) return res.status(404).json({ error: "Not found" });

  const enriched = await enrichJob(job);
  return res.json(enriched);
});

router.patch("/jobs/:id", async (req, res) => {
  const params = UpdateJobParams.safeParse({ id: Number(req.params.id) });
  const body = UpdateJobBody.safeParse(req.body);
  if (!params.success || !body.success) return res.status(400).json({ error: "Invalid request" });

  const prevJob = await db.select().from(jobsTable).where(eq(jobsTable.id, params.data.id));
  if (!prevJob[0]) return res.status(404).json({ error: "Not found" });

  const updates: Partial<typeof jobsTable.$inferInsert> = { updatedAt: new Date() };
  if (body.data.title !== undefined) updates.title = body.data.title;
  if (body.data.description !== undefined) updates.description = body.data.description;
  if (body.data.status !== undefined) updates.status = body.data.status;
  if (body.data.priority !== undefined) updates.priority = body.data.priority;
  if (body.data.customerId !== undefined) updates.customerId = body.data.customerId;
  if (body.data.address !== undefined) updates.address = body.data.address;
  if (body.data.scheduledDate !== undefined) updates.scheduledDate = dateOnly(body.data.scheduledDate);
  if (body.data.dueDate !== undefined) updates.dueDate = dateOnly(body.data.dueDate);
  if (body.data.completedDate !== undefined) updates.completedDate = dateOnly(body.data.completedDate);
  if (body.data.notes !== undefined) updates.notes = body.data.notes;

  const [job] = await db
    .update(jobsTable)
    .set(updates)
    .where(eq(jobsTable.id, params.data.id))
    .returning();

  if (body.data.status && body.data.status !== prevJob[0].status) {
    await db.insert(activityTable).values({
      type: "job_updated",
      description: `Job "${job.title}" status changed to ${body.data.status}`,
      entityId: job.id,
      entityType: "job",
    });
  }

  const enriched = await enrichJob(job);
  return res.json(enriched);
});

router.delete("/jobs/:id", async (req, res) => {
  const parsed = DeleteJobParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });

  await db.delete(jobsTable).where(eq(jobsTable.id, parsed.data.id));
  return res.status(204).send();
});

export default router;

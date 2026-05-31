import { Router } from "express";
import { db } from "@workspace/db";
import { jobAssignmentsTable, jobsTable, subcontractorsTable } from "@workspace/db";
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

const router = Router();

async function enrichAssignment(a: typeof jobAssignmentsTable.$inferSelect) {
  let jobTitle: string | null = null;
  let jobAddress: string | null = null;
  let jobDescription: string | null = null;
  let subcontractorName: string | null = null;

  if (a.jobId) {
    const [j] = await db.select().from(jobsTable).where(eq(jobsTable.id, a.jobId));
    jobTitle = j?.title ?? null;
    jobAddress = j?.address ?? null;
    jobDescription = j?.description ?? null;
  }
  if (a.subcontractorId) {
    const [s] = await db.select().from(subcontractorsTable).where(eq(subcontractorsTable.id, a.subcontractorId));
    subcontractorName = s?.name ?? null;
  }

  return {
    ...a,
    jobTitle,
    jobAddress,
    jobDescription,
    subcontractorName,
    requiredColours: Array.isArray(a.requiredColours) ? a.requiredColours : [],
  };
}

router.get("/dispatch", async (req, res) => {
  const date = req.query.date as string | undefined;
  const subcontractorId = req.query.subcontractorId ? Number(req.query.subcontractorId) : undefined;

  const conditions = [];
  if (date) conditions.push(eq(jobAssignmentsTable.dispatchDate, date));
  if (subcontractorId) conditions.push(eq(jobAssignmentsTable.subcontractorId, subcontractorId));

  const assignments = await db.select().from(jobAssignmentsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(jobAssignmentsTable.scheduledOrder);

  const enriched = await Promise.all(assignments.map(enrichAssignment));
  return res.json(enriched);
});

router.post("/dispatch", async (req, res) => {
  const parsed = CreateDispatchBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid body" });

  const inserted = await db.insert(jobAssignmentsTable).values(
    parsed.data.assignments.map((a) => ({
      dispatchDate: dateOnlyOrToday(parsed.data.dispatchDate),
      scheduledOrder: a.scheduledOrder,
      jobId: a.jobId,
      subcontractorId: a.subcontractorId ?? null,
      builderContactName: a.builderContactName ?? null,
      builderContactPhone: a.builderContactPhone ?? null,
      requiredColours: a.requiredColours ?? [],
      notes: a.notes ?? null,
      status: "pending",
    }))
  ).returning();

  const enriched = await Promise.all(inserted.map(enrichAssignment));

  await Promise.all(
    enriched.map(async (assignment) => {
      if (!assignment.subcontractorId) return;
      try {
        await createAndSendNotification({
          subcontractorId: assignment.subcontractorId,
          type: "new_job",
          title: "New job assigned",
          body: `${assignment.jobTitle ?? "Job"}${assignment.jobAddress ? ` at ${assignment.jobAddress}` : ""}`,
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

  const updates: Record<string, unknown> = {};
  if (body.data.scheduledOrder !== undefined) updates.scheduledOrder = body.data.scheduledOrder;
  if (body.data.subcontractorId !== undefined) updates.subcontractorId = body.data.subcontractorId;
  if (body.data.requiredColours !== undefined) updates.requiredColours = body.data.requiredColours;
  if (body.data.builderContactName !== undefined) updates.builderContactName = body.data.builderContactName;
  if (body.data.builderContactPhone !== undefined) updates.builderContactPhone = body.data.builderContactPhone;
  if (body.data.notes !== undefined) updates.notes = body.data.notes;
  if (body.data.status !== undefined) updates.status = body.data.status;

  const [a] = await db.update(jobAssignmentsTable).set(updates).where(eq(jobAssignmentsTable.id, params.data.id)).returning();
  if (!a) return res.status(404).json({ error: "Not found" });

  const enriched = await enrichAssignment(a);

  if (enriched.subcontractorId && (body.data.subcontractorId !== undefined || body.data.scheduledOrder !== undefined || body.data.notes !== undefined || body.data.requiredColours !== undefined)) {
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

router.delete("/dispatch/:id", async (req, res) => {
  const parsed = DeleteJobAssignmentParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });
  await db.delete(jobAssignmentsTable).where(eq(jobAssignmentsTable.id, parsed.data.id));
  return res.status(204).send();
});

router.post("/dispatch/:id/arrive", async (req, res) => {
  const parsed = MarkArrivedParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });

  const [a] = await db.update(jobAssignmentsTable).set({
    status: "arrived",
    arrivedAt: new Date(),
  }).where(eq(jobAssignmentsTable.id, parsed.data.id)).returning();
  if (!a) return res.status(404).json({ error: "Not found" });

  return res.json(await enrichAssignment(a));
});

router.post("/dispatch/:id/depart", async (req, res) => {
  const parsed = MarkDepartedParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });

  const [a] = await db.update(jobAssignmentsTable).set({
    status: "completed",
    departedAt: new Date(),
  }).where(eq(jobAssignmentsTable.id, parsed.data.id)).returning();
  if (!a) return res.status(404).json({ error: "Not found" });

  return res.json(await enrichAssignment(a));
});

export default router;

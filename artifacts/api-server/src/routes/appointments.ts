import { Router } from "express";
import { db } from "@workspace/db";
import { appointmentsTable, customersTable, jobsTable } from "@workspace/db";
import { eq, and, gte, lte } from "drizzle-orm";
import {
  ListAppointmentsQueryParams,
  CreateAppointmentBody,
  GetAppointmentParams,
  UpdateAppointmentParams,
  UpdateAppointmentBody,
  DeleteAppointmentParams,
} from "@workspace/api-zod";

const router = Router();

async function enrichAppointment(appt: typeof appointmentsTable.$inferSelect) {
  let customerName: string | null = null;
  let jobTitle: string | null = null;

  if (appt.customerId) {
    const [c] = await db.select({ name: customersTable.name }).from(customersTable).where(eq(customersTable.id, appt.customerId));
    customerName = c?.name ?? null;
  }
  if (appt.jobId) {
    const [j] = await db.select({ title: jobsTable.title }).from(jobsTable).where(eq(jobsTable.id, appt.jobId));
    jobTitle = j?.title ?? null;
  }

  return { ...appt, customerName, jobTitle };
}

router.get("/schedule", async (req, res) => {
  const parsed = ListAppointmentsQueryParams.safeParse({
    ...req.query,
    jobId: req.query.jobId ? Number(req.query.jobId) : undefined,
  });
  if (!parsed.success) return res.status(400).json({ error: "Invalid query" });

  const { startDate, endDate, jobId } = parsed.data;
  const conditions = [];
  if (startDate) conditions.push(gte(appointmentsTable.startTime, new Date(startDate)));
  if (endDate) {
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    conditions.push(lte(appointmentsTable.startTime, end));
  }
  if (jobId) conditions.push(eq(appointmentsTable.jobId, jobId));

  const appts = await db.select().from(appointmentsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(appointmentsTable.startTime);

  const enriched = await Promise.all(appts.map(enrichAppointment));
  return res.json(enriched);
});

router.post("/schedule", async (req, res) => {
  const parsed = CreateAppointmentBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid body" });

  const [appt] = await db.insert(appointmentsTable).values({
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    jobId: parsed.data.jobId ?? null,
    customerId: parsed.data.customerId ?? null,
    startTime: new Date(parsed.data.startTime),
    endTime: new Date(parsed.data.endTime),
    address: parsed.data.address ?? null,
    status: parsed.data.status ?? "scheduled",
  }).returning();

  const enriched = await enrichAppointment(appt);
  return res.status(201).json(enriched);
});

router.get("/schedule/:id", async (req, res) => {
  const parsed = GetAppointmentParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });

  const [appt] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, parsed.data.id));
  if (!appt) return res.status(404).json({ error: "Not found" });

  return res.json(await enrichAppointment(appt));
});

router.patch("/schedule/:id", async (req, res) => {
  const params = UpdateAppointmentParams.safeParse({ id: Number(req.params.id) });
  const body = UpdateAppointmentBody.safeParse(req.body);
  if (!params.success || !body.success) return res.status(400).json({ error: "Invalid request" });

  const existing = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, params.data.id));
  if (!existing[0]) return res.status(404).json({ error: "Not found" });

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.data.title !== undefined) updates.title = body.data.title;
  if (body.data.description !== undefined) updates.description = body.data.description;
  if (body.data.jobId !== undefined) updates.jobId = body.data.jobId;
  if (body.data.customerId !== undefined) updates.customerId = body.data.customerId;
  if (body.data.startTime !== undefined) updates.startTime = new Date(body.data.startTime);
  if (body.data.endTime !== undefined) updates.endTime = new Date(body.data.endTime);
  if (body.data.address !== undefined) updates.address = body.data.address;
  if (body.data.status !== undefined) updates.status = body.data.status;

  const [appt] = await db.update(appointmentsTable).set(updates).where(eq(appointmentsTable.id, params.data.id)).returning();
  return res.json(await enrichAppointment(appt));
});

router.delete("/schedule/:id", async (req, res) => {
  const parsed = DeleteAppointmentParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });

  await db.delete(appointmentsTable).where(eq(appointmentsTable.id, parsed.data.id));
  return res.status(204).send();
});

export default router;

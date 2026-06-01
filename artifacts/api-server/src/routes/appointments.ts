import { Router } from "express";
import { db } from "@workspace/db";
import { appointmentsTable, customersTable, jobsTable } from "@workspace/db";
import { eq, and, gte, lte } from "drizzle-orm";
import { companyId } from "../lib/auth.js";
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
    const [c] = await db
      .select({ name: customersTable.name })
      .from(customersTable)
      .where(and(eq(customersTable.id, appt.customerId), eq(customersTable.companyId, appt.companyId ?? 0)));
    customerName = c?.name ?? null;
  }
  if (appt.jobId) {
    const [j] = await db
      .select({ title: jobsTable.title })
      .from(jobsTable)
      .where(and(eq(jobsTable.id, appt.jobId), eq(jobsTable.companyId, appt.companyId ?? 0)));
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
  const conditions = [eq(appointmentsTable.companyId, companyId(req))];
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
  const tenantId = companyId(req);

  if (parsed.data.jobId) {
    const [job] = await db
      .select()
      .from(jobsTable)
      .where(and(eq(jobsTable.id, parsed.data.jobId), eq(jobsTable.companyId, tenantId)));
    if (!job) return res.status(400).json({ error: "Job not found for this company" });
  }
  if (parsed.data.customerId) {
    const [customer] = await db
      .select()
      .from(customersTable)
      .where(and(eq(customersTable.id, parsed.data.customerId), eq(customersTable.companyId, tenantId)));
    if (!customer) return res.status(400).json({ error: "Client not found for this company" });
  }

  const [appt] = await db.insert(appointmentsTable).values({
    companyId: tenantId,
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

  const [appt] = await db
    .select()
    .from(appointmentsTable)
    .where(and(eq(appointmentsTable.id, parsed.data.id), eq(appointmentsTable.companyId, companyId(req))));
  if (!appt) return res.status(404).json({ error: "Not found" });

  return res.json(await enrichAppointment(appt));
});

router.patch("/schedule/:id", async (req, res) => {
  const params = UpdateAppointmentParams.safeParse({ id: Number(req.params.id) });
  const body = UpdateAppointmentBody.safeParse(req.body);
  if (!params.success || !body.success) return res.status(400).json({ error: "Invalid request" });

  const existing = await db
    .select()
    .from(appointmentsTable)
    .where(and(eq(appointmentsTable.id, params.data.id), eq(appointmentsTable.companyId, companyId(req))));
  if (!existing[0]) return res.status(404).json({ error: "Not found" });

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  const tenantId = companyId(req);
  if (body.data.title !== undefined) updates.title = body.data.title;
  if (body.data.description !== undefined) updates.description = body.data.description;
  if (body.data.jobId !== undefined) {
    if (body.data.jobId !== null) {
      const [job] = await db
        .select()
        .from(jobsTable)
        .where(and(eq(jobsTable.id, body.data.jobId), eq(jobsTable.companyId, tenantId)));
      if (!job) return res.status(400).json({ error: "Job not found for this company" });
    }
    updates.jobId = body.data.jobId;
  }
  if (body.data.customerId !== undefined) {
    if (body.data.customerId !== null) {
      const [customer] = await db
        .select()
        .from(customersTable)
        .where(and(eq(customersTable.id, body.data.customerId), eq(customersTable.companyId, tenantId)));
      if (!customer) return res.status(400).json({ error: "Client not found for this company" });
    }
    updates.customerId = body.data.customerId;
  }
  if (body.data.startTime !== undefined) updates.startTime = new Date(body.data.startTime);
  if (body.data.endTime !== undefined) updates.endTime = new Date(body.data.endTime);
  if (body.data.address !== undefined) updates.address = body.data.address;
  if (body.data.status !== undefined) updates.status = body.data.status;

  const [appt] = await db
    .update(appointmentsTable)
    .set(updates)
    .where(and(eq(appointmentsTable.id, params.data.id), eq(appointmentsTable.companyId, companyId(req))))
    .returning();
  return res.json(await enrichAppointment(appt));
});

router.delete("/schedule/:id", async (req, res) => {
  const parsed = DeleteAppointmentParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });

  await db
    .delete(appointmentsTable)
    .where(and(eq(appointmentsTable.id, parsed.data.id), eq(appointmentsTable.companyId, companyId(req))));
  return res.status(204).send();
});

export default router;

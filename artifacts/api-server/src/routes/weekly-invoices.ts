import { Router } from "express";
import { db } from "@workspace/db";
import { weeklyInvoicesTable, jobReportsTable, subcontractorsTable, jobsTable } from "@workspace/db";
import { eq, and, gte, lte } from "drizzle-orm";
import {
  ListWeeklyInvoicesQueryParams,
  GenerateWeeklyInvoicesBody,
  GetWeeklyInvoiceParams,
  UpdateWeeklyInvoiceParams,
  UpdateWeeklyInvoiceBody,
  SubmitWeeklyInvoiceParams,
} from "@workspace/api-zod";
import { dateOnlyOrToday } from "../lib/date-utils.js";

const router = Router();

function serializeInvoice(inv: typeof weeklyInvoicesTable.$inferSelect, subName: string | null = null) {
  return {
    ...inv,
    subcontractorName: subName,
    totalMetres: Number(inv.totalMetres),
    subtotal: Number(inv.subtotal),
    tax: Number(inv.tax),
    total: Number(inv.total),
    lineItems: Array.isArray(inv.lineItems) ? inv.lineItems : [],
  };
}

router.get("/weekly-invoices", async (req, res) => {
  const parsed = ListWeeklyInvoicesQueryParams.safeParse({
    ...req.query,
    subcontractorId: req.query.subcontractorId ? Number(req.query.subcontractorId) : undefined,
  });
  if (!parsed.success) return res.status(400).json({ error: "Invalid query" });

  const conditions = [];
  if (parsed.data.subcontractorId) conditions.push(eq(weeklyInvoicesTable.subcontractorId, parsed.data.subcontractorId));
  if (parsed.data.status) conditions.push(eq(weeklyInvoicesTable.status, parsed.data.status));

  const invoices = await db.select().from(weeklyInvoicesTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(weeklyInvoicesTable.weekStartDate);

  const subs = await db.select().from(subcontractorsTable);
  const subMap = new Map(subs.map((s) => [s.id, s.name]));

  return res.json(invoices.map((i) => serializeInvoice(i, subMap.get(i.subcontractorId) ?? null)));
});

router.post("/weekly-invoices/generate", async (req, res) => {
  const parsed = GenerateWeeklyInvoicesBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid body" });

  const weekStart = dateOnlyOrToday(parsed.data.weekStartDate);
  const weekStartDate = new Date(weekStart);
  const weekEndDate = new Date(weekStartDate);
  weekEndDate.setDate(weekEndDate.getDate() + 6);
  const weekEnd = weekEndDate.toISOString().split("T")[0];

  const subConditions = [];
  if (parsed.data.subcontractorId) subConditions.push(eq(subcontractorsTable.id, parsed.data.subcontractorId));
  const subs = await db.select().from(subcontractorsTable)
    .where(subConditions.length ? and(...subConditions) : eq(subcontractorsTable.active, true));

  const reports = await db.select().from(jobReportsTable)
    .where(and(gte(jobReportsTable.dispatchDate, weekStart), lte(jobReportsTable.dispatchDate, weekEnd)));

  const created: (typeof weeklyInvoicesTable.$inferSelect)[] = [];

  for (const sub of subs) {
    const subReports = reports.filter((r) => r.subcontractorId === sub.id);
    if (subReports.length === 0) continue;

    const existing = await db.select().from(weeklyInvoicesTable).where(
      and(eq(weeklyInvoicesTable.subcontractorId, sub.id), eq(weeklyInvoicesTable.weekStartDate, weekStart))
    );
    if (existing[0]) continue;

    const ratePerMetre = sub.ratePerMetre ? Number(sub.ratePerMetre) : 0;

    const lineItems = await Promise.all(subReports.map(async (r) => {
      const [job] = r.jobId ? await db.select().from(jobsTable).where(eq(jobsTable.id, r.jobId)) : [null];
      const metres = Number(r.metersCompleted);
      const amount = metres * ratePerMetre;
      return {
        jobId: r.jobId,
        jobTitle: job?.title ?? "Unknown Job",
        jobAddress: job?.address ?? null,
        dispatchDate: r.dispatchDate ?? weekStart,
        metersCompleted: metres,
        ratePerMetre,
        amount: Number(amount.toFixed(2)),
        stockCost: 0,
        reportId: r.id,
      };
    }));

    const totalMetres = lineItems.reduce((s, l) => s + l.metersCompleted, 0);
    const subtotal = lineItems.reduce((s, l) => s + l.amount, 0);
    const tax = subtotal * 0.1;
    const total = subtotal + tax;

    const [inv] = await db.insert(weeklyInvoicesTable).values({
      subcontractorId: sub.id,
      weekStartDate: weekStart,
      weekEndDate: weekEnd,
      status: "draft",
      lineItems,
      totalMetres: String(totalMetres.toFixed(2)),
      subtotal: String(subtotal.toFixed(2)),
      tax: String(tax.toFixed(2)),
      total: String(total.toFixed(2)),
    }).returning();
    created.push(inv);
  }

  const subMap = new Map(subs.map((s) => [s.id, s.name]));
  return res.status(201).json(created.map((i) => serializeInvoice(i, subMap.get(i.subcontractorId) ?? null)));
});

router.get("/weekly-invoices/:id", async (req, res) => {
  const parsed = GetWeeklyInvoiceParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });

  const [inv] = await db.select().from(weeklyInvoicesTable).where(eq(weeklyInvoicesTable.id, parsed.data.id));
  if (!inv) return res.status(404).json({ error: "Not found" });

  const [sub] = await db.select().from(subcontractorsTable).where(eq(subcontractorsTable.id, inv.subcontractorId));
  return res.json(serializeInvoice(inv, sub?.name ?? null));
});

router.patch("/weekly-invoices/:id", async (req, res) => {
  const params = UpdateWeeklyInvoiceParams.safeParse({ id: Number(req.params.id) });
  const body = UpdateWeeklyInvoiceBody.safeParse(req.body);
  if (!params.success || !body.success) return res.status(400).json({ error: "Invalid request" });

  const updates: Record<string, unknown> = {};
  if (body.data.notes !== undefined) updates.notes = body.data.notes;
  if (body.data.status !== undefined) updates.status = body.data.status;

  const [inv] = await db.update(weeklyInvoicesTable).set(updates).where(eq(weeklyInvoicesTable.id, params.data.id)).returning();
  if (!inv) return res.status(404).json({ error: "Not found" });

  const [sub] = await db.select().from(subcontractorsTable).where(eq(subcontractorsTable.id, inv.subcontractorId));
  return res.json(serializeInvoice(inv, sub?.name ?? null));
});

router.post("/weekly-invoices/:id/submit", async (req, res) => {
  const parsed = SubmitWeeklyInvoiceParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });

  const [inv] = await db.update(weeklyInvoicesTable).set({
    status: "submitted",
    submittedAt: new Date(),
    xeroInvoiceId: `XERO-PENDING-${Date.now()}`,
  }).where(eq(weeklyInvoicesTable.id, parsed.data.id)).returning();
  if (!inv) return res.status(404).json({ error: "Not found" });

  const [sub] = await db.select().from(subcontractorsTable).where(eq(subcontractorsTable.id, inv.subcontractorId));
  return res.json(serializeInvoice(inv, sub?.name ?? null));
});

export default router;

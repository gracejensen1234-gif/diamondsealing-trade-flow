import { Router } from "express";
import { db } from "@workspace/db";
import { invoicesTable, customersTable, activityTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  ListInvoicesQueryParams,
  CreateInvoiceBody,
  GetInvoiceParams,
  UpdateInvoiceParams,
  UpdateInvoiceBody,
  DeleteInvoiceParams,
  SendInvoiceParams,
  PayInvoiceParams,
} from "@workspace/api-zod";
import { dateOnly } from "../lib/date-utils.js";
import { companyId } from "../lib/auth.js";

const router = Router();

function calcTotals(lineItems: Array<{ quantity: number; unitPrice: number }>, taxRate: number) {
  const subtotal = lineItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const tax = (subtotal * taxRate) / 100;
  const total = subtotal + tax;
  return { subtotal: subtotal.toFixed(2), tax: tax.toFixed(2), total: total.toFixed(2) };
}

async function getNextInvoiceNumber(tenantId: number): Promise<string> {
  const invoices = await db
    .select({ id: invoicesTable.id })
    .from(invoicesTable)
    .where(eq(invoicesTable.companyId, tenantId))
    .orderBy(invoicesTable.id);
  return `INV-${String(invoices.length + 1).padStart(4, "0")}`;
}

async function enrichInvoice(invoice: typeof invoicesTable.$inferSelect) {
  const tenantId = invoice.companyId ?? 0;
  let customerName: string | null = null;
  if (invoice.customerId) {
    const [c] = await db
      .select({ name: customersTable.name })
      .from(customersTable)
      .where(and(eq(customersTable.id, invoice.customerId), eq(customersTable.companyId, tenantId)));
    customerName = c?.name ?? null;
  }
  const lineItems = Array.isArray(invoice.lineItems) ? invoice.lineItems as Array<{ id: number; description: string; quantity: number; unitPrice: number; total: number }> : [];
  return {
    ...invoice,
    customerName,
    subtotal: Number(invoice.subtotal),
    taxRate: Number(invoice.taxRate),
    tax: Number(invoice.tax),
    total: Number(invoice.total),
    lineItems,
  };
}

router.get("/invoices", async (req, res) => {
  const parsed = ListInvoicesQueryParams.safeParse({
    ...req.query,
    customerId: req.query.customerId ? Number(req.query.customerId) : undefined,
  });
  if (!parsed.success) return res.status(400).json({ error: "Invalid query" });

  const { status, customerId } = parsed.data;
  const conditions = [eq(invoicesTable.companyId, companyId(req))];
  if (status) conditions.push(eq(invoicesTable.status, status));
  if (customerId) conditions.push(eq(invoicesTable.customerId, customerId));

  const invoices = await db.select().from(invoicesTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(invoicesTable.createdAt);

  const enriched = await Promise.all(invoices.map(enrichInvoice));
  return res.json(enriched);
});

router.post("/invoices", async (req, res) => {
  const parsed = CreateInvoiceBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid body" });

  const tenantId = companyId(req);
  const invoiceNumber = await getNextInvoiceNumber(tenantId);
  const lineItems = (parsed.data.lineItems ?? []).map((item, i) => ({
    id: i + 1,
    description: item.description,
    quantity: Number(item.quantity),
    unitPrice: Number(item.unitPrice),
    total: Number((item.quantity * item.unitPrice).toFixed(2)),
  }));
  const taxRate = Number(parsed.data.taxRate ?? 10);
  const totals = calcTotals(lineItems, taxRate);

  const [invoice] = await db.insert(invoicesTable).values({
    companyId: tenantId,
    invoiceNumber,
    status: "draft",
    customerId: parsed.data.customerId ?? null,
    jobId: parsed.data.jobId ?? null,
    quoteId: parsed.data.quoteId ?? null,
    title: parsed.data.title ?? null,
    notes: parsed.data.notes ?? null,
    lineItems,
    taxRate: String(taxRate),
    subtotal: totals.subtotal,
    tax: totals.tax,
    total: totals.total,
    dueDate: dateOnly(parsed.data.dueDate),
  }).returning();

  const enriched = await enrichInvoice(invoice);
  return res.status(201).json(enriched);
});

router.get("/invoices/:id", async (req, res) => {
  const parsed = GetInvoiceParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });

  const [invoice] = await db
    .select()
    .from(invoicesTable)
    .where(and(eq(invoicesTable.id, parsed.data.id), eq(invoicesTable.companyId, companyId(req))));
  if (!invoice) return res.status(404).json({ error: "Not found" });

  return res.json(await enrichInvoice(invoice));
});

router.patch("/invoices/:id", async (req, res) => {
  const params = UpdateInvoiceParams.safeParse({ id: Number(req.params.id) });
  const body = UpdateInvoiceBody.safeParse(req.body);
  if (!params.success || !body.success) return res.status(400).json({ error: "Invalid request" });

  const existing = await db
    .select()
    .from(invoicesTable)
    .where(and(eq(invoicesTable.id, params.data.id), eq(invoicesTable.companyId, companyId(req))));
  if (!existing[0]) return res.status(404).json({ error: "Not found" });

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.data.customerId !== undefined) updates.customerId = body.data.customerId;
  if (body.data.jobId !== undefined) updates.jobId = body.data.jobId;
  if (body.data.title !== undefined) updates.title = body.data.title;
  if (body.data.notes !== undefined) updates.notes = body.data.notes;
  if (body.data.dueDate !== undefined) updates.dueDate = dateOnly(body.data.dueDate);

  if (body.data.lineItems !== undefined) {
    const lineItems = body.data.lineItems.map((item, i) => ({
      id: i + 1,
      description: item.description,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      total: Number((item.quantity * item.unitPrice).toFixed(2)),
    }));
    const taxRate = Number(body.data.taxRate ?? existing[0].taxRate);
    const totals = calcTotals(lineItems, taxRate);
    updates.lineItems = lineItems;
    updates.taxRate = String(taxRate);
    updates.subtotal = totals.subtotal;
    updates.tax = totals.tax;
    updates.total = totals.total;
  }

  const [invoice] = await db
    .update(invoicesTable)
    .set(updates)
    .where(and(eq(invoicesTable.id, params.data.id), eq(invoicesTable.companyId, companyId(req))))
    .returning();
  return res.json(await enrichInvoice(invoice));
});

router.delete("/invoices/:id", async (req, res) => {
  const parsed = DeleteInvoiceParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });

  await db.delete(invoicesTable).where(and(eq(invoicesTable.id, parsed.data.id), eq(invoicesTable.companyId, companyId(req))));
  return res.status(204).send();
});

router.post("/invoices/:id/send", async (req, res) => {
  const parsed = SendInvoiceParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });

  const [invoice] = await db.update(invoicesTable)
    .set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
    .where(and(eq(invoicesTable.id, parsed.data.id), eq(invoicesTable.companyId, companyId(req))))
    .returning();
  if (!invoice) return res.status(404).json({ error: "Not found" });

  await db.insert(activityTable).values({
    companyId: companyId(req),
    type: "invoice_sent",
    description: `Invoice ${invoice.invoiceNumber} sent to client`,
    entityId: invoice.id,
    entityType: "invoice",
  });

  return res.json(await enrichInvoice(invoice));
});

router.post("/invoices/:id/pay", async (req, res) => {
  const parsed = PayInvoiceParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });

  const [invoice] = await db.update(invoicesTable)
    .set({ status: "paid", paidAt: new Date(), updatedAt: new Date() })
    .where(and(eq(invoicesTable.id, parsed.data.id), eq(invoicesTable.companyId, companyId(req))))
    .returning();
  if (!invoice) return res.status(404).json({ error: "Not found" });

  await db.insert(activityTable).values({
    companyId: companyId(req),
    type: "invoice_paid",
    description: `Invoice ${invoice.invoiceNumber} marked as paid`,
    entityId: invoice.id,
    entityType: "invoice",
  });

  return res.json(await enrichInvoice(invoice));
});

export default router;

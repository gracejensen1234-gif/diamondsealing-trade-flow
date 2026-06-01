import { Router } from "express";
import { db } from "@workspace/db";
import { quotesTable, customersTable, invoicesTable, activityTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  ListQuotesQueryParams,
  CreateQuoteBody,
  GetQuoteParams,
  UpdateQuoteParams,
  UpdateQuoteBody,
  DeleteQuoteParams,
  SendQuoteParams,
  AcceptQuoteParams,
  DeclineQuoteParams,
  ConvertQuoteToInvoiceParams,
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

let quoteCounter = 100;

async function getNextQuoteNumber(tenantId: number): Promise<string> {
  const quotes = await db
    .select({ id: quotesTable.id })
    .from(quotesTable)
    .where(eq(quotesTable.companyId, tenantId))
    .orderBy(quotesTable.id);
  const num = quotes.length + 1 + quoteCounter;
  return `QU-${String(num).padStart(4, "0")}`;
}

async function enrichQuote(quote: typeof quotesTable.$inferSelect) {
  const tenantId = quote.companyId ?? 0;
  let customerName: string | null = null;
  if (quote.customerId) {
    const [c] = await db
      .select({ name: customersTable.name })
      .from(customersTable)
      .where(and(eq(customersTable.id, quote.customerId), eq(customersTable.companyId, tenantId)));
    customerName = c?.name ?? null;
  }
  const lineItems = Array.isArray(quote.lineItems) ? quote.lineItems as Array<{ id: number; description: string; quantity: number; unitPrice: number; total: number }> : [];
  return {
    ...quote,
    customerName,
    subtotal: Number(quote.subtotal),
    taxRate: Number(quote.taxRate),
    tax: Number(quote.tax),
    total: Number(quote.total),
    lineItems,
  };
}

router.get("/quotes", async (req, res) => {
  const parsed = ListQuotesQueryParams.safeParse({
    ...req.query,
    customerId: req.query.customerId ? Number(req.query.customerId) : undefined,
  });
  if (!parsed.success) return res.status(400).json({ error: "Invalid query" });

  const { status, customerId } = parsed.data;
  const conditions = [eq(quotesTable.companyId, companyId(req))];
  if (status) conditions.push(eq(quotesTable.status, status));
  if (customerId) conditions.push(eq(quotesTable.customerId, customerId));

  const quotes = await db.select().from(quotesTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(quotesTable.createdAt);

  const enriched = await Promise.all(quotes.map(enrichQuote));
  return res.json(enriched);
});

router.post("/quotes", async (req, res) => {
  const parsed = CreateQuoteBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid body" });

  const tenantId = companyId(req);
  const quoteNumber = await getNextQuoteNumber(tenantId);
  const lineItems = (parsed.data.lineItems ?? []).map((item, i) => ({
    id: i + 1,
    description: item.description,
    quantity: Number(item.quantity),
    unitPrice: Number(item.unitPrice),
    total: Number((item.quantity * item.unitPrice).toFixed(2)),
  }));
  const taxRate = Number(parsed.data.taxRate ?? 10);
  const totals = calcTotals(lineItems, taxRate);

  const [quote] = await db.insert(quotesTable).values({
    companyId: tenantId,
    quoteNumber,
    status: "draft",
    customerId: parsed.data.customerId ?? null,
    jobId: parsed.data.jobId ?? null,
    title: parsed.data.title ?? null,
    notes: parsed.data.notes ?? null,
    lineItems,
    taxRate: String(taxRate),
    subtotal: totals.subtotal,
    tax: totals.tax,
    total: totals.total,
    validUntil: dateOnly(parsed.data.validUntil),
  }).returning();

  const enriched = await enrichQuote(quote);
  return res.status(201).json(enriched);
});

router.get("/quotes/:id", async (req, res) => {
  const parsed = GetQuoteParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });

  const [quote] = await db
    .select()
    .from(quotesTable)
    .where(and(eq(quotesTable.id, parsed.data.id), eq(quotesTable.companyId, companyId(req))));
  if (!quote) return res.status(404).json({ error: "Not found" });

  return res.json(await enrichQuote(quote));
});

router.patch("/quotes/:id", async (req, res) => {
  const params = UpdateQuoteParams.safeParse({ id: Number(req.params.id) });
  const body = UpdateQuoteBody.safeParse(req.body);
  if (!params.success || !body.success) return res.status(400).json({ error: "Invalid request" });

  const existing = await db
    .select()
    .from(quotesTable)
    .where(and(eq(quotesTable.id, params.data.id), eq(quotesTable.companyId, companyId(req))));
  if (!existing[0]) return res.status(404).json({ error: "Not found" });

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.data.customerId !== undefined) updates.customerId = body.data.customerId;
  if (body.data.jobId !== undefined) updates.jobId = body.data.jobId;
  if (body.data.title !== undefined) updates.title = body.data.title;
  if (body.data.notes !== undefined) updates.notes = body.data.notes;
  if (body.data.validUntil !== undefined) updates.validUntil = dateOnly(body.data.validUntil);

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

  const [quote] = await db
    .update(quotesTable)
    .set(updates)
    .where(and(eq(quotesTable.id, params.data.id), eq(quotesTable.companyId, companyId(req))))
    .returning();
  return res.json(await enrichQuote(quote));
});

router.delete("/quotes/:id", async (req, res) => {
  const parsed = DeleteQuoteParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });

  await db.delete(quotesTable).where(and(eq(quotesTable.id, parsed.data.id), eq(quotesTable.companyId, companyId(req))));
  return res.status(204).send();
});

router.post("/quotes/:id/send", async (req, res) => {
  const parsed = SendQuoteParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });

  const [quote] = await db.update(quotesTable)
    .set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
    .where(and(eq(quotesTable.id, parsed.data.id), eq(quotesTable.companyId, companyId(req))))
    .returning();
  if (!quote) return res.status(404).json({ error: "Not found" });

  await db.insert(activityTable).values({
    companyId: companyId(req),
    type: "quote_sent",
    description: `Quote ${quote.quoteNumber} sent to client`,
    entityId: quote.id,
    entityType: "quote",
  });

  return res.json(await enrichQuote(quote));
});

router.post("/quotes/:id/accept", async (req, res) => {
  const parsed = AcceptQuoteParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });

  const [quote] = await db.update(quotesTable)
    .set({ status: "accepted", acceptedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(quotesTable.id, parsed.data.id), eq(quotesTable.companyId, companyId(req))))
    .returning();
  if (!quote) return res.status(404).json({ error: "Not found" });

  await db.insert(activityTable).values({
    companyId: companyId(req),
    type: "quote_accepted",
    description: `Quote ${quote.quoteNumber} accepted`,
    entityId: quote.id,
    entityType: "quote",
  });

  return res.json(await enrichQuote(quote));
});

router.post("/quotes/:id/decline", async (req, res) => {
  const parsed = DeclineQuoteParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });

  const [quote] = await db.update(quotesTable)
    .set({ status: "declined", updatedAt: new Date() })
    .where(and(eq(quotesTable.id, parsed.data.id), eq(quotesTable.companyId, companyId(req))))
    .returning();
  if (!quote) return res.status(404).json({ error: "Not found" });

  return res.json(await enrichQuote(quote));
});

router.post("/quotes/:id/convert", async (req, res) => {
  const parsed = ConvertQuoteToInvoiceParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });

  const tenantId = companyId(req);
  const [quote] = await db
    .select()
    .from(quotesTable)
    .where(and(eq(quotesTable.id, parsed.data.id), eq(quotesTable.companyId, tenantId)));
  if (!quote) return res.status(404).json({ error: "Not found" });

  const allInvoices = await db.select({ id: invoicesTable.id }).from(invoicesTable).where(eq(invoicesTable.companyId, tenantId));
  const invoiceNum = `INV-${String(allInvoices.length + 1).padStart(4, "0")}`;

  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 14);

  const [invoice] = await db.insert(invoicesTable).values({
    companyId: tenantId,
    invoiceNumber: invoiceNum,
    status: "draft",
    customerId: quote.customerId,
    jobId: quote.jobId,
    quoteId: quote.id,
    title: quote.title,
    notes: quote.notes,
    lineItems: quote.lineItems,
    taxRate: quote.taxRate,
    subtotal: quote.subtotal,
    tax: quote.tax,
    total: quote.total,
    dueDate: dueDate.toISOString().split("T")[0],
  }).returning();

  let customerName: string | null = null;
  if (invoice.customerId) {
    const [c] = await db
      .select({ name: customersTable.name })
      .from(customersTable)
      .where(and(eq(customersTable.id, invoice.customerId), eq(customersTable.companyId, tenantId)));
    customerName = c?.name ?? null;
  }

  return res.status(201).json({
    ...invoice,
    customerName,
    subtotal: Number(invoice.subtotal),
    taxRate: Number(invoice.taxRate),
    tax: Number(invoice.tax),
    total: Number(invoice.total),
    lineItems: Array.isArray(invoice.lineItems) ? invoice.lineItems : [],
  });
});

export default router;

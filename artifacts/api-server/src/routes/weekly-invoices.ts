import { Router } from "express";
import { db } from "@workspace/db";
import {
  weeklyInvoicesTable,
  jobReportsTable,
  subcontractorsTable,
  jobsTable,
  workSessionsTable,
  xeroSettingsTable,
} from "@workspace/db";
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
import { companyId, requireSubcontractorAccess, workerSubcontractorId } from "../lib/auth.js";

const router = Router();
const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";
const XERO_INVOICES_URL = "https://api.xero.com/api.xro/2.0/Invoices";

type WeeklyInvoiceLineItem = {
  jobId?: number | null;
  jobTitle?: string | null;
  jobAddress?: string | null;
  dispatchDate?: string | null;
  metersCompleted?: number | string | null;
  ratePerMetre?: number | string | null;
  amount?: number | string | null;
  reportId?: number | null;
};

type XeroTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
};

type XeroInvoiceResponse = {
  Invoices?: Array<{
    InvoiceID?: string;
    InvoiceNumber?: string;
  }>;
};

type WeeklyInvoiceBuild = {
  lineItems: Array<WeeklyInvoiceLineItem & { stockCost?: number }>;
  totalMetres: number;
  subtotal: number;
  tax: number;
  total: number;
};

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

function getInvoiceNumber(inv: typeof weeklyInvoicesTable.$inferSelect) {
  return `WI-${String(inv.id).padStart(5, "0")}`;
}

function addDays(date: string, days: number) {
  const result = new Date(`${date}T00:00:00`);
  result.setDate(result.getDate() + days);
  return result.toISOString().split("T")[0];
}

function mondayForDate(value?: string) {
  const date = new Date(`${dateOnlyOrToday(value)}T00:00:00`);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return date.toISOString().split("T")[0];
}

function workSessionMinutes(session: typeof workSessionsTable.$inferSelect) {
  if (!session.clockedOnAt) return 0;
  const end = session.clockedOffAt ?? new Date();
  let breakMinutes = session.totalBreakMinutes ?? 0;
  if (session.status === "on_break" && session.breakStartAt) {
    breakMinutes += Math.max(0, Math.round((Date.now() - new Date(session.breakStartAt).getTime()) / 60000));
  }
  const minutes = Math.round((new Date(end).getTime() - new Date(session.clockedOnAt).getTime()) / 60000) - breakMinutes;
  return Math.max(0, minutes);
}

function money(value: number) {
  return Number(value.toFixed(2));
}

function formatXeroCsvDate(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  return parsed.toLocaleDateString("en-AU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function csvEscape(value: unknown) {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function lineItems(inv: typeof weeklyInvoicesTable.$inferSelect) {
  return Array.isArray(inv.lineItems) ? (inv.lineItems as WeeklyInvoiceLineItem[]) : [];
}

function submittedReportIds(invoices: Array<typeof weeklyInvoicesTable.$inferSelect>) {
  const reportIds = new Set<number>();
  for (const invoice of invoices) {
    if (invoice.status !== "submitted" && invoice.status !== "paid") continue;
    for (const item of lineItems(invoice)) {
      if (item.reportId) reportIds.add(item.reportId);
    }
  }
  return reportIds;
}

async function buildWeeklyInvoiceValues(
  tenantId: number,
  sub: typeof subcontractorsTable.$inferSelect,
  reports: Array<typeof jobReportsTable.$inferSelect>,
): Promise<WeeklyInvoiceBuild> {
  const ratePerMetre = sub.ratePerMetre ? Number(sub.ratePerMetre) : 0;
  const items = await Promise.all(reports.map(async (r) => {
    const [job] = r.jobId
      ? await db.select().from(jobsTable).where(and(eq(jobsTable.id, r.jobId), eq(jobsTable.companyId, tenantId)))
      : [null];
    const metres = Number(r.metersCompleted);
    const amount = metres * ratePerMetre;
    return {
      jobId: r.jobId,
      jobTitle: job?.title ?? "Unknown Job",
      jobAddress: job?.address ?? null,
      dispatchDate: r.dispatchDate ?? null,
      metersCompleted: metres,
      ratePerMetre,
      amount: money(amount),
      stockCost: 0,
      reportId: r.id,
    };
  }));
  const totalMetres = items.reduce((sum, item) => sum + Number(item.metersCompleted ?? 0), 0);
  const subtotal = items.reduce((sum, item) => sum + Number(item.amount ?? 0), 0);
  const tax = subtotal * 0.1;
  return {
    lineItems: items,
    totalMetres: money(totalMetres),
    subtotal: money(subtotal),
    tax: money(tax),
    total: money(subtotal + tax),
  };
}

async function getWeekContext(tenantId: number, subcontractorId: number, weekStartInput?: string) {
  const weekStart = mondayForDate(weekStartInput);
  const weekEnd = addDays(weekStart, 6);
  const [sub] = await db
    .select()
    .from(subcontractorsTable)
    .where(and(eq(subcontractorsTable.id, subcontractorId), eq(subcontractorsTable.companyId, tenantId)));
  if (!sub) return null;

  const [reports, sessions, invoices] = await Promise.all([
    db
      .select()
      .from(jobReportsTable)
      .where(and(
        eq(jobReportsTable.companyId, tenantId),
        eq(jobReportsTable.subcontractorId, subcontractorId),
        gte(jobReportsTable.dispatchDate, weekStart),
        lte(jobReportsTable.dispatchDate, weekEnd),
      )),
    db
      .select()
      .from(workSessionsTable)
      .where(and(
        eq(workSessionsTable.companyId, tenantId),
        eq(workSessionsTable.subcontractorId, subcontractorId),
        gte(workSessionsTable.date, weekStart),
        lte(workSessionsTable.date, weekEnd),
      )),
    db
      .select()
      .from(weeklyInvoicesTable)
      .where(and(
        eq(weeklyInvoicesTable.companyId, tenantId),
        eq(weeklyInvoicesTable.subcontractorId, subcontractorId),
        eq(weeklyInvoicesTable.weekStartDate, weekStart),
      )),
  ]);

  return { sub, weekStart, weekEnd, reports, sessions, invoices };
}

async function buildEarningsSummary(tenantId: number, subcontractorId: number, weekStartInput?: string) {
  const context = await getWeekContext(tenantId, subcontractorId, weekStartInput);
  if (!context) return null;
  const { sub, weekStart, weekEnd, reports, sessions, invoices } = context;
  const submittedIds = submittedReportIds(invoices);
  const uninvoicedReports = reports.filter((report) => !submittedIds.has(report.id));
  const earnedValues = await buildWeeklyInvoiceValues(tenantId, sub, reports);
  const toInvoiceValues = await buildWeeklyInvoiceValues(tenantId, sub, uninvoicedReports);
  const totalWorkMinutes = sessions.reduce((sum, session) => sum + workSessionMinutes(session), 0);
  const draftInvoice = invoices.find((invoice) => invoice.status === "draft") ?? null;
  const latestSubmittedInvoice =
    [...invoices].reverse().find((invoice) => invoice.status === "submitted" || invoice.status === "paid") ?? null;

  return {
    subcontractorId,
    subcontractorName: sub.name,
    weekStartDate: weekStart,
    weekEndDate: weekEnd,
    totalWorkMinutes,
    totalHours: Number((totalWorkMinutes / 60).toFixed(2)),
    ratePerMetre: sub.ratePerMetre ? Number(sub.ratePerMetre) : 0,
    completedMetres: earnedValues.totalMetres,
    earnedSubtotal: earnedValues.subtotal,
    earnedTax: earnedValues.tax,
    earnedGross: earnedValues.total,
    toInvoiceSubtotal: toInvoiceValues.subtotal,
    toInvoiceTax: toInvoiceValues.tax,
    toInvoiceGross: toInvoiceValues.total,
    uninvoicedMetres: toInvoiceValues.totalMetres,
    lineItemCount: earnedValues.lineItems.length,
    uninvoicedLineItemCount: toInvoiceValues.lineItems.length,
    draftInvoiceId: draftInvoice?.id ?? null,
    submittedInvoiceId: latestSubmittedInvoice?.id ?? null,
    xeroInvoiceId: latestSubmittedInvoice?.xeroInvoiceId ?? null,
    submittedAt: latestSubmittedInvoice?.submittedAt ?? null,
  };
}

async function upsertCurrentWeeklyInvoice(tenantId: number, subcontractorId: number, weekStartInput?: string) {
  const context = await getWeekContext(tenantId, subcontractorId, weekStartInput);
  if (!context) return null;
  const { sub, weekStart, weekEnd, reports, invoices } = context;
  const submittedIds = submittedReportIds(invoices);
  const uninvoicedReports = reports.filter((report) => !submittedIds.has(report.id));
  const values = await buildWeeklyInvoiceValues(tenantId, sub, uninvoicedReports);
  if (values.lineItems.length === 0) {
    return { sub, invoice: null, values };
  }

  const draft = invoices.find((invoice) => invoice.status === "draft") ?? null;
  if (draft) {
    const [updated] = await db
      .update(weeklyInvoicesTable)
      .set({
        lineItems: values.lineItems,
        totalMetres: String(values.totalMetres.toFixed(2)),
        subtotal: String(values.subtotal.toFixed(2)),
        tax: String(values.tax.toFixed(2)),
        total: String(values.total.toFixed(2)),
      })
      .where(and(eq(weeklyInvoicesTable.id, draft.id), eq(weeklyInvoicesTable.companyId, tenantId)))
      .returning();
    return { sub, invoice: updated, values };
  }

  const [created] = await db
    .insert(weeklyInvoicesTable)
    .values({
      subcontractorId,
      companyId: tenantId,
      weekStartDate: weekStart,
      weekEndDate: weekEnd,
      status: "draft",
      lineItems: values.lineItems,
      totalMetres: String(values.totalMetres.toFixed(2)),
      subtotal: String(values.subtotal.toFixed(2)),
      tax: String(values.tax.toFixed(2)),
      total: String(values.total.toFixed(2)),
    })
    .returning();
  return { sub, invoice: created, values };
}

function getXeroClientId(settings: typeof xeroSettingsTable.$inferSelect) {
  return process.env.XERO_CLIENT_ID?.trim() || settings.clientId?.trim() || "";
}

function getXeroClientSecret() {
  return process.env.XERO_CLIENT_SECRET?.trim() || "";
}

function getXeroTaxType() {
  return process.env.XERO_TAX_TYPE?.trim() || "INPUT";
}

async function getStoredXeroSettings(tenantId: number) {
  const [settings] = await db
    .select()
    .from(xeroSettingsTable)
    .where(eq(xeroSettingsTable.companyId, tenantId));
  return settings ?? null;
}

async function refreshXeroAccessToken(settings: typeof xeroSettingsTable.$inferSelect) {
  const tenantId = settings.companyId ?? 0;
  const clientId = getXeroClientId(settings);
  const clientSecret = getXeroClientSecret();
  if (!clientId || !clientSecret || !settings.refreshToken) {
    throw new Error("Xero is not connected. Use the CSV export, or configure Xero OAuth credentials and connect again.");
  }

  const response = await fetch(XERO_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: settings.refreshToken,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Xero token refresh failed: ${text}`);
  }

  const token = (await response.json()) as XeroTokenResponse;
  const [updated] = await db
    .update(xeroSettingsTable)
    .set({
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? settings.refreshToken,
      tokenExpiresAt: new Date(Date.now() + (token.expires_in ?? 1800) * 1000),
      tokenScope: token.scope ?? settings.tokenScope ?? null,
    })
    .where(and(eq(xeroSettingsTable.id, settings.id), eq(xeroSettingsTable.companyId, tenantId)))
    .returning();

  return updated;
}

async function getUsableXeroSettings(tenantId: number) {
  let settings = await getStoredXeroSettings(tenantId);
  if (!settings?.connected || !settings.tenantId) {
    throw new Error("Xero is not connected. Download the Xero CSV instead, or connect Xero from Settings.");
  }

  const expiresAt = settings.tokenExpiresAt?.getTime() ?? 0;
  if (!settings.accessToken || expiresAt < Date.now() + 120_000) {
    settings = await refreshXeroAccessToken(settings);
  }

  if (!settings.accessToken || !settings.tenantId) {
    throw new Error("Xero connection is missing an access token or tenant.");
  }

  return settings;
}

async function buildXeroCsv(inv: typeof weeklyInvoicesTable.$inferSelect, subName: string | null) {
  const settings = await getStoredXeroSettings(inv.companyId ?? 0);
  const accountCode = settings?.defaultAccountCode || process.env.XERO_DEFAULT_ACCOUNT_CODE || "310";
  const taxType = getXeroTaxType();
  const invoiceNumber = getInvoiceNumber(inv);
  const invoiceDate = formatXeroCsvDate(inv.weekEndDate);
  const dueDate = formatXeroCsvDate(addDays(inv.weekEndDate, 7));
  const rows = [
    [
      "Contact Name",
      "Invoice Number",
      "Invoice Date",
      "Due Date",
      "Description",
      "Quantity",
      "Unit Amount",
      "Account Code",
      "Tax Type",
    ],
  ];

  for (const item of lineItems(inv)) {
    rows.push([
      subName || `Subcontractor ${inv.subcontractorId}`,
      invoiceNumber,
      invoiceDate,
      dueDate,
      `${item.dispatchDate ?? inv.weekStartDate} - ${item.jobTitle ?? "Joint sealing labour"}${item.jobAddress ? ` (${item.jobAddress})` : ""}`,
      String(Number(item.metersCompleted ?? 0).toFixed(2)),
      String(Number(item.ratePerMetre ?? 0).toFixed(2)),
      accountCode,
      taxType,
    ]);
  }

  return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
}

async function createXeroDraftBill(inv: typeof weeklyInvoicesTable.$inferSelect, subName: string | null) {
  const settings = await getUsableXeroSettings(inv.companyId ?? 0);
  const accessToken = settings.accessToken;
  const tenantId = settings.tenantId;
  const accountCode = settings.defaultAccountCode || process.env.XERO_DEFAULT_ACCOUNT_CODE || "310";
  const invoiceLines = lineItems(inv);

  if (!accessToken || !tenantId) {
    throw new Error("Xero connection is missing an access token or tenant.");
  }

  if (invoiceLines.length === 0) {
    throw new Error("This invoice has no line items to send to Xero.");
  }

  const response = await fetch(XERO_INVOICES_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "xero-tenant-id": tenantId,
    },
    body: JSON.stringify({
      Invoices: [
        {
          Type: "ACCPAY",
          Contact: {
            Name: subName || `Subcontractor ${inv.subcontractorId}`,
          },
          Date: inv.weekEndDate,
          DueDate: addDays(inv.weekEndDate, 7),
          InvoiceNumber: getInvoiceNumber(inv),
          Reference: `Weekly invoice ${inv.weekStartDate} to ${inv.weekEndDate}`,
          Status: "DRAFT",
          LineAmountTypes: "Exclusive",
          LineItems: invoiceLines.map((item) => ({
            Description: `${item.dispatchDate ?? inv.weekStartDate} - ${item.jobTitle ?? "Joint sealing labour"}${item.jobAddress ? ` (${item.jobAddress})` : ""}`,
            Quantity: Number(item.metersCompleted ?? 0),
            UnitAmount: Number(item.ratePerMetre ?? 0),
            AccountCode: accountCode,
            TaxType: getXeroTaxType(),
          })),
        },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Xero rejected the invoice: ${text}`);
  }

  const data = (await response.json()) as XeroInvoiceResponse;
  const xeroInvoice = data.Invoices?.[0];
  return xeroInvoice?.InvoiceID || xeroInvoice?.InvoiceNumber || getInvoiceNumber(inv);
}

router.get("/weekly-invoices", async (req, res) => {
  const parsed = ListWeeklyInvoicesQueryParams.safeParse({
    ...req.query,
    subcontractorId: req.query.subcontractorId ? Number(req.query.subcontractorId) : undefined,
  });
  if (!parsed.success) return res.status(400).json({ error: "Invalid query" });

  const conditions = [eq(weeklyInvoicesTable.companyId, companyId(req))];
  const ownSubcontractorId = workerSubcontractorId(req);
  if (ownSubcontractorId) {
    conditions.push(eq(weeklyInvoicesTable.subcontractorId, ownSubcontractorId));
  } else if (parsed.data.subcontractorId) {
    conditions.push(eq(weeklyInvoicesTable.subcontractorId, parsed.data.subcontractorId));
  }
  if (parsed.data.status) conditions.push(eq(weeklyInvoicesTable.status, parsed.data.status));

  const invoices = await db.select().from(weeklyInvoicesTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(weeklyInvoicesTable.weekStartDate);

  const subs = await db.select().from(subcontractorsTable).where(eq(subcontractorsTable.companyId, companyId(req)));
  const subMap = new Map(subs.map((s) => [s.id, s.name]));

  return res.json(invoices.map((i) => serializeInvoice(i, subMap.get(i.subcontractorId) ?? null)));
});

router.get("/weekly-invoices/earnings-summary", async (req, res) => {
  const subcontractorId = workerSubcontractorId(req) ?? (req.query.subcontractorId ? Number(req.query.subcontractorId) : undefined);
  if (!subcontractorId) return res.status(400).json({ error: "subcontractorId required" });
  if (!requireSubcontractorAccess(req, res, subcontractorId)) return;

  const summary = await buildEarningsSummary(companyId(req), subcontractorId, req.query.weekStartDate as string | undefined);
  if (!summary) return res.status(404).json({ error: "Employee/subcontractor not found" });
  return res.json(summary);
});

router.post("/weekly-invoices/submit-current", async (req, res) => {
  const subcontractorId = workerSubcontractorId(req) ?? (req.body.subcontractorId ? Number(req.body.subcontractorId) : undefined);
  if (!subcontractorId) return res.status(400).json({ error: "subcontractorId required" });
  if (!requireSubcontractorAccess(req, res, subcontractorId)) return;

  const tenantId = companyId(req);
  const prepared = await upsertCurrentWeeklyInvoice(tenantId, subcontractorId, req.body.weekStartDate);
  if (!prepared) return res.status(404).json({ error: "Employee/subcontractor not found" });
  if (!prepared.invoice) {
    return res.status(400).json({ error: "No uninvoiced completed work for this week" });
  }
  if (!prepared.sub.ratePerMetre || Number(prepared.sub.ratePerMetre) <= 0) {
    return res.status(400).json({ error: "Rate per metre must be set before sending an invoice to Xero" });
  }

  let xeroInvoiceId: string;
  try {
    xeroInvoiceId = await createXeroDraftBill(prepared.invoice, prepared.sub.name);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not submit invoice to Xero";
    return res.status(400).json({
      error: "Xero submission failed",
      message,
      invoice: serializeInvoice(prepared.invoice, prepared.sub.name),
      csvDownloadUrl: `/api/weekly-invoices/${prepared.invoice.id}/xero-csv`,
    });
  }

  const [submitted] = await db.update(weeklyInvoicesTable).set({
    status: "submitted",
    submittedAt: new Date(),
    xeroInvoiceId,
  }).where(and(eq(weeklyInvoicesTable.id, prepared.invoice.id), eq(weeklyInvoicesTable.companyId, tenantId))).returning();

  return res.json({
    invoice: serializeInvoice(submitted, prepared.sub.name),
    summary: await buildEarningsSummary(tenantId, subcontractorId, req.body.weekStartDate),
  });
});

router.post("/weekly-invoices/generate", async (req, res) => {
  const parsed = GenerateWeeklyInvoicesBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid body" });

  const weekStart = dateOnlyOrToday(parsed.data.weekStartDate);
  const tenantId = companyId(req);
  const weekStartDate = new Date(weekStart);
  const weekEndDate = new Date(weekStartDate);
  weekEndDate.setDate(weekEndDate.getDate() + 6);
  const weekEnd = weekEndDate.toISOString().split("T")[0];

  const subConditions = [];
  subConditions.push(eq(subcontractorsTable.companyId, tenantId));
  if (parsed.data.subcontractorId) subConditions.push(eq(subcontractorsTable.id, parsed.data.subcontractorId));
  const subs = await db.select().from(subcontractorsTable)
    .where(and(...subConditions, eq(subcontractorsTable.active, true)));

  const reports = await db.select().from(jobReportsTable)
    .where(and(eq(jobReportsTable.companyId, tenantId), gte(jobReportsTable.dispatchDate, weekStart), lte(jobReportsTable.dispatchDate, weekEnd)));

  const created: (typeof weeklyInvoicesTable.$inferSelect)[] = [];

  for (const sub of subs) {
    const subReports = reports.filter((r) => r.subcontractorId === sub.id);
    if (subReports.length === 0) continue;

    const existing = await db.select().from(weeklyInvoicesTable).where(
      and(eq(weeklyInvoicesTable.companyId, tenantId), eq(weeklyInvoicesTable.subcontractorId, sub.id), eq(weeklyInvoicesTable.weekStartDate, weekStart))
    );
    if (existing[0]) continue;

    const ratePerMetre = sub.ratePerMetre ? Number(sub.ratePerMetre) : 0;

    const lineItems = await Promise.all(subReports.map(async (r) => {
      const [job] = r.jobId
        ? await db.select().from(jobsTable).where(and(eq(jobsTable.id, r.jobId), eq(jobsTable.companyId, tenantId)))
        : [null];
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
      companyId: tenantId,
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

  const [inv] = await db
    .select()
    .from(weeklyInvoicesTable)
    .where(and(eq(weeklyInvoicesTable.id, parsed.data.id), eq(weeklyInvoicesTable.companyId, companyId(req))));
  if (!inv) return res.status(404).json({ error: "Not found" });
  if (!requireSubcontractorAccess(req, res, inv.subcontractorId)) return;

  const [sub] = await db.select().from(subcontractorsTable).where(and(eq(subcontractorsTable.id, inv.subcontractorId), eq(subcontractorsTable.companyId, companyId(req))));
  return res.json(serializeInvoice(inv, sub?.name ?? null));
});

router.get("/weekly-invoices/:id/xero-csv", async (req, res) => {
  const parsed = GetWeeklyInvoiceParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });

  const [inv] = await db
    .select()
    .from(weeklyInvoicesTable)
    .where(and(eq(weeklyInvoicesTable.id, parsed.data.id), eq(weeklyInvoicesTable.companyId, companyId(req))));
  if (!inv) return res.status(404).json({ error: "Not found" });
  if (!requireSubcontractorAccess(req, res, inv.subcontractorId)) return;

  const [sub] = await db.select().from(subcontractorsTable).where(and(eq(subcontractorsTable.id, inv.subcontractorId), eq(subcontractorsTable.companyId, companyId(req))));
  const csv = await buildXeroCsv(inv, sub?.name ?? null);

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${getInvoiceNumber(inv)}-xero-bill.csv"`);
  return res.send(csv);
});

router.patch("/weekly-invoices/:id", async (req, res) => {
  const params = UpdateWeeklyInvoiceParams.safeParse({ id: Number(req.params.id) });
  const body = UpdateWeeklyInvoiceBody.safeParse(req.body);
  if (!params.success || !body.success) return res.status(400).json({ error: "Invalid request" });

  const updates: Record<string, unknown> = {};
  if (body.data.notes !== undefined) updates.notes = body.data.notes;
  if (body.data.status !== undefined) updates.status = body.data.status;

  const [inv] = await db
    .update(weeklyInvoicesTable)
    .set(updates)
    .where(and(eq(weeklyInvoicesTable.id, params.data.id), eq(weeklyInvoicesTable.companyId, companyId(req))))
    .returning();
  if (!inv) return res.status(404).json({ error: "Not found" });

  const [sub] = await db.select().from(subcontractorsTable).where(and(eq(subcontractorsTable.id, inv.subcontractorId), eq(subcontractorsTable.companyId, companyId(req))));
  return res.json(serializeInvoice(inv, sub?.name ?? null));
});

router.post("/weekly-invoices/:id/submit", async (req, res) => {
  const parsed = SubmitWeeklyInvoiceParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });

  const [existing] = await db
    .select()
    .from(weeklyInvoicesTable)
    .where(and(eq(weeklyInvoicesTable.id, parsed.data.id), eq(weeklyInvoicesTable.companyId, companyId(req))));
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (!requireSubcontractorAccess(req, res, existing.subcontractorId)) return;

  const [sub] = await db.select().from(subcontractorsTable).where(and(eq(subcontractorsTable.id, existing.subcontractorId), eq(subcontractorsTable.companyId, companyId(req))));

  let xeroInvoiceId: string;
  try {
    xeroInvoiceId = await createXeroDraftBill(existing, sub?.name ?? null);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not submit invoice to Xero";
    return res.status(400).json({
      error: "Xero submission failed",
      message,
      csvDownloadUrl: `/api/weekly-invoices/${existing.id}/xero-csv`,
    });
  }

  const [inv] = await db.update(weeklyInvoicesTable).set({
    status: "submitted",
    submittedAt: new Date(),
    xeroInvoiceId,
  }).where(and(eq(weeklyInvoicesTable.id, parsed.data.id), eq(weeklyInvoicesTable.companyId, companyId(req)))).returning();

  return res.json(serializeInvoice(inv, sub?.name ?? null));
});

export default router;

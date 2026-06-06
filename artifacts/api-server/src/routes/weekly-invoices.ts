import { Router } from "express";
import { db } from "@workspace/db";
import {
  weeklyInvoicesTable,
  jobAssignmentsTable,
  jobReportsTable,
  subcontractorsTable,
  jobsTable,
  workSessionsTable,
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
import {
  companyId,
  isAdmin,
  requireSubcontractorAccess,
  workerSubcontractorId,
} from "../lib/auth.js";
import { getStoredXeroSettings, getUsableXeroSettings } from "../lib/xero.js";

const router = Router();
const XERO_INVOICES_URL = "https://api.xero.com/api.xro/2.0/Invoices";
const WORKER_INVOICE_ACKNOWLEDGEMENT_TEXT =
  "By submitting this invoice, I acknowledge and agree that I have reviewed the invoice details, including completed work, hours, metres, rates, GST status and total amount, and confirm they are correct to the best of my knowledge.";

type WeeklyInvoiceLineItem = {
  jobId?: number | null;
  jobTitle?: string | null;
  jobAddress?: string | null;
  dispatchDate?: string | null;
  metersCompleted?: number | string | null;
  ratePerMetre?: number | string | null;
  hourlyRate?: number | string | null;
  hourlyAmount?: number | string | null;
  payBasis?: "metres" | "hours" | "adjustment" | "unset";
  amount?: number | string | null;
  stockCost?: number | string | null;
  reportId?: number | null;
  hoursWorked?: number | string | null;
  jobDescription?: string | null;
  adminAdjustment?: boolean;
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
  totalHours: number;
  gstRegistered: boolean;
  subtotal: number;
  tax: number;
  total: number;
};

function serializeInvoice(
  inv: typeof weeklyInvoicesTable.$inferSelect,
  subName: string | null = null,
) {
  return {
    ...inv,
    subcontractorName: subName,
    totalMetres: Number(inv.totalMetres),
    gstRegistered: Boolean(inv.gstRegistered),
    subtotal: Number(inv.subtotal),
    tax: Number(inv.tax),
    total: Number(inv.total),
    reviewStatus: inv.reviewStatus ?? "none",
    reviewAdjustmentAmount:
      inv.reviewAdjustmentAmount == null
        ? null
        : Number(inv.reviewAdjustmentAmount),
    lineItems: Array.isArray(inv.lineItems) ? inv.lineItems : [],
  };
}

function getInvoiceNumber(inv: typeof weeklyInvoicesTable.$inferSelect) {
  return `WI-${String(inv.id).padStart(5, "0")}`;
}

function invoiceChargesGst(inv: typeof weeklyInvoicesTable.$inferSelect) {
  return Boolean(inv.gstRegistered) || Number(inv.tax ?? 0) > 0;
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
    breakMinutes += Math.max(
      0,
      Math.round(
        (Date.now() - new Date(session.breakStartAt).getTime()) / 60000,
      ),
    );
  }
  const minutes =
    Math.round(
      (new Date(end).getTime() - new Date(session.clockedOnAt).getTime()) /
        60000,
    ) - breakMinutes;
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
  return Array.isArray(inv.lineItems)
    ? (inv.lineItems as WeeklyInvoiceLineItem[])
    : [];
}

function isAdminAdjustmentLine(item: WeeklyInvoiceLineItem) {
  return Boolean(item.adminAdjustment) || item.payBasis === "adjustment";
}

function baseInvoiceLineItems(inv: typeof weeklyInvoicesTable.$inferSelect) {
  return lineItems(inv).filter((item) => !isAdminAdjustmentLine(item));
}

function adjustmentLine(reason: string, amount: number): WeeklyInvoiceLineItem {
  return {
    jobId: null,
    jobTitle: "Invoice adjustment",
    jobAddress: null,
    dispatchDate: null,
    metersCompleted: 0,
    ratePerMetre: 0,
    hourlyRate: null,
    hourlyAmount: null,
    payBasis: "adjustment",
    amount: money(amount),
    stockCost: 0,
    reportId: null,
    hoursWorked: null,
    jobDescription: reason,
    adminAdjustment: true,
  };
}

function recalcInvoiceTotals(
  items: WeeklyInvoiceLineItem[],
  gstRegistered: boolean,
) {
  const totalMetres = items.reduce(
    (sum, item) => sum + Number(item.metersCompleted ?? 0),
    0,
  );
  const subtotal = items.reduce(
    (sum, item) => sum + Number(item.amount ?? 0),
    0,
  );
  const tax = gstRegistered ? subtotal * 0.1 : 0;
  return {
    totalMetres: money(totalMetres),
    subtotal: money(subtotal),
    tax: money(tax),
    total: money(subtotal + tax),
  };
}

function hoursFromAssignment(
  assignment: typeof jobAssignmentsTable.$inferSelect | null | undefined,
) {
  if (!assignment?.arrivedAt || !assignment.departedAt) return null;
  const minutes = Math.max(
    0,
    Math.round(
      (new Date(assignment.departedAt).getTime() -
        new Date(assignment.arrivedAt).getTime()) /
        60000,
    ),
  );
  return money(minutes / 60);
}

function reportHours(
  report: typeof jobReportsTable.$inferSelect,
  assignment: typeof jobAssignmentsTable.$inferSelect | null | undefined,
) {
  const enteredHours =
    report.hoursWorked == null ? 0 : Number(report.hoursWorked);
  return enteredHours > 0
    ? money(enteredHours)
    : hoursFromAssignment(assignment);
}

function invoiceJobDescription(
  report: typeof jobReportsTable.$inferSelect,
  job: typeof jobsTable.$inferSelect | null | undefined,
  assignment: typeof jobAssignmentsTable.$inferSelect | null | undefined,
) {
  return (
    report.workDescription?.trim() ||
    report.generalNotes?.trim() ||
    assignment?.workArea?.trim() ||
    job?.description?.trim() ||
    job?.notes?.trim() ||
    null
  );
}

function xeroLineDescription(
  inv: typeof weeklyInvoicesTable.$inferSelect,
  item: WeeklyInvoiceLineItem,
) {
  if (isAdminAdjustmentLine(item)) {
    return item.jobDescription?.trim()
      ? `Invoice adjustment - ${item.jobDescription.trim()}`
      : "Invoice adjustment";
  }
  const base = `${item.dispatchDate ?? inv.weekStartDate} - ${item.jobTitle ?? "Joint sealing labour"}${item.jobAddress ? ` (${item.jobAddress})` : ""}`;
  const details = [
    item.jobDescription?.trim(),
    item.hoursWorked != null && Number(item.hoursWorked) > 0
      ? `${Number(item.hoursWorked).toFixed(2)} hours`
      : null,
  ].filter(Boolean);
  return details.length ? `${base} - ${details.join(" - ")}` : base;
}

function linePayBasis(item: WeeklyInvoiceLineItem) {
  if (item.payBasis === "adjustment") return "adjustment";
  if (item.payBasis === "hours" || item.payBasis === "metres")
    return item.payBasis;
  return Number(item.ratePerMetre ?? 0) > 0
    ? "metres"
    : Number(item.hourlyRate ?? 0) > 0
      ? "hours"
      : "unset";
}

function xeroLineQuantity(item: WeeklyInvoiceLineItem) {
  if (linePayBasis(item) === "adjustment") return 1;
  return linePayBasis(item) === "hours"
    ? Number(item.hoursWorked ?? 0)
    : Number(item.metersCompleted ?? 0);
}

function xeroLineUnitAmount(item: WeeklyInvoiceLineItem) {
  if (linePayBasis(item) === "adjustment") return Number(item.amount ?? 0);
  return linePayBasis(item) === "hours"
    ? Number(item.hourlyRate ?? 0)
    : Number(item.ratePerMetre ?? 0);
}

function submittedReportIds(
  invoices: Array<typeof weeklyInvoicesTable.$inferSelect>,
) {
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
  const hourlyRate = sub.hourlyRate ? Number(sub.hourlyRate) : 0;
  const items = await Promise.all(
    reports.map(async (r) => {
      const [job] = r.jobId
        ? await db
            .select()
            .from(jobsTable)
            .where(
              and(eq(jobsTable.id, r.jobId), eq(jobsTable.companyId, tenantId)),
            )
        : [null];
      const [assignment] = r.jobAssignmentId
        ? await db
            .select()
            .from(jobAssignmentsTable)
            .where(
              and(
                eq(jobAssignmentsTable.id, r.jobAssignmentId),
                eq(jobAssignmentsTable.companyId, tenantId),
              ),
            )
        : [null];
      const metres = Number(r.metersCompleted);
      const hoursWorked = reportHours(r, assignment);
      const hours = Number(hoursWorked ?? 0);
      const hourlyAmount = hours * hourlyRate;
      const payBasis: WeeklyInvoiceLineItem["payBasis"] =
        ratePerMetre > 0 ? "metres" : hourlyRate > 0 ? "hours" : "unset";
      const amount =
        payBasis === "hours" ? hourlyAmount : metres * ratePerMetre;
      return {
        jobId: r.jobId,
        jobTitle: job?.title ?? "Unknown Job",
        jobAddress: job?.address ?? null,
        dispatchDate: r.dispatchDate ?? null,
        metersCompleted: metres,
        ratePerMetre,
        hourlyRate,
        hourlyAmount: money(hourlyAmount),
        payBasis,
        amount: money(amount),
        stockCost: 0,
        reportId: r.id,
        hoursWorked,
        jobDescription: invoiceJobDescription(r, job, assignment),
      };
    }),
  );
  const totalMetres = items.reduce(
    (sum, item) => sum + Number(item.metersCompleted ?? 0),
    0,
  );
  const totalHours = items.reduce(
    (sum, item) => sum + Number(item.hoursWorked ?? 0),
    0,
  );
  const subtotal = items.reduce(
    (sum, item) => sum + Number(item.amount ?? 0),
    0,
  );
  const gstRegistered = Boolean(sub.gstRegistered);
  const tax = gstRegistered ? subtotal * 0.1 : 0;
  return {
    lineItems: items,
    totalMetres: money(totalMetres),
    totalHours: money(totalHours),
    gstRegistered,
    subtotal: money(subtotal),
    tax: money(tax),
    total: money(subtotal + tax),
  };
}

async function getWeekContext(
  tenantId: number,
  subcontractorId: number,
  weekStartInput?: string,
) {
  const weekStart = mondayForDate(weekStartInput);
  const weekEnd = addDays(weekStart, 6);
  const [sub] = await db
    .select()
    .from(subcontractorsTable)
    .where(
      and(
        eq(subcontractorsTable.id, subcontractorId),
        eq(subcontractorsTable.companyId, tenantId),
      ),
    );
  if (!sub) return null;

  const [reports, sessions, invoices] = await Promise.all([
    db
      .select()
      .from(jobReportsTable)
      .where(
        and(
          eq(jobReportsTable.companyId, tenantId),
          eq(jobReportsTable.subcontractorId, subcontractorId),
          gte(jobReportsTable.dispatchDate, weekStart),
          lte(jobReportsTable.dispatchDate, weekEnd),
        ),
      ),
    db
      .select()
      .from(workSessionsTable)
      .where(
        and(
          eq(workSessionsTable.companyId, tenantId),
          eq(workSessionsTable.subcontractorId, subcontractorId),
          gte(workSessionsTable.date, weekStart),
          lte(workSessionsTable.date, weekEnd),
        ),
      ),
    db
      .select()
      .from(weeklyInvoicesTable)
      .where(
        and(
          eq(weeklyInvoicesTable.companyId, tenantId),
          eq(weeklyInvoicesTable.subcontractorId, subcontractorId),
          eq(weeklyInvoicesTable.weekStartDate, weekStart),
        ),
      ),
  ]);

  return { sub, weekStart, weekEnd, reports, sessions, invoices };
}

async function buildEarningsSummary(
  tenantId: number,
  subcontractorId: number,
  weekStartInput?: string,
) {
  const context = await getWeekContext(
    tenantId,
    subcontractorId,
    weekStartInput,
  );
  if (!context) return null;
  const { sub, weekStart, weekEnd, reports, sessions, invoices } = context;
  const submittedIds = submittedReportIds(invoices);
  const uninvoicedReports = reports.filter(
    (report) => !submittedIds.has(report.id),
  );
  const earnedValues = await buildWeeklyInvoiceValues(tenantId, sub, reports);
  const toInvoiceValues = await buildWeeklyInvoiceValues(
    tenantId,
    sub,
    uninvoicedReports,
  );
  const totalWorkMinutes = sessions.reduce(
    (sum, session) => sum + workSessionMinutes(session),
    0,
  );
  const draftInvoice =
    invoices.find((invoice) => invoice.status === "draft") ?? null;
  const latestSubmittedInvoice =
    [...invoices]
      .reverse()
      .find(
        (invoice) =>
          invoice.status === "submitted" || invoice.status === "paid",
      ) ?? null;

  return {
    subcontractorId,
    subcontractorName: sub.name,
    weekStartDate: weekStart,
    weekEndDate: weekEnd,
    totalWorkMinutes,
    totalHours: Number((totalWorkMinutes / 60).toFixed(2)),
    ratePerMetre: sub.ratePerMetre ? Number(sub.ratePerMetre) : 0,
    hourlyRate: sub.hourlyRate ? Number(sub.hourlyRate) : 0,
    gstRegistered: sub.gstRegistered,
    completedInvoiceHours: earnedValues.totalHours,
    uninvoicedInvoiceHours: toInvoiceValues.totalHours,
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

async function upsertCurrentWeeklyInvoice(
  tenantId: number,
  subcontractorId: number,
  weekStartInput?: string,
) {
  const context = await getWeekContext(
    tenantId,
    subcontractorId,
    weekStartInput,
  );
  if (!context) return null;
  const { sub, weekStart, weekEnd, reports, invoices } = context;
  const submittedIds = submittedReportIds(invoices);
  const uninvoicedReports = reports.filter(
    (report) => !submittedIds.has(report.id),
  );
  const values = await buildWeeklyInvoiceValues(
    tenantId,
    sub,
    uninvoicedReports,
  );
  if (values.lineItems.length === 0) {
    return { sub, invoice: null, values };
  }

  const draft = invoices.find((invoice) => invoice.status === "draft") ?? null;
  if (draft) {
    if (
      draft.reviewStatus === "changes_requested" ||
      draft.reviewStatus === "accepted"
    ) {
      return { sub, invoice: draft, values };
    }
    const [updated] = await db
      .update(weeklyInvoicesTable)
      .set({
        lineItems: values.lineItems,
        totalMetres: String(values.totalMetres.toFixed(2)),
        gstRegistered: values.gstRegistered,
        subtotal: String(values.subtotal.toFixed(2)),
        tax: String(values.tax.toFixed(2)),
        total: String(values.total.toFixed(2)),
      })
      .where(
        and(
          eq(weeklyInvoicesTable.id, draft.id),
          eq(weeklyInvoicesTable.companyId, tenantId),
        ),
      )
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
      gstRegistered: values.gstRegistered,
      subtotal: String(values.subtotal.toFixed(2)),
      tax: String(values.tax.toFixed(2)),
      total: String(values.total.toFixed(2)),
    })
    .returning();
  return { sub, invoice: created, values };
}

function getXeroTaxType() {
  return process.env.XERO_TAX_TYPE?.trim() || "INPUT";
}

function getInvoiceXeroTaxType(inv: typeof weeklyInvoicesTable.$inferSelect) {
  return invoiceChargesGst(inv) ? getXeroTaxType() : "NONE";
}

async function buildXeroCsv(
  inv: typeof weeklyInvoicesTable.$inferSelect,
  subName: string | null,
) {
  const settings = await getStoredXeroSettings(inv.companyId ?? 0);
  const accountCode =
    settings?.defaultAccountCode ||
    process.env.XERO_DEFAULT_ACCOUNT_CODE ||
    "310";
  const taxType = getInvoiceXeroTaxType(inv);
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
      xeroLineDescription(inv, item),
      String(xeroLineQuantity(item).toFixed(2)),
      String(xeroLineUnitAmount(item).toFixed(2)),
      accountCode,
      taxType,
    ]);
  }

  return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
}

async function createXeroDraftBill(
  inv: typeof weeklyInvoicesTable.$inferSelect,
  subName: string | null,
) {
  const settings = await getUsableXeroSettings(inv.companyId ?? 0);
  const accessToken = settings.accessToken;
  const tenantId = settings.tenantId;
  const accountCode =
    settings.defaultAccountCode ||
    process.env.XERO_DEFAULT_ACCOUNT_CODE ||
    "310";
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
            Description: xeroLineDescription(inv, item),
            Quantity: xeroLineQuantity(item),
            UnitAmount: xeroLineUnitAmount(item),
            AccountCode: accountCode,
            TaxType: getInvoiceXeroTaxType(inv),
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
  return (
    xeroInvoice?.InvoiceID ||
    xeroInvoice?.InvoiceNumber ||
    getInvoiceNumber(inv)
  );
}

router.get("/weekly-invoices", async (req, res) => {
  const parsed = ListWeeklyInvoicesQueryParams.safeParse({
    ...req.query,
    subcontractorId: req.query.subcontractorId
      ? Number(req.query.subcontractorId)
      : undefined,
  });
  if (!parsed.success) return res.status(400).json({ error: "Invalid query" });

  const conditions = [eq(weeklyInvoicesTable.companyId, companyId(req))];
  const ownSubcontractorId = workerSubcontractorId(req);
  if (ownSubcontractorId) {
    conditions.push(
      eq(weeklyInvoicesTable.subcontractorId, ownSubcontractorId),
    );
  } else if (parsed.data.subcontractorId) {
    conditions.push(
      eq(weeklyInvoicesTable.subcontractorId, parsed.data.subcontractorId),
    );
  }
  if (parsed.data.status)
    conditions.push(eq(weeklyInvoicesTable.status, parsed.data.status));

  const invoices = await db
    .select()
    .from(weeklyInvoicesTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(weeklyInvoicesTable.weekStartDate);

  const subs = await db
    .select()
    .from(subcontractorsTable)
    .where(eq(subcontractorsTable.companyId, companyId(req)));
  const subMap = new Map(subs.map((s) => [s.id, s.name]));

  return res.json(
    invoices.map((i) =>
      serializeInvoice(i, subMap.get(i.subcontractorId) ?? null),
    ),
  );
});

router.get("/weekly-invoices/earnings-summary", async (req, res) => {
  const subcontractorId =
    workerSubcontractorId(req) ??
    (req.query.subcontractorId ? Number(req.query.subcontractorId) : undefined);
  if (!subcontractorId)
    return res.status(400).json({ error: "subcontractorId required" });
  if (!requireSubcontractorAccess(req, res, subcontractorId)) return;

  const summary = await buildEarningsSummary(
    companyId(req),
    subcontractorId,
    req.query.weekStartDate as string | undefined,
  );
  if (!summary)
    return res.status(404).json({ error: "Employee/subcontractor not found" });
  return res.json(summary);
});

router.post("/weekly-invoices/submit-current", async (req, res) => {
  const subcontractorId =
    workerSubcontractorId(req) ??
    (req.body.subcontractorId ? Number(req.body.subcontractorId) : undefined);
  if (!subcontractorId)
    return res.status(400).json({ error: "subcontractorId required" });
  if (!requireSubcontractorAccess(req, res, subcontractorId)) return;

  const submittedByWorker = Boolean(workerSubcontractorId(req));
  if (submittedByWorker && req.body.workerAcknowledged !== true) {
    return res.status(400).json({
      error:
        "Please tick the invoice acknowledgement before submitting your invoice.",
    });
  }

  const tenantId = companyId(req);
  const prepared = await upsertCurrentWeeklyInvoice(
    tenantId,
    subcontractorId,
    req.body.weekStartDate,
  );
  if (!prepared)
    return res.status(404).json({ error: "Employee/subcontractor not found" });
  if (!prepared.invoice) {
    return res
      .status(400)
      .json({ error: "No uninvoiced completed work for this week" });
  }
  if (prepared.invoice.reviewStatus === "changes_requested") {
    return res.status(400).json({
      error:
        "Admin has suggested invoice edits. Open the invoice, review the reason, and accept the change before submitting.",
      invoice: serializeInvoice(prepared.invoice, prepared.sub.name),
    });
  }
  const hasMetreRate = Boolean(
    prepared.sub.ratePerMetre && Number(prepared.sub.ratePerMetre) > 0,
  );
  const hasHourlyRate = Boolean(
    prepared.sub.hourlyRate && Number(prepared.sub.hourlyRate) > 0,
  );
  if (!hasMetreRate && !hasHourlyRate) {
    return res.status(400).json({
      error:
        "A metre rate or hourly rate must be set before sending an invoice to Xero",
    });
  }
  const acknowledgementUpdates = submittedByWorker
    ? {
        workerAcknowledgedAt: new Date(),
        workerAcknowledgementText: WORKER_INVOICE_ACKNOWLEDGEMENT_TEXT,
      }
    : {};

  let xeroInvoiceId: string;
  try {
    xeroInvoiceId = await createXeroDraftBill(
      prepared.invoice,
      prepared.sub.name,
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not submit invoice to Xero";
    let invoiceForResponse = prepared.invoice;
    if (submittedByWorker) {
      [invoiceForResponse] = await db
        .update(weeklyInvoicesTable)
        .set(acknowledgementUpdates)
        .where(
          and(
            eq(weeklyInvoicesTable.id, prepared.invoice.id),
            eq(weeklyInvoicesTable.companyId, tenantId),
          ),
        )
        .returning();
    }
    return res.status(202).json({
      error: "Xero submission failed",
      message,
      xeroSubmissionFailed: true,
      invoice: serializeInvoice(invoiceForResponse, prepared.sub.name),
      summary: await buildEarningsSummary(
        tenantId,
        subcontractorId,
        req.body.weekStartDate,
      ),
      csvDownloadUrl: `/api/weekly-invoices/${prepared.invoice.id}/xero-csv`,
    });
  }

  const [submitted] = await db
    .update(weeklyInvoicesTable)
    .set({
      status: "submitted",
      submittedAt: new Date(),
      xeroInvoiceId,
      ...acknowledgementUpdates,
    })
    .where(
      and(
        eq(weeklyInvoicesTable.id, prepared.invoice.id),
        eq(weeklyInvoicesTable.companyId, tenantId),
      ),
    )
    .returning();

  return res.json({
    invoice: serializeInvoice(submitted, prepared.sub.name),
    summary: await buildEarningsSummary(
      tenantId,
      subcontractorId,
      req.body.weekStartDate,
    ),
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
  if (parsed.data.subcontractorId)
    subConditions.push(eq(subcontractorsTable.id, parsed.data.subcontractorId));
  const subs = await db
    .select()
    .from(subcontractorsTable)
    .where(and(...subConditions, eq(subcontractorsTable.active, true)));

  const reports = await db
    .select()
    .from(jobReportsTable)
    .where(
      and(
        eq(jobReportsTable.companyId, tenantId),
        gte(jobReportsTable.dispatchDate, weekStart),
        lte(jobReportsTable.dispatchDate, weekEnd),
      ),
    );

  const created: (typeof weeklyInvoicesTable.$inferSelect)[] = [];

  for (const sub of subs) {
    const subReports = reports.filter((r) => r.subcontractorId === sub.id);
    if (subReports.length === 0) continue;

    const existing = await db
      .select()
      .from(weeklyInvoicesTable)
      .where(
        and(
          eq(weeklyInvoicesTable.companyId, tenantId),
          eq(weeklyInvoicesTable.subcontractorId, sub.id),
          eq(weeklyInvoicesTable.weekStartDate, weekStart),
        ),
      );
    const values = await buildWeeklyInvoiceValues(tenantId, sub, subReports);
    if (existing[0]) {
      if (existing[0].status !== "draft") continue;
      if (
        existing[0].reviewStatus === "changes_requested" ||
        existing[0].reviewStatus === "accepted"
      ) {
        created.push(existing[0]);
        continue;
      }

      const [updated] = await db
        .update(weeklyInvoicesTable)
        .set({
          lineItems: values.lineItems,
          totalMetres: String(values.totalMetres.toFixed(2)),
          gstRegistered: values.gstRegistered,
          subtotal: String(values.subtotal.toFixed(2)),
          tax: String(values.tax.toFixed(2)),
          total: String(values.total.toFixed(2)),
        })
        .where(
          and(
            eq(weeklyInvoicesTable.id, existing[0].id),
            eq(weeklyInvoicesTable.companyId, tenantId),
          ),
        )
        .returning();
      created.push(updated);
      continue;
    }

    const [inv] = await db
      .insert(weeklyInvoicesTable)
      .values({
        subcontractorId: sub.id,
        companyId: tenantId,
        weekStartDate: weekStart,
        weekEndDate: weekEnd,
        status: "draft",
        lineItems: values.lineItems,
        totalMetres: String(values.totalMetres.toFixed(2)),
        gstRegistered: values.gstRegistered,
        subtotal: String(values.subtotal.toFixed(2)),
        tax: String(values.tax.toFixed(2)),
        total: String(values.total.toFixed(2)),
      })
      .returning();
    created.push(inv);
  }

  const subMap = new Map(subs.map((s) => [s.id, s.name]));
  return res
    .status(201)
    .json(
      created.map((i) =>
        serializeInvoice(i, subMap.get(i.subcontractorId) ?? null),
      ),
    );
});

router.get("/weekly-invoices/:id", async (req, res) => {
  const parsed = GetWeeklyInvoiceParams.safeParse({
    id: Number(req.params.id),
  });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });

  const [inv] = await db
    .select()
    .from(weeklyInvoicesTable)
    .where(
      and(
        eq(weeklyInvoicesTable.id, parsed.data.id),
        eq(weeklyInvoicesTable.companyId, companyId(req)),
      ),
    );
  if (!inv) return res.status(404).json({ error: "Not found" });
  if (!requireSubcontractorAccess(req, res, inv.subcontractorId)) return;

  const [sub] = await db
    .select()
    .from(subcontractorsTable)
    .where(
      and(
        eq(subcontractorsTable.id, inv.subcontractorId),
        eq(subcontractorsTable.companyId, companyId(req)),
      ),
    );
  return res.json(serializeInvoice(inv, sub?.name ?? null));
});

router.get("/weekly-invoices/:id/xero-csv", async (req, res) => {
  const parsed = GetWeeklyInvoiceParams.safeParse({
    id: Number(req.params.id),
  });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });

  const [inv] = await db
    .select()
    .from(weeklyInvoicesTable)
    .where(
      and(
        eq(weeklyInvoicesTable.id, parsed.data.id),
        eq(weeklyInvoicesTable.companyId, companyId(req)),
      ),
    );
  if (!inv) return res.status(404).json({ error: "Not found" });
  if (!requireSubcontractorAccess(req, res, inv.subcontractorId)) return;

  const [sub] = await db
    .select()
    .from(subcontractorsTable)
    .where(
      and(
        eq(subcontractorsTable.id, inv.subcontractorId),
        eq(subcontractorsTable.companyId, companyId(req)),
      ),
    );
  const csv = await buildXeroCsv(inv, sub?.name ?? null);

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${getInvoiceNumber(inv)}-xero-bill.csv"`,
  );
  return res.send(csv);
});

router.patch("/weekly-invoices/:id", async (req, res) => {
  const params = UpdateWeeklyInvoiceParams.safeParse({
    id: Number(req.params.id),
  });
  const body = UpdateWeeklyInvoiceBody.safeParse(req.body);
  if (!params.success || !body.success)
    return res.status(400).json({ error: "Invalid request" });

  const [existing] = await db
    .select()
    .from(weeklyInvoicesTable)
    .where(
      and(
        eq(weeklyInvoicesTable.id, params.data.id),
        eq(weeklyInvoicesTable.companyId, companyId(req)),
      ),
    );
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (!requireSubcontractorAccess(req, res, existing.subcontractorId)) return;

  const admin = isAdmin(req);
  const updates: Record<string, unknown> = {};
  if (body.data.notes !== undefined) {
    if (!admin)
      return res.status(403).json({ error: "Only admin can update notes" });
    updates.notes = body.data.notes;
  }
  if (body.data.status !== undefined) {
    if (!admin)
      return res.status(403).json({ error: "Only admin can update status" });
    updates.status = body.data.status;
  }
  if (body.data.gstRegistered !== undefined) {
    if (!admin)
      return res.status(403).json({ error: "Only admin can update GST" });
    if (existing.status !== "draft") {
      return res
        .status(400)
        .json({ error: "GST can only be changed on draft invoices" });
    }
    const subtotal = Number(existing.subtotal ?? 0);
    const tax = body.data.gstRegistered ? money(subtotal * 0.1) : 0;
    updates.gstRegistered = body.data.gstRegistered;
    updates.tax = String(tax.toFixed(2));
    updates.total = String((subtotal + tax).toFixed(2));
  }
  if (body.data.reviewStatus !== undefined) {
    const reviewStatus = body.data.reviewStatus;
    if (existing.status !== "draft") {
      return res
        .status(400)
        .json({ error: "Invoice edits can only be reviewed on draft invoices" });
    }

    if (reviewStatus === "changes_requested") {
      if (!admin) {
        return res
          .status(403)
          .json({ error: "Only admin can suggest invoice edits" });
      }
      const reason = body.data.reviewReason?.trim();
      const amount = Number(body.data.reviewAdjustmentAmount ?? 0);
      if (!reason) {
        return res
          .status(400)
          .json({ error: "A reason is required before sending to the worker" });
      }
      if (!Number.isFinite(amount) || amount === 0) {
        return res.status(400).json({
          error:
            "Enter a non-zero adjustment amount. Use a negative amount for deductions.",
        });
      }
      const baseItems = baseInvoiceLineItems(existing);
      const totals = recalcInvoiceTotals(
        baseItems,
        Boolean(existing.gstRegistered),
      );
      updates.lineItems = baseItems;
      updates.totalMetres = String(totals.totalMetres.toFixed(2));
      updates.subtotal = String(totals.subtotal.toFixed(2));
      updates.tax = String(totals.tax.toFixed(2));
      updates.total = String(totals.total.toFixed(2));
      updates.reviewStatus = "changes_requested";
      updates.reviewReason = reason;
      updates.reviewAdjustmentAmount = String(money(amount).toFixed(2));
      updates.reviewRequestedAt = new Date();
      updates.reviewRespondedAt = null;
      updates.reviewResponseNotes = null;
    } else if (reviewStatus === "accepted") {
      if (existing.reviewStatus !== "changes_requested") {
        return res
          .status(400)
          .json({ error: "There is no suggested invoice edit to accept" });
      }
      const amount = Number(existing.reviewAdjustmentAmount ?? 0);
      const reason = existing.reviewReason ?? "Accepted invoice adjustment";
      const items = [
        ...baseInvoiceLineItems(existing),
        adjustmentLine(reason, amount),
      ];
      const totals = recalcInvoiceTotals(
        items,
        Boolean(existing.gstRegistered),
      );
      updates.lineItems = items;
      updates.totalMetres = String(totals.totalMetres.toFixed(2));
      updates.subtotal = String(totals.subtotal.toFixed(2));
      updates.tax = String(totals.tax.toFixed(2));
      updates.total = String(totals.total.toFixed(2));
      updates.reviewStatus = "accepted";
      updates.reviewRespondedAt = new Date();
      updates.reviewResponseNotes =
        body.data.reviewResponseNotes?.trim() || null;
    } else if (reviewStatus === "none") {
      if (!admin) {
        return res
          .status(403)
          .json({ error: "Only admin can cancel suggested invoice edits" });
      }
      const baseItems = baseInvoiceLineItems(existing);
      const totals = recalcInvoiceTotals(
        baseItems,
        Boolean(existing.gstRegistered),
      );
      updates.lineItems = baseItems;
      updates.totalMetres = String(totals.totalMetres.toFixed(2));
      updates.subtotal = String(totals.subtotal.toFixed(2));
      updates.tax = String(totals.tax.toFixed(2));
      updates.total = String(totals.total.toFixed(2));
      updates.reviewStatus = "none";
      updates.reviewReason = null;
      updates.reviewAdjustmentAmount = null;
      updates.reviewRequestedAt = null;
      updates.reviewRespondedAt = null;
      updates.reviewResponseNotes = null;
    }
  }

  const [inv] = await db
    .update(weeklyInvoicesTable)
    .set(updates)
    .where(
      and(
        eq(weeklyInvoicesTable.id, params.data.id),
        eq(weeklyInvoicesTable.companyId, companyId(req)),
      ),
    )
    .returning();
  if (!inv) return res.status(404).json({ error: "Not found" });

  const [sub] = await db
    .select()
    .from(subcontractorsTable)
    .where(
      and(
        eq(subcontractorsTable.id, inv.subcontractorId),
        eq(subcontractorsTable.companyId, companyId(req)),
      ),
    );
  return res.json(serializeInvoice(inv, sub?.name ?? null));
});

router.post("/weekly-invoices/:id/submit", async (req, res) => {
  const parsed = SubmitWeeklyInvoiceParams.safeParse({
    id: Number(req.params.id),
  });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });

  const [existing] = await db
    .select()
    .from(weeklyInvoicesTable)
    .where(
      and(
        eq(weeklyInvoicesTable.id, parsed.data.id),
        eq(weeklyInvoicesTable.companyId, companyId(req)),
      ),
    );
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (!requireSubcontractorAccess(req, res, existing.subcontractorId)) return;
  const submittedByWorker = Boolean(workerSubcontractorId(req));
  if (submittedByWorker && req.body.workerAcknowledged !== true) {
    return res.status(400).json({
      error:
        "Please tick the invoice acknowledgement before submitting your invoice.",
    });
  }
  if (existing.reviewStatus === "changes_requested") {
    return res.status(400).json({
      error:
        "This invoice has suggested edits waiting for worker acceptance before it can be sent to Xero.",
    });
  }

  const [sub] = await db
    .select()
    .from(subcontractorsTable)
    .where(
      and(
        eq(subcontractorsTable.id, existing.subcontractorId),
        eq(subcontractorsTable.companyId, companyId(req)),
      ),
    );

  let xeroInvoiceId: string;
  try {
    xeroInvoiceId = await createXeroDraftBill(existing, sub?.name ?? null);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not submit invoice to Xero";
    return res.status(400).json({
      error: "Xero submission failed",
      message,
      csvDownloadUrl: `/api/weekly-invoices/${existing.id}/xero-csv`,
    });
  }

  const [inv] = await db
    .update(weeklyInvoicesTable)
    .set({
      status: "submitted",
      submittedAt: new Date(),
      xeroInvoiceId,
      ...(submittedByWorker
        ? {
            workerAcknowledgedAt: new Date(),
            workerAcknowledgementText: WORKER_INVOICE_ACKNOWLEDGEMENT_TEXT,
          }
        : {}),
    })
    .where(
      and(
        eq(weeklyInvoicesTable.id, parsed.data.id),
        eq(weeklyInvoicesTable.companyId, companyId(req)),
      ),
    )
    .returning();

  return res.json(serializeInvoice(inv, sub?.name ?? null));
});

export default router;

import { Router } from "express";
import { randomBytes } from "node:crypto";
import { db } from "@workspace/db";
import {
  customersTable,
  invoicesTable,
  subcontractorsTable,
  weeklyInvoicesTable,
  xeroSettingsTable,
} from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { UpdateXeroSettingsBody } from "@workspace/api-zod";
import { companyId, requireAdmin } from "../lib/auth.js";
import {
  exchangeCodeForXeroTokens,
  fetchXeroConnections,
  getOrCreateXeroSettings,
  getUsableXeroSettings,
  getXeroClientId,
  getXeroRedirectUri,
  isXeroPlatformConfigured,
  serializeXeroSettings,
  XERO_AUTHORIZE_URL,
  XERO_CONNECTIONS_URL,
  XERO_SCOPES,
  xeroApi,
  type XeroSettingsRow,
} from "../lib/xero.js";

const router = Router();
const XERO_STATE_COOKIE = "ds_xero_state";

type XeroOrganisationResponse = {
  Organisations?: Array<{ Name?: string }>;
};

type XeroContactsResponse = {
  Contacts?: Array<{ ContactID?: string; Name?: string }>;
};

type XeroInvoiceResponse = {
  Invoices?: Array<{
    InvoiceID?: string;
    InvoiceNumber?: string;
  }>;
};

type InvoiceLineItem = {
  description?: string;
  quantity?: number | string;
  unitPrice?: number | string;
  total?: number | string;
};

type WeeklyInvoiceLineItem = {
  jobTitle?: string | null;
  jobAddress?: string | null;
  dispatchDate?: string | null;
  metersCompleted?: number | string | null;
  ratePerMetre?: number | string | null;
  hourlyRate?: number | string | null;
  payBasis?: "metres" | "hours" | "unset";
  hoursWorked?: number | string | null;
  jobDescription?: string | null;
};

function xeroDate(value: Date | string | null | undefined) {
  if (!value) return new Date().toISOString().split("T")[0];
  if (typeof value === "string") return value.split("T")[0];
  return value.toISOString().split("T")[0];
}

function addDays(date: string, days: number) {
  const result = new Date(`${date}T00:00:00`);
  result.setDate(result.getDate() + days);
  return result.toISOString().split("T")[0];
}

function getSalesAccountCode(settings: XeroSettingsRow) {
  return process.env.XERO_SALES_ACCOUNT_CODE?.trim() || settings.defaultAccountCode || process.env.XERO_DEFAULT_ACCOUNT_CODE || "200";
}

function getPurchaseAccountCode(settings: XeroSettingsRow) {
  return settings.defaultAccountCode || process.env.XERO_DEFAULT_ACCOUNT_CODE || "310";
}

function getSalesTaxType() {
  return process.env.XERO_SALES_TAX_TYPE?.trim() || "OUTPUT";
}

function getPurchaseTaxType() {
  return process.env.XERO_PURCHASE_TAX_TYPE?.trim() || process.env.XERO_TAX_TYPE?.trim() || "INPUT";
}

function invoiceLineItems(inv: typeof invoicesTable.$inferSelect) {
  return Array.isArray(inv.lineItems) ? (inv.lineItems as InvoiceLineItem[]) : [];
}

function weeklyLineItems(inv: typeof weeklyInvoicesTable.$inferSelect) {
  return Array.isArray(inv.lineItems) ? (inv.lineItems as WeeklyInvoiceLineItem[]) : [];
}

function weeklyInvoiceNumber(inv: typeof weeklyInvoicesTable.$inferSelect) {
  return `WI-${String(inv.id).padStart(5, "0")}`;
}

function weeklyLinePayBasis(item: WeeklyInvoiceLineItem) {
  if (item.payBasis === "hours" || item.payBasis === "metres") return item.payBasis;
  return Number(item.ratePerMetre ?? 0) > 0 ? "metres" : Number(item.hourlyRate ?? 0) > 0 ? "hours" : "unset";
}

function weeklyLineQuantity(item: WeeklyInvoiceLineItem) {
  return weeklyLinePayBasis(item) === "hours"
    ? Number(item.hoursWorked ?? 0)
    : Number(item.metersCompleted ?? 0);
}

function weeklyLineUnitAmount(item: WeeklyInvoiceLineItem) {
  return weeklyLinePayBasis(item) === "hours"
    ? Number(item.hourlyRate ?? 0)
    : Number(item.ratePerMetre ?? 0);
}

function weeklyLineDescription(inv: typeof weeklyInvoicesTable.$inferSelect, item: WeeklyInvoiceLineItem) {
  const base = `${item.dispatchDate ?? inv.weekStartDate} - ${item.jobTitle ?? "Joint sealing labour"}${item.jobAddress ? ` (${item.jobAddress})` : ""}`;
  const details = [
    item.jobDescription?.trim(),
    item.hoursWorked != null && Number(item.hoursWorked) > 0 ? `${Number(item.hoursWorked).toFixed(2)} hours` : null,
  ].filter(Boolean);
  return details.length ? `${base} - ${details.join(" - ")}` : base;
}

async function syncCustomerToXero(companyAccountId: number, customer: typeof customersTable.$inferSelect) {
  const contactName = customer.company?.trim() || customer.name;
  const payload = {
    ...(customer.xeroContactId ? { ContactID: customer.xeroContactId } : {}),
    Name: contactName,
    EmailAddress: customer.email || undefined,
    Phones: customer.phone ? [{ PhoneType: "DEFAULT", PhoneNumber: customer.phone }] : undefined,
    Addresses: customer.address || customer.suburb || customer.state || customer.postcode
      ? [{
          AddressType: "STREET",
          AddressLine1: customer.address || undefined,
          City: customer.suburb || undefined,
          Region: customer.state || undefined,
          PostalCode: customer.postcode || undefined,
        }]
      : undefined,
  };

  const { data } = await xeroApi<XeroContactsResponse>(companyAccountId, "/Contacts", {
    method: "POST",
    body: JSON.stringify({ Contacts: [payload] }),
  });
  const contactId = data.Contacts?.[0]?.ContactID;
  if (!contactId) throw new Error(`Xero did not return a contact ID for ${contactName}`);

  await db
    .update(customersTable)
    .set({ xeroContactId: contactId, xeroLastSyncedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(customersTable.id, customer.id), eq(customersTable.companyId, companyAccountId)));

  return contactId;
}

async function createXeroSalesInvoice(
  companyAccountId: number,
  settings: XeroSettingsRow,
  invoice: typeof invoicesTable.$inferSelect,
) {
  const lines = invoiceLineItems(invoice);
  if (lines.length === 0) throw new Error(`${invoice.invoiceNumber} has no line items`);

  const [customer] = invoice.customerId
    ? await db
      .select()
      .from(customersTable)
      .where(and(eq(customersTable.id, invoice.customerId), eq(customersTable.companyId, companyAccountId)))
    : [null];
  const contactName = customer?.company?.trim() || customer?.name || `Client ${invoice.invoiceNumber}`;
  const contactId = customer ? await syncCustomerToXero(companyAccountId, customer) : null;
  const invoiceDate = xeroDate(invoice.createdAt);

  const { data } = await xeroApi<XeroInvoiceResponse>(companyAccountId, "/Invoices", {
    method: "POST",
    body: JSON.stringify({
      Invoices: [
        {
          Type: "ACCREC",
          Contact: contactId ? { ContactID: contactId } : { Name: contactName },
          Date: invoiceDate,
          DueDate: invoice.dueDate || addDays(invoiceDate, 7),
          InvoiceNumber: invoice.invoiceNumber,
          Reference: invoice.title || invoice.notes || undefined,
          Status: "DRAFT",
          LineAmountTypes: "Exclusive",
          LineItems: lines.map((item) => ({
            Description: item.description || invoice.title || "Joint sealing works",
            Quantity: Number(item.quantity ?? 1),
            UnitAmount: Number(item.unitPrice ?? item.total ?? 0),
            AccountCode: getSalesAccountCode(settings),
            TaxType: getSalesTaxType(),
          })),
        },
      ],
    }),
  });

  const xeroInvoice = data.Invoices?.[0];
  const xeroInvoiceId = xeroInvoice?.InvoiceID || xeroInvoice?.InvoiceNumber;
  if (!xeroInvoiceId) throw new Error(`Xero did not return an invoice ID for ${invoice.invoiceNumber}`);

  await db
    .update(invoicesTable)
    .set({ xeroInvoiceId, xeroLastSyncedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(invoicesTable.id, invoice.id), eq(invoicesTable.companyId, companyAccountId)));

  return xeroInvoiceId;
}

async function createXeroWeeklyBill(
  companyAccountId: number,
  settings: XeroSettingsRow,
  invoice: typeof weeklyInvoicesTable.$inferSelect,
  subcontractorName: string | null,
) {
  const lines = weeklyLineItems(invoice);
  if (lines.length === 0) throw new Error(`${weeklyInvoiceNumber(invoice)} has no line items`);

  const { data } = await xeroApi<XeroInvoiceResponse>(companyAccountId, "/Invoices", {
    method: "POST",
    body: JSON.stringify({
      Invoices: [
        {
          Type: "ACCPAY",
          Contact: { Name: subcontractorName || `Subcontractor ${invoice.subcontractorId}` },
          Date: invoice.weekEndDate,
          DueDate: addDays(invoice.weekEndDate, 7),
          InvoiceNumber: weeklyInvoiceNumber(invoice),
          Reference: `Weekly invoice ${invoice.weekStartDate} to ${invoice.weekEndDate}`,
          Status: "DRAFT",
          LineAmountTypes: "Exclusive",
          LineItems: lines.map((item) => ({
            Description: weeklyLineDescription(invoice, item),
            Quantity: weeklyLineQuantity(item),
            UnitAmount: weeklyLineUnitAmount(item),
            AccountCode: getPurchaseAccountCode(settings),
            TaxType: getPurchaseTaxType(),
          })),
        },
      ],
    }),
  });

  const xeroInvoice = data.Invoices?.[0];
  const xeroInvoiceId = xeroInvoice?.InvoiceID || xeroInvoice?.InvoiceNumber;
  if (!xeroInvoiceId) throw new Error(`Xero did not return an invoice ID for ${weeklyInvoiceNumber(invoice)}`);

  await db
    .update(weeklyInvoicesTable)
    .set({ xeroInvoiceId, status: "submitted", submittedAt: new Date() })
    .where(and(eq(weeklyInvoicesTable.id, invoice.id), eq(weeklyInvoicesTable.companyId, companyAccountId)));

  return xeroInvoiceId;
}

router.get("/xero/settings", requireAdmin, async (req, res) => {
  const settings = await getOrCreateXeroSettings(companyId(req));
  return res.json(serializeXeroSettings(settings));
});

router.patch("/xero/settings", requireAdmin, async (req, res) => {
  const parsed = UpdateXeroSettingsBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid body" });

  const settings = await getOrCreateXeroSettings(companyId(req));
  const updates: Record<string, unknown> = {};
  if (parsed.data.invoicePrefix !== undefined) updates.invoicePrefix = parsed.data.invoicePrefix;
  if (parsed.data.defaultAccountCode !== undefined) updates.defaultAccountCode = parsed.data.defaultAccountCode;
  if (parsed.data.autoGenerateDay !== undefined) updates.autoGenerateDay = parsed.data.autoGenerateDay;

  const [updated] = await db
    .update(xeroSettingsTable)
    .set(updates)
    .where(and(eq(xeroSettingsTable.id, settings.id), eq(xeroSettingsTable.companyId, companyId(req))))
    .returning();
  return res.json(serializeXeroSettings(updated));
});

router.post("/xero/connect", requireAdmin, async (_req, res) => {
  if (!isXeroPlatformConfigured()) {
    return res.status(400).json({
      error: "Xero platform OAuth is not configured",
      message: "Add XERO_CLIENT_ID, XERO_CLIENT_SECRET, and XERO_REDIRECT_URI in Render before connecting company accounts.",
    });
  }

  const state = randomBytes(24).toString("base64url");
  res.cookie(XERO_STATE_COOKIE, state, {
    httpOnly: true,
    maxAge: 1000 * 60 * 10,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: getXeroClientId(),
    redirect_uri: getXeroRedirectUri(),
    scope: XERO_SCOPES,
    state,
  });

  return res.json({ authUrl: `${XERO_AUTHORIZE_URL}?${params.toString()}` });
});

router.get("/xero/callback", requireAdmin, async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const error = typeof req.query.error === "string" ? req.query.error : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const expectedState = typeof req.cookies?.[XERO_STATE_COOKIE] === "string" ? req.cookies[XERO_STATE_COOKIE] : "";

  res.clearCookie(XERO_STATE_COOKIE, {
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  if (error) {
    return res.redirect(`/settings/xero?xero=error&message=${encodeURIComponent(error)}`);
  }

  if (!state || !expectedState || state !== expectedState) {
    return res.redirect("/settings/xero?xero=error&message=Invalid%20Xero%20connection%20state");
  }

  if (!code) {
    return res.redirect("/settings/xero?xero=error&message=Missing%20Xero%20authorization%20code");
  }

  try {
    const settings = await getOrCreateXeroSettings(companyId(req));
    const token = await exchangeCodeForXeroTokens(code);
    const connections = await fetchXeroConnections(token.access_token);
    const connection = connections.find((c) => c.tenantType === "ORGANISATION") ?? connections[0];

    if (!connection?.tenantId) {
      throw new Error("Xero did not return a connected organisation.");
    }

    await db.update(xeroSettingsTable).set({
      connected: true,
      tenantId: connection.tenantId,
      tenantName: connection.tenantName ?? null,
      connectionId: connection.id ?? null,
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? settings.refreshToken ?? null,
      tokenExpiresAt: new Date(Date.now() + (token.expires_in ?? 1800) * 1000),
      tokenScope: token.scope ?? null,
      lastSyncAt: new Date(),
    }).where(and(eq(xeroSettingsTable.id, settings.id), eq(xeroSettingsTable.companyId, companyId(req))));

    return res.redirect("/settings/xero?xero=connected");
  } catch (err) {
    req.log.error({ err }, "Xero callback failed");
    const message = err instanceof Error ? err.message : "Xero connection failed";
    return res.redirect(`/settings/xero?xero=error&message=${encodeURIComponent(message)}`);
  }
});

router.post("/xero/disconnect", requireAdmin, async (req, res) => {
  const settings = await getOrCreateXeroSettings(companyId(req));
  if (settings.connectionId && settings.connected) {
    try {
      const usable = await getUsableXeroSettings(companyId(req));
      await fetch(`${XERO_CONNECTIONS_URL}/${settings.connectionId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${usable.accessToken}` },
      });
    } catch (err) {
      req.log.warn({ err }, "Xero remote disconnect failed; clearing local connection");
    }
  }

  const [updated] = await db.update(xeroSettingsTable).set({
    connected: false,
    tenantId: null,
    tenantName: null,
    connectionId: null,
    accessToken: null,
    refreshToken: null,
    tokenExpiresAt: null,
    tokenScope: null,
    lastSyncAt: null,
  }).where(and(eq(xeroSettingsTable.id, settings.id), eq(xeroSettingsTable.companyId, companyId(req)))).returning();
  return res.json(serializeXeroSettings(updated));
});

router.post("/xero/test-connection", requireAdmin, async (req, res) => {
  try {
    const { data } = await xeroApi<XeroOrganisationResponse>(companyId(req), "/Organisation");
    const organisationName = data.Organisations?.[0]?.Name ?? null;
    const settings = await getOrCreateXeroSettings(companyId(req));
    const [updated] = await db.update(xeroSettingsTable).set({
      tenantName: organisationName ?? settings.tenantName,
      lastSyncAt: new Date(),
    }).where(and(eq(xeroSettingsTable.id, settings.id), eq(xeroSettingsTable.companyId, companyId(req)))).returning();

    return res.json({
      connected: true,
      tenantName: updated.tenantName,
      message: "Xero connection is working",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not test Xero connection";
    return res.status(400).json({ error: "Xero test failed", message });
  }
});

router.post("/xero/sync-contacts", requireAdmin, async (req, res) => {
  const tenantId = companyId(req);
  await getUsableXeroSettings(tenantId);
  const customers = await db.select().from(customersTable).where(eq(customersTable.companyId, tenantId));
  let synced = 0;
  const errors: string[] = [];

  for (const customer of customers) {
    try {
      await syncCustomerToXero(tenantId, customer);
      synced += 1;
    } catch (err) {
      errors.push(`${customer.name}: ${err instanceof Error ? err.message : "Sync failed"}`);
    }
  }

  const settings = await getOrCreateXeroSettings(tenantId);
  await db.update(xeroSettingsTable).set({ lastSyncAt: new Date() }).where(and(eq(xeroSettingsTable.id, settings.id), eq(xeroSettingsTable.companyId, tenantId)));

  return res.json({ total: customers.length, synced, failed: errors.length, errors: errors.slice(0, 10) });
});

router.post("/xero/sync-invoices", requireAdmin, async (req, res) => {
  const tenantId = companyId(req);
  const settings = await getUsableXeroSettings(tenantId);
  const [salesInvoices, weeklyInvoices, subcontractors] = await Promise.all([
    db.select().from(invoicesTable).where(and(eq(invoicesTable.companyId, tenantId), isNull(invoicesTable.xeroInvoiceId))),
    db.select().from(weeklyInvoicesTable).where(and(eq(weeklyInvoicesTable.companyId, tenantId), eq(weeklyInvoicesTable.status, "draft"), isNull(weeklyInvoicesTable.xeroInvoiceId))),
    db.select().from(subcontractorsTable).where(eq(subcontractorsTable.companyId, tenantId)),
  ]);
  const subcontractorNames = new Map(subcontractors.map((sub) => [sub.id, sub.name]));
  let syncedSalesInvoices = 0;
  let syncedWeeklyBills = 0;
  const errors: string[] = [];

  for (const invoice of salesInvoices) {
    try {
      await createXeroSalesInvoice(tenantId, settings, invoice);
      syncedSalesInvoices += 1;
    } catch (err) {
      errors.push(`${invoice.invoiceNumber}: ${err instanceof Error ? err.message : "Sync failed"}`);
    }
  }

  for (const invoice of weeklyInvoices) {
    try {
      await createXeroWeeklyBill(tenantId, settings, invoice, subcontractorNames.get(invoice.subcontractorId) ?? null);
      syncedWeeklyBills += 1;
    } catch (err) {
      errors.push(`${weeklyInvoiceNumber(invoice)}: ${err instanceof Error ? err.message : "Sync failed"}`);
    }
  }

  await db.update(xeroSettingsTable).set({ lastSyncAt: new Date() }).where(and(eq(xeroSettingsTable.id, settings.id), eq(xeroSettingsTable.companyId, tenantId)));

  return res.json({
    salesInvoices: salesInvoices.length,
    weeklyBills: weeklyInvoices.length,
    syncedSalesInvoices,
    syncedWeeklyBills,
    failed: errors.length,
    errors: errors.slice(0, 10),
  });
});

export default router;

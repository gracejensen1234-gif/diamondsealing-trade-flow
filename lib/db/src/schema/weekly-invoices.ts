import {
  pgTable,
  serial,
  integer,
  text,
  numeric,
  jsonb,
  timestamp,
  boolean,
} from "drizzle-orm/pg-core";
import { companyAccountsTable } from "./company-accounts";
import { subcontractorsTable } from "./subcontractors";

export const weeklyInvoicesTable = pgTable("weekly_invoices", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companyAccountsTable.id),
  subcontractorId: integer("subcontractor_id")
    .notNull()
    .references(() => subcontractorsTable.id),
  weekStartDate: text("week_start_date").notNull(),
  weekEndDate: text("week_end_date").notNull(),
  status: text("status").notNull().default("draft"),
  lineItems: jsonb("line_items").notNull().default([]),
  totalMetres: numeric("total_metres", { precision: 10, scale: 2 })
    .notNull()
    .default("0"),
  gstRegistered: boolean("gst_registered").notNull().default(false),
  subtotal: numeric("subtotal", { precision: 10, scale: 2 })
    .notNull()
    .default("0"),
  tax: numeric("tax", { precision: 10, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 10, scale: 2 }).notNull().default("0"),
  xeroInvoiceId: text("xero_invoice_id"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  notes: text("notes"),
  reviewStatus: text("review_status").notNull().default("none"),
  reviewReason: text("review_reason"),
  reviewAdjustmentAmount: numeric("review_adjustment_amount", {
    precision: 10,
    scale: 2,
  }),
  reviewRequestedAt: timestamp("review_requested_at", { withTimezone: true }),
  reviewRespondedAt: timestamp("review_responded_at", { withTimezone: true }),
  reviewResponseNotes: text("review_response_notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type WeeklyInvoice = typeof weeklyInvoicesTable.$inferSelect;

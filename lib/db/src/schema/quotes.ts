import { pgTable, serial, text, timestamp, integer, numeric, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companyAccountsTable } from "./company-accounts";
import { customersTable } from "./customers";
import { jobsTable } from "./jobs";

export const quoteStatusValues = ["draft", "sent", "accepted", "declined", "expired"] as const;

export const quotesTable = pgTable("quotes", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companyAccountsTable.id),
  quoteNumber: text("quote_number").notNull(),
  status: text("status").notNull().default("draft"),
  customerId: integer("customer_id").references(() => customersTable.id),
  jobId: integer("job_id").references(() => jobsTable.id),
  title: text("title"),
  notes: text("notes"),
  lineItems: jsonb("line_items").notNull().default([]),
  subtotal: numeric("subtotal", { precision: 10, scale: 2 }).notNull().default("0"),
  taxRate: numeric("tax_rate", { precision: 5, scale: 2 }).notNull().default("10"),
  tax: numeric("tax", { precision: 10, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 10, scale: 2 }).notNull().default("0"),
  validUntil: text("valid_until"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertQuoteSchema = createInsertSchema(quotesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertQuote = z.infer<typeof insertQuoteSchema>;
export type Quote = typeof quotesTable.$inferSelect;

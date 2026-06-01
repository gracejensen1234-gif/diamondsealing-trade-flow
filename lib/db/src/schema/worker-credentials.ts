import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { companyAccountsTable } from "./company-accounts";
import { subcontractorsTable } from "./subcontractors";

export const workerCredentialsTable = pgTable("worker_credentials", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companyAccountsTable.id),
  subcontractorId: integer("subcontractor_id").notNull().references(() => subcontractorsTable.id),
  documentType: text("document_type").notNull(),
  label: text("label").notNull(),
  imageData: text("image_data").notNull(),
  fileName: text("file_name"),
  expiryDate: text("expiry_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WorkerCredential = typeof workerCredentialsTable.$inferSelect;
export type InsertWorkerCredential = typeof workerCredentialsTable.$inferInsert;

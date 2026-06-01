import { pgTable, serial, integer, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { companyAccountsTable } from "./company-accounts";
import { jobsTable } from "./jobs";
import { subcontractorsTable } from "./subcontractors";

export const jobAssignmentsTable = pgTable("job_assignments", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companyAccountsTable.id),
  dispatchDate: text("dispatch_date").notNull(),
  scheduledOrder: integer("scheduled_order").notNull().default(1),
  jobId: integer("job_id").references(() => jobsTable.id),
  subcontractorId: integer("subcontractor_id").references(() => subcontractorsTable.id),
  builderContactName: text("builder_contact_name"),
  builderContactPhone: text("builder_contact_phone"),
  requiredColours: jsonb("required_colours").notNull().default([]),
  notes: text("notes"),
  status: text("status").notNull().default("pending"),
  arrivedAt: timestamp("arrived_at", { withTimezone: true }),
  departedAt: timestamp("departed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type JobAssignment = typeof jobAssignmentsTable.$inferSelect;

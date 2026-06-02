import { pgTable, serial, integer, text, numeric, jsonb, timestamp } from "drizzle-orm/pg-core";
import { companyAccountsTable } from "./company-accounts";
import { jobsTable } from "./jobs";
import { subcontractorsTable } from "./subcontractors";
import { jobAssignmentsTable } from "./job-assignments";

export const jobReportsTable = pgTable("job_reports", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companyAccountsTable.id),
  jobId: integer("job_id").notNull().references(() => jobsTable.id),
  jobAssignmentId: integer("job_assignment_id").references(() => jobAssignmentsTable.id),
  subcontractorId: integer("subcontractor_id").notNull().references(() => subcontractorsTable.id),
  dispatchDate: text("dispatch_date"),
  metersCompleted: numeric("meters_completed", { precision: 8, scale: 2 }).notNull().default("0"),
  hoursWorked: numeric("hours_worked", { precision: 8, scale: 2 }),
  photos: jsonb("photos").notNull().default([]),
  silikoneColoursUsed: jsonb("silikone_colours_used").notNull().default([]),
  stockUsed: jsonb("stock_used").notNull().default([]),
  issueType: text("issue_type").notNull().default("none"),
  issueDescription: text("issue_description"),
  workDescription: text("work_description"),
  generalNotes: text("general_notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type JobReport = typeof jobReportsTable.$inferSelect;

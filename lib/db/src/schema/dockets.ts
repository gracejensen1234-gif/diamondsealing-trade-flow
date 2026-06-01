import { pgTable, serial, integer, text, jsonb, timestamp, boolean } from "drizzle-orm/pg-core";
import { companyAccountsTable } from "./company-accounts";
import { jobAssignmentsTable } from "./job-assignments";
import { subcontractorsTable } from "./subcontractors";

export const docketsTable = pgTable("dockets", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companyAccountsTable.id),
  jobAssignmentId: integer("job_assignment_id").references(() => jobAssignmentsTable.id),
  subcontractorId: integer("subcontractor_id").notNull().references(() => subcontractorsTable.id),
  docketNumber: text("docket_number").notNull(),
  jobTitle: text("job_title"),
  jobAddress: text("job_address"),
  builderName: text("builder_name"),
  builderSignature: text("builder_signature"),
  subcontractorSignature: text("subcontractor_signature"),
  photosBefore: jsonb("photos_before").$type<string[]>().default([]),
  photosAfter: jsonb("photos_after").$type<string[]>().default([]),
  workDescription: text("work_description"),
  metresCompleted: text("metres_completed"),
  coloursUsed: jsonb("colours_used").$type<string[]>().default([]),
  builderSigned: boolean("builder_signed").notNull().default(false),
  subcontractorSigned: boolean("subcontractor_signed").notNull().default(false),
  notes: text("notes"),
  status: text("status", { enum: ["draft", "sub_signed", "builder_signed", "complete"] }).notNull().default("draft"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
});

export type Docket = typeof docketsTable.$inferSelect;
export type InsertDocket = typeof docketsTable.$inferInsert;

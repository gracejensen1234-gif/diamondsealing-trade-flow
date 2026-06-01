import { pgTable, serial, integer, numeric, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { companyAccountsTable } from "./company-accounts";
import { subcontractorsTable } from "./subcontractors";

export const productivitySnapshotsTable = pgTable("productivity_snapshots", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companyAccountsTable.id),
  subcontractorId: integer("subcontractor_id").notNull().references(() => subcontractorsTable.id),
  date: text("date").notNull(),
  totalMetres: numeric("total_metres", { precision: 10, scale: 2 }).notNull().default("0"),
  totalWorkMinutes: integer("total_work_minutes").notNull().default(0),
  metresPerHour: numeric("metres_per_hour", { precision: 10, scale: 4 }),
  jobsCompleted: integer("jobs_completed").notNull().default(0),
  clockOnTime: text("clock_on_time"),
  clockOffTime: text("clock_off_time"),
  breakMinutes: integer("break_minutes").notNull().default(0),
  lateArrivalMinutes: integer("late_arrival_minutes").notNull().default(0),
  earlyDepartureMinutes: integer("early_departure_minutes").notNull().default(0),
  calculatedAt: timestamp("calculated_at").notNull().defaultNow(),
});

export type ProductivitySnapshot = typeof productivitySnapshotsTable.$inferSelect;

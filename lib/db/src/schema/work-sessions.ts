import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { subcontractorsTable } from "./subcontractors";

export const workSessionsTable = pgTable("work_sessions", {
  id: serial("id").primaryKey(),
  subcontractorId: integer("subcontractor_id").notNull().references(() => subcontractorsTable.id),
  date: text("date").notNull(),
  status: text("status").notNull().default("active"),
  gpsEnabled: boolean("gps_enabled").notNull().default(true),
  gpsDisabledOnBreak: boolean("gps_disabled_on_break").notNull().default(true),
  clockedOnAt: timestamp("clocked_on_at", { withTimezone: true }),
  clockedOffAt: timestamp("clocked_off_at", { withTimezone: true }),
  breakStartAt: timestamp("break_start_at", { withTimezone: true }),
  breakEndAt: timestamp("break_end_at", { withTimezone: true }),
  totalBreakMinutes: integer("total_break_minutes").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WorkSession = typeof workSessionsTable.$inferSelect;

import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { companyAccountsTable } from "./company-accounts";
import { subcontractorsTable } from "./subcontractors";
import { appUsersTable } from "./app-users";

export const leaveRequestsTable = pgTable("leave_requests", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companyAccountsTable.id),
  subcontractorId: integer("subcontractor_id").notNull().references(() => subcontractorsTable.id),
  dayOffDate: text("day_off_date").notNull(),
  reason: text("reason"),
  status: text("status", { enum: ["pending", "approved", "declined", "cancelled"] }).notNull().default("pending"),
  adminNote: text("admin_note"),
  decidedByUserId: integer("decided_by_user_id").references(() => appUsersTable.id),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type LeaveRequest = typeof leaveRequestsTable.$inferSelect;
export type InsertLeaveRequest = typeof leaveRequestsTable.$inferInsert;

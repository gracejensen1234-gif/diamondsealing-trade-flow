import { pgTable, serial, integer, text, numeric, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";
import { subcontractorsTable } from "./subcontractors";

export const allocationRecommendationsTable = pgTable("allocation_recommendations", {
  id: serial("id").primaryKey(),
  jobAssignmentId: integer("job_assignment_id"),
  jobId: integer("job_id").notNull(),
  requestedDate: text("requested_date").notNull(),
  requestedById: text("requested_by").default("admin"),
  recommendations: jsonb("recommendations").notNull().default("[]"),
  selectedSubcontractorId: integer("selected_subcontractor_id"),
  selectionMethod: text("selection_method", { enum: ["auto", "manual_override"] }).default("auto"),
  overrideReason: text("override_reason"),
  warnings: jsonb("warnings").default("[]"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const weeklyPlannerProposalsTable = pgTable("weekly_planner_proposals", {
  id: serial("id").primaryKey(),
  weekStart: text("week_start").notNull(),
  status: text("status", { enum: ["draft", "pending_approval", "approved", "rejected"] }).default("draft"),
  proposedSchedule: jsonb("proposed_schedule").notNull().default("[]"),
  supplierOrders: jsonb("supplier_orders").default("[]"),
  optimisationSummary: jsonb("optimisation_summary").default("{}"),
  adminNotes: text("admin_notes"),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AllocationRecommendation = typeof allocationRecommendationsTable.$inferSelect;
export type WeeklyPlannerProposal = typeof weeklyPlannerProposalsTable.$inferSelect;

import { pgTable, serial, integer, text, numeric, jsonb, boolean, timestamp } from "drizzle-orm/pg-core";
import { subcontractorsTable } from "./subcontractors";
import { jobReportsTable } from "./job-reports";
import { jobAssignmentsTable } from "./job-assignments";

export const auditFlagsTable = pgTable("audit_flags", {
  id: serial("id").primaryKey(),
  subcontractorId: integer("subcontractor_id").notNull().references(() => subcontractorsTable.id),
  jobReportId: integer("job_report_id").references(() => jobReportsTable.id),
  jobAssignmentId: integer("job_assignment_id").references(() => jobAssignmentsTable.id),
  flagType: text("flag_type", {
    enum: [
      "missing_photos",
      "low_photo_count",
      "wrong_colour",
      "unusual_stock_ratio",
      "excessive_break",
      "early_departure",
      "late_arrival",
      "missing_stock_usage",
      "low_metres_vs_time",
      "repeat_callback",
      "incomplete_documentation",
      "safety_concern",
      "missing_builder_contact",
      "photo_quality_concern",
      "inconsistent_data",
      "possible_false_reporting",
      "other",
    ],
  }).notNull(),
  severity: text("severity", { enum: ["info", "warning", "critical"] }).notNull().default("warning"),
  title: text("title").notNull(),
  description: text("description").notNull(),
  evidence: jsonb("evidence").$type<Record<string, unknown>>().default({}),
  auditScore: numeric("audit_score", { precision: 5, scale: 2 }),
  status: text("status", { enum: ["pending", "reviewed", "approved", "dismissed", "fix_requested", "callback_created"] }).notNull().default("pending"),
  adminNotes: text("admin_notes"),
  workerFeedback: text("worker_feedback"),
  showToWorker: boolean("show_to_worker").notNull().default(false),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const auditScoresTable = pgTable("audit_scores", {
  id: serial("id").primaryKey(),
  subcontractorId: integer("subcontractor_id").notNull().references(() => subcontractorsTable.id),
  periodType: text("period_type", { enum: ["daily", "weekly", "monthly"] }).notNull(),
  periodStart: text("period_start").notNull(),
  overallScore: numeric("overall_score", { precision: 5, scale: 2 }).notNull().default("100"),
  photoComplianceScore: numeric("photo_compliance_score", { precision: 5, scale: 2 }),
  punctualityScore: numeric("punctuality_score", { precision: 5, scale: 2 }),
  productivityScore: numeric("productivity_score", { precision: 5, scale: 2 }),
  documentationScore: numeric("documentation_score", { precision: 5, scale: 2 }),
  stockAccuracyScore: numeric("stock_accuracy_score", { precision: 5, scale: 2 }),
  safetyScore: numeric("safety_score", { precision: 5, scale: 2 }),
  callbackRate: numeric("callback_rate", { precision: 5, scale: 2 }),
  flagCount: integer("flag_count").notNull().default(0),
  criticalFlagCount: integer("critical_flag_count").notNull().default(0),
  adminOverride: boolean("admin_override").notNull().default(false),
  adminOverrideScore: numeric("admin_override_score", { precision: 5, scale: 2 }),
  adminNotes: text("admin_notes"),
  calculatedAt: timestamp("calculated_at").notNull().defaultNow(),
});

export type AuditFlag = typeof auditFlagsTable.$inferSelect;
export type AuditScore = typeof auditScoresTable.$inferSelect;

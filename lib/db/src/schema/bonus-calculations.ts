import { pgTable, serial, integer, numeric, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { subcontractorsTable } from "./subcontractors";
import { bonusRulesTable } from "./bonus-rules";

export const bonusCalculationsTable = pgTable("bonus_calculations", {
  id: serial("id").primaryKey(),
  subcontractorId: integer("subcontractor_id").notNull().references(() => subcontractorsTable.id),
  weekStart: text("week_start").notNull(),
  totalMetres: numeric("total_metres", { precision: 10, scale: 2 }).notNull().default("0"),
  totalWorkMinutes: integer("total_work_minutes").notNull().default(0),
  avgMetresPerHour: numeric("avg_metres_per_hour", { precision: 10, scale: 2 }),
  avgMetresPerDay: numeric("avg_metres_per_day", { precision: 10, scale: 2 }),
  auditScore: numeric("audit_score", { precision: 5, scale: 2 }),
  bonusRuleId: integer("bonus_rule_id").references(() => bonusRulesTable.id),
  bonusAmount: numeric("bonus_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  bonusEarned: boolean("bonus_earned").notNull().default(false),
  status: text("status", { enum: ["pending", "approved", "paid", "rejected"] }).notNull().default("pending"),
  adminNotes: text("admin_notes"),
  calculatedAt: timestamp("calculated_at").notNull().defaultNow(),
  approvedAt: timestamp("approved_at"),
});

export type BonusCalculation = typeof bonusCalculationsTable.$inferSelect;
export type InsertBonusCalculation = typeof bonusCalculationsTable.$inferInsert;

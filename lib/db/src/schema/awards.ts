import { pgTable, serial, integer, text, numeric, jsonb, boolean, timestamp } from "drizzle-orm/pg-core";
import { subcontractorsTable } from "./subcontractors";

export const monthlyRankingsTable = pgTable("monthly_rankings", {
  id: serial("id").primaryKey(),
  subcontractorId: integer("subcontractor_id").notNull().references(() => subcontractorsTable.id),
  month: text("month").notNull(),
  rank: integer("rank"),
  totalScore: numeric("total_score", { precision: 8, scale: 4 }).notNull().default("0"),
  metresScore: numeric("metres_score", { precision: 8, scale: 4 }).default("0"),
  metresPerHourScore: numeric("metres_per_hour_score", { precision: 8, scale: 4 }).default("0"),
  auditScore: numeric("audit_score", { precision: 8, scale: 4 }).default("0"),
  punctualityScore: numeric("punctuality_score", { precision: 8, scale: 4 }).default("0"),
  photoComplianceScore: numeric("photo_compliance_score", { precision: 8, scale: 4 }).default("0"),
  callbackScore: numeric("callback_score", { precision: 8, scale: 4 }).default("0"),
  attendanceScore: numeric("attendance_score", { precision: 8, scale: 4 }).default("0"),
  totalMetres: numeric("total_metres", { precision: 10, scale: 2 }).default("0"),
  avgMetresPerHour: numeric("avg_metres_per_hour", { precision: 8, scale: 4 }).default("0"),
  daysWorked: integer("days_worked").default(0),
  jobsCompleted: integer("jobs_completed").default(0),
  callbackCount: integer("callback_count").default(0),
  lateArrivals: integer("late_arrivals").default(0),
  missingPhotoJobs: integer("missing_photo_jobs").default(0),
  auditFlagCount: integer("audit_flag_count").default(0),
  calculatedAt: timestamp("calculated_at").notNull().defaultNow(),
});

export const scoringWeightsTable = pgTable("scoring_weights", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().default("default"),
  metresWeight: numeric("metres_weight", { precision: 5, scale: 2 }).notNull().default("25"),
  metresPerHourWeight: numeric("metres_per_hour_weight", { precision: 5, scale: 2 }).notNull().default("20"),
  auditWeight: numeric("audit_weight", { precision: 5, scale: 2 }).notNull().default("20"),
  punctualityWeight: numeric("punctuality_weight", { precision: 5, scale: 2 }).notNull().default("15"),
  photoComplianceWeight: numeric("photo_compliance_weight", { precision: 5, scale: 2 }).notNull().default("10"),
  callbackWeight: numeric("callback_weight", { precision: 5, scale: 2 }).notNull().default("5"),
  attendanceWeight: numeric("attendance_weight", { precision: 5, scale: 2 }).notNull().default("5"),
  active: boolean("active").notNull().default(true),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const monthlyAwardsTable = pgTable("monthly_awards", {
  id: serial("id").primaryKey(),
  month: text("month").notNull(),
  winnerId: integer("winner_id").notNull().references(() => subcontractorsTable.id),
  awardType: text("award_type", {
    enum: ["weekend_away", "tv", "experience", "voucher", "cash", "custom"],
  }).notNull(),
  awardTitle: text("award_title").notNull(),
  awardDescription: text("award_description"),
  awardValue: numeric("award_value", { precision: 10, scale: 2 }),
  winnerPhoto: text("winner_photo"),
  reasonText: text("reason_text").notNull(),
  totalScore: numeric("total_score", { precision: 8, scale: 4 }),
  adminApproved: boolean("admin_approved").notNull().default(false),
  publishedToStaff: boolean("published_to_staff").notNull().default(false),
  publishedAt: timestamp("published_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type MonthlyRanking = typeof monthlyRankingsTable.$inferSelect;
export type ScoringWeight = typeof scoringWeightsTable.$inferSelect;
export type MonthlyAward = typeof monthlyAwardsTable.$inferSelect;

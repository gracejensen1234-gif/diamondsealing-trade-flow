import { pgTable, serial, integer, text, numeric, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";
import { companyAccountsTable } from "./company-accounts";
import { subcontractorsTable } from "./subcontractors";

export const workerSkillsTable = pgTable("worker_skills", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companyAccountsTable.id),
  subcontractorId: integer("subcontractor_id").notNull().references(() => subcontractorsTable.id),
  // Product skills
  canSilicone: boolean("can_silicone").notNull().default(false),
  canSikaflex: boolean("can_sikaflex").notNull().default(false),
  canFireRated: boolean("can_fire_rated").notNull().default(false),
  canWaterproofing: boolean("can_waterproofing").notNull().default(false),
  canBackerRod: boolean("can_backer_rod").notNull().default(false),
  canPrimer: boolean("can_primer").notNull().default(false),
  canJointPrep: boolean("can_joint_prep").notNull().default(false),
  canGrindingCutting: boolean("can_grinding_cutting").notNull().default(false),
  // Job type skills
  canResidential: boolean("can_residential").notNull().default(true),
  canCommercial: boolean("can_commercial").notNull().default(false),
  canPools: boolean("can_pools").notNull().default(false),
  canCarParks: boolean("can_car_parks").notNull().default(false),
  customSkills: jsonb("custom_skills").default("[]"),
  // Experience
  experienceLevel: text("experience_level", { enum: ["junior", "intermediate", "senior", "specialist"] }).default("intermediate"),
  yearsExperience: integer("years_experience").default(0),
  // Performance scores (updated periodically)
  qualityScore: numeric("quality_score", { precision: 5, scale: 2 }).default("100"),
  builderRatingAvg: numeric("builder_rating_avg", { precision: 5, scale: 2 }),
  callbackRate: numeric("callback_rate", { precision: 5, scale: 2 }).default("0"),
  punctualityScore: numeric("punctuality_score", { precision: 5, scale: 2 }).default("100"),
  attendanceScore: numeric("attendance_score", { precision: 5, scale: 2 }).default("100"),
  photoComplianceScore: numeric("photo_compliance_score", { precision: 5, scale: 2 }).default("100"),
  safetyScore: numeric("safety_score", { precision: 5, scale: 2 }).default("100"),
  notes: text("notes"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type WorkerSkills = typeof workerSkillsTable.$inferSelect;
export type InsertWorkerSkills = typeof workerSkillsTable.$inferInsert;

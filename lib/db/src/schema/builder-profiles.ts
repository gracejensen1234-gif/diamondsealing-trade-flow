import { pgTable, serial, integer, text, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";
import { companyAccountsTable } from "./company-accounts";

export const builderProfilesTable = pgTable("builder_profiles", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companyAccountsTable.id),
  // Link to existing customer or standalone
  customerId: integer("customer_id"),
  name: text("name").notNull(),
  contactName: text("contact_name"),
  contactPhone: text("contact_phone"),
  contactEmail: text("contact_email"),
  // Quality tier
  qualityTier: text("quality_tier", {
    enum: ["premium", "high_end", "standard", "production", "budget", "custom"],
  }).notNull().default("standard"),
  customTierLabel: text("custom_tier_label"),
  // Preferences
  preferredWorkerIds: jsonb("preferred_worker_ids").default("[]"),
  avoidedWorkerIds: jsonb("avoided_worker_ids").default("[]"),
  finishExpectations: text("finish_expectations"),
  documentationRequirements: text("documentation_requirements"),
  signOffRequired: boolean("sign_off_required").notNull().default(false),
  signOffNotes: text("sign_off_notes"),
  // Site info
  siteNotes: text("site_notes"),
  specialInstructions: text("special_instructions"),
  // Ratings
  averageRatingGiven: integer("average_rating_given"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const builderRatingsTable = pgTable("builder_ratings", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companyAccountsTable.id),
  builderProfileId: integer("builder_profile_id").notNull().references(() => builderProfilesTable.id),
  subcontractorId: integer("subcontractor_id").notNull(),
  jobAssignmentId: integer("job_assignment_id"),
  rating: integer("rating").notNull(), // 1-5
  qualityComment: text("quality_comment"),
  punctualityComment: text("punctuality_comment"),
  professionalismComment: text("professionalism_comment"),
  wouldRequestAgain: boolean("would_request_again"),
  internalNotes: text("internal_notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type BuilderProfile = typeof builderProfilesTable.$inferSelect;
export type BuilderRating = typeof builderRatingsTable.$inferSelect;

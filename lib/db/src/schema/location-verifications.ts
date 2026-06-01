import { pgTable, serial, integer, numeric, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { companyAccountsTable } from "./company-accounts";
import { subcontractorsTable } from "./subcontractors";
import { workSessionsTable } from "./work-sessions";
import { jobAssignmentsTable } from "./job-assignments";

export const locationVerificationsTable = pgTable("location_verifications", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companyAccountsTable.id),
  subcontractorId: integer("subcontractor_id").notNull().references(() => subcontractorsTable.id),
  workSessionId: integer("work_session_id").references(() => workSessionsTable.id),
  jobAssignmentId: integer("job_assignment_id").references(() => jobAssignmentsTable.id),
  eventType: text("event_type", {
    enum: ["clock_on", "clock_off", "job_arrived", "job_departed"],
  }).notNull(),
  // Worker's reported coordinates (from browser Geolocation API)
  reportedLat: numeric("reported_lat", { precision: 10, scale: 7 }),
  reportedLng: numeric("reported_lng", { precision: 10, scale: 7 }),
  reportedAccuracyMetres: numeric("reported_accuracy_metres", { precision: 8, scale: 2 }),
  // Job's resolved coordinates (geocoded from job address, cached)
  jobAddress: text("job_address"),
  jobAddressLat: numeric("job_address_lat", { precision: 10, scale: 7 }),
  jobAddressLng: numeric("job_address_lng", { precision: 10, scale: 7 }),
  // Verification result
  distanceMetres: numeric("distance_metres", { precision: 8, scale: 1 }),
  allowedDistanceMetres: integer("allowed_distance_metres").notNull().default(500),
  withinBounds: boolean("within_bounds"),
  // Status
  status: text("status", {
    enum: [
      "verified",        // within allowed distance
      "outside_range",   // location obtained but too far away
      "skipped",         // worker chose to skip
      "location_error",  // browser geolocation failed
      "no_job_address",  // no job address to check against (clock-on/off)
      "geocode_failed",  // job has address but geocoding failed
      "captured",        // location recorded, no distance reference
    ],
  }).notNull(),
  workerConsented: boolean("worker_consented").notNull().default(false),
  adminReviewed: boolean("admin_reviewed").notNull().default(false),
  adminNotes: text("admin_notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type LocationVerification = typeof locationVerificationsTable.$inferSelect;

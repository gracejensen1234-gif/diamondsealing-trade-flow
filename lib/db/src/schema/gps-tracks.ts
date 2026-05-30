import { pgTable, serial, integer, numeric, timestamp } from "drizzle-orm/pg-core";
import { subcontractorsTable } from "./subcontractors";
import { workSessionsTable } from "./work-sessions";

export const gpsTracksTable = pgTable("gps_tracks", {
  id: serial("id").primaryKey(),
  subcontractorId: integer("subcontractor_id").notNull().references(() => subcontractorsTable.id),
  workSessionId: integer("work_session_id").references(() => workSessionsTable.id),
  latitude: numeric("latitude", { precision: 10, scale: 7 }).notNull(),
  longitude: numeric("longitude", { precision: 10, scale: 7 }).notNull(),
  accuracy: numeric("accuracy", { precision: 8, scale: 2 }),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
});

export type GpsTrack = typeof gpsTracksTable.$inferSelect;

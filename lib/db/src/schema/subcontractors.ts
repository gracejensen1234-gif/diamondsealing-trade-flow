import {
  pgTable,
  serial,
  text,
  boolean,
  numeric,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";
import { integer } from "drizzle-orm/pg-core";
import { companyAccountsTable } from "./company-accounts";

export const subcontractorsTable = pgTable("subcontractors", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companyAccountsTable.id),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  vehiclePlate: text("vehicle_plate"),
  abn: text("abn"),
  ratePerMetre: numeric("rate_per_metre", { precision: 8, scale: 2 }),
  hourlyRate: numeric("hourly_rate", { precision: 8, scale: 2 }),
  gstRegistered: boolean("gst_registered").notNull().default(false),
  employmentType: text("employment_type", {
    enum: ["full_time", "part_time", "casual"],
  })
    .notNull()
    .default("casual"),
  availableDays: jsonb("available_days"),
  scheduleNotes: text("schedule_notes"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Subcontractor = typeof subcontractorsTable.$inferSelect;

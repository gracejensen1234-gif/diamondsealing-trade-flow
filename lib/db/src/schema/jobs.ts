import { pgTable, serial, text, timestamp, integer, jsonb, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { customersTable } from "./customers";

export const jobStatusValues = ["pending", "in_progress", "completed", "invoiced", "cancelled"] as const;
export const jobPriorityValues = ["low", "medium", "high"] as const;

export const jobsTable = pgTable("jobs", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("pending"),
  priority: text("priority").notNull().default("medium"),
  customerId: integer("customer_id").references(() => customersTable.id),
  address: text("address"),
  builderContactName: text("builder_contact_name"),
  builderContactPhone: text("builder_contact_phone"),
  requiredColours: jsonb("required_colours").notNull().default([]),
  addressLat: numeric("address_lat", { precision: 10, scale: 7 }),
  addressLng: numeric("address_lng", { precision: 10, scale: 7 }),
  scheduledDate: text("scheduled_date"),
  completedDate: text("completed_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertJobSchema = createInsertSchema(jobsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertJob = z.infer<typeof insertJobSchema>;
export type Job = typeof jobsTable.$inferSelect;

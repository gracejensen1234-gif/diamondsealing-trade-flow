import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { subcontractorsTable } from "./subcontractors";

export const notificationsTable = pgTable("notifications", {
  id: serial("id").primaryKey(),
  subcontractorId: integer("subcontractor_id").notNull().references(() => subcontractorsTable.id),
  type: text("type", {
    enum: [
      "new_job",
      "job_changed",
      "forgotten_action",
      "missing_photos",
      "missing_metres",
      "missing_stock",
      "stock_pickup_ready",
      "upcoming_job",
      "clock_on_reminder",
      "break_reminder",
      "weekly_performance",
      "bonus_update",
      "safety_reminder",
      "audit_fix_request",
      "general",
    ],
  }).notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  priority: text("priority", { enum: ["urgent", "high", "normal", "low"] }).notNull().default("normal"),
  isRead: boolean("is_read").notNull().default(false),
  actionUrl: text("action_url"),
  linkedEntityType: text("linked_entity_type"),
  linkedEntityId: integer("linked_entity_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  readAt: timestamp("read_at"),
});

export const pushSubscriptionsTable = pgTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  subcontractorId: integer("subcontractor_id").notNull().references(() => subcontractorsTable.id),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const vapidConfigTable = pgTable("vapid_config", {
  id: serial("id").primaryKey(),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  subject: text("subject").notNull().default("mailto:admin@diamondsealing.com.au"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Notification = typeof notificationsTable.$inferSelect;
export type PushSubscription = typeof pushSubscriptionsTable.$inferSelect;
export type VapidConfig = typeof vapidConfigTable.$inferSelect;

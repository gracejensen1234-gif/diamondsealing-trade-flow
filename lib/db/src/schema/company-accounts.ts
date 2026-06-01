import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const companyAccountsTable = pgTable("company_accounts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  status: text("status", { enum: ["trial", "active", "paused", "cancelled"] }).notNull().default("trial"),
  subscriptionPlan: text("subscription_plan").notNull().default("trial"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CompanyAccount = typeof companyAccountsTable.$inferSelect;

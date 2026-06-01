import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { companyAccountsTable } from "./company-accounts";
import { subcontractorsTable } from "./subcontractors";

export const appUsersTable = pgTable("app_users", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companyAccountsTable.id),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: text("role", { enum: ["admin", "worker"] }).notNull(),
  subcontractorId: integer("subcontractor_id").references(() => subcontractorsTable.id),
  passwordHash: text("password_hash").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AppUser = typeof appUsersTable.$inferSelect;

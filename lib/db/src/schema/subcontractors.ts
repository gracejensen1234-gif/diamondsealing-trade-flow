import { pgTable, serial, text, boolean, numeric, timestamp } from "drizzle-orm/pg-core";
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
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Subcontractor = typeof subcontractorsTable.$inferSelect;

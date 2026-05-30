import { pgTable, serial, text, boolean, numeric, timestamp } from "drizzle-orm/pg-core";

export const subcontractorsTable = pgTable("subcontractors", {
  id: serial("id").primaryKey(),
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

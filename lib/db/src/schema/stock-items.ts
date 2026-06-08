import { pgTable, serial, text, numeric, timestamp } from "drizzle-orm/pg-core";
import { integer } from "drizzle-orm/pg-core";
import { companyAccountsTable } from "./company-accounts";

export const stockItemsTable = pgTable("stock_items", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companyAccountsTable.id),
  name: text("name").notNull(),
  unit: text("unit").notNull().default("tube"),
  colour: text("colour"),
  barcode: text("barcode"),
  currentStock: numeric("current_stock", { precision: 8, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type StockItem = typeof stockItemsTable.$inferSelect;

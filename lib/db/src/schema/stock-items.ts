import { pgTable, serial, text, numeric, timestamp } from "drizzle-orm/pg-core";

export const stockItemsTable = pgTable("stock_items", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  unit: text("unit").notNull().default("tube"),
  colour: text("colour"),
  currentStock: numeric("current_stock", { precision: 8, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type StockItem = typeof stockItemsTable.$inferSelect;

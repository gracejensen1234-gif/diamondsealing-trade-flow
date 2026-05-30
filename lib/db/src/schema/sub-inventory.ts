import { pgTable, serial, integer, numeric, text, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { subcontractorsTable } from "./subcontractors";
import { stockItemsTable } from "./stock-items";
import { jobAssignmentsTable } from "./job-assignments";

export const subInventoryTable = pgTable("sub_inventory", {
  id: serial("id").primaryKey(),
  subcontractorId: integer("subcontractor_id").notNull().references(() => subcontractorsTable.id),
  stockItemId: integer("stock_item_id").notNull().references(() => stockItemsTable.id),
  currentQuantity: numeric("current_quantity", { precision: 10, scale: 2 }).notNull().default("0"),
  lastIssuedAt: timestamp("last_issued_at"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const inventoryTransactionsTable = pgTable("inventory_transactions", {
  id: serial("id").primaryKey(),
  subcontractorId: integer("subcontractor_id").notNull().references(() => subcontractorsTable.id),
  stockItemId: integer("stock_item_id").notNull().references(() => stockItemsTable.id),
  transactionType: text("transaction_type", {
    enum: ["issued", "used_on_job", "returned", "adjustment", "restock"],
  }).notNull(),
  quantity: numeric("quantity", { precision: 10, scale: 2 }).notNull(),
  jobAssignmentId: integer("job_assignment_id").references(() => jobAssignmentsTable.id),
  referenceNote: text("reference_note"),
  recordedBy: text("recorded_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const restockRequestsTable = pgTable("restock_requests", {
  id: serial("id").primaryKey(),
  subcontractorId: integer("subcontractor_id").notNull().references(() => subcontractorsTable.id),
  stockItemId: integer("stock_item_id").notNull().references(() => stockItemsTable.id),
  quantityRequested: numeric("quantity_requested", { precision: 10, scale: 2 }).notNull(),
  quantityFulfilled: numeric("quantity_fulfilled", { precision: 10, scale: 2 }),
  status: text("status", { enum: ["pending", "approved", "fulfilled", "rejected"] }).notNull().default("pending"),
  subNotes: text("sub_notes"),
  adminNotes: text("admin_notes"),
  urgency: text("urgency", { enum: ["low", "normal", "high"] }).notNull().default("normal"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type SubInventory = typeof subInventoryTable.$inferSelect;
export type InventoryTransaction = typeof inventoryTransactionsTable.$inferSelect;
export type RestockRequest = typeof restockRequestsTable.$inferSelect;

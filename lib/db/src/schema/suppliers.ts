import { pgTable, serial, integer, text, numeric, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";

export const supplierProfilesTable = pgTable("supplier_profiles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  contactName: text("contact_name"),
  contactPhone: text("contact_phone"),
  contactEmail: text("contact_email"),
  address: text("address"),
  suburb: text("suburb"),
  preferredProducts: jsonb("preferred_products").default("[]"),
  preferredColours: jsonb("preferred_colours").default("[]"),
  notes: text("notes"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const supplierOrdersTable = pgTable("supplier_orders", {
  id: serial("id").primaryKey(),
  supplierId: integer("supplier_id").notNull().references(() => supplierProfilesTable.id),
  subcontractorId: integer("subcontractor_id").notNull(),
  orderNumber: text("order_number").notNull(),
  status: text("status", {
    enum: ["draft", "pending_approval", "approved", "sent_to_supplier", "ready_for_pickup", "picked_up", "cancelled"],
  }).notNull().default("draft"),
  urgency: text("urgency", { enum: ["low", "normal", "high", "urgent"] }).default("normal"),
  requiredByDate: text("required_by_date"),
  pickupDate: text("pickup_date"),
  pickupConfirmedAt: timestamp("pickup_confirmed_at"),
  totalCost: numeric("total_cost", { precision: 10, scale: 2 }),
  triggerJobIds: jsonb("trigger_job_ids").default("[]"),
  adminNotes: text("admin_notes"),
  subNotes: text("sub_notes"),
  approvedAt: timestamp("approved_at"),
  sentToSupplierAt: timestamp("sent_to_supplier_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const supplierOrderItemsTable = pgTable("supplier_order_items", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => supplierOrdersTable.id),
  stockItemId: integer("stock_item_id"),
  productName: text("product_name").notNull(),
  colour: text("colour"),
  unit: text("unit").notNull().default("tube"),
  quantityOrdered: numeric("quantity_ordered", { precision: 10, scale: 2 }).notNull(),
  unitCost: numeric("unit_cost", { precision: 8, scale: 2 }),
  notes: text("notes"),
});

export const stockItemSupplierPrefsTable = pgTable("stock_item_supplier_prefs", {
  id: serial("id").primaryKey(),
  stockItemId: integer("stock_item_id").notNull(),
  supplierId: integer("supplier_id").notNull().references(() => supplierProfilesTable.id),
  isPreferred: boolean("is_preferred").notNull().default(true),
  unitCost: numeric("unit_cost", { precision: 8, scale: 2 }),
  leadTimeDays: integer("lead_time_days").default(1),
});

export type SupplierProfile = typeof supplierProfilesTable.$inferSelect;
export type SupplierOrder = typeof supplierOrdersTable.$inferSelect;
export type SupplierOrderItem = typeof supplierOrderItemsTable.$inferSelect;

import { pgTable, serial, text, numeric, boolean, timestamp } from "drizzle-orm/pg-core";

export const bonusRulesTable = pgTable("bonus_rules", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  targetMetresPerDay: numeric("target_metres_per_day", { precision: 10, scale: 2 }),
  targetMetresPerWeek: numeric("target_metres_per_week", { precision: 10, scale: 2 }),
  targetMetresPerHour: numeric("target_metres_per_hour", { precision: 10, scale: 2 }),
  bonusAmount: numeric("bonus_amount", { precision: 10, scale: 2 }).notNull(),
  bonusType: text("bonus_type", { enum: ["flat", "per_metre_over", "percentage"] }).notNull().default("flat"),
  minAuditScore: numeric("min_audit_score", { precision: 5, scale: 2 }),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type BonusRule = typeof bonusRulesTable.$inferSelect;
export type InsertBonusRule = typeof bonusRulesTable.$inferInsert;

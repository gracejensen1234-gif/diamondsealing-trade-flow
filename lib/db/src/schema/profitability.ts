import { pgTable, serial, integer, text, numeric, timestamp } from "drizzle-orm/pg-core";
import { companyAccountsTable } from "./company-accounts";
import { subcontractorsTable } from "./subcontractors";

export const profitabilityScoresTable = pgTable("profitability_scores", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companyAccountsTable.id),
  subcontractorId: integer("subcontractor_id").notNull().references(() => subcontractorsTable.id),
  periodType: text("period_type", { enum: ["weekly", "monthly"] }).notNull(),
  periodStart: text("period_start").notNull(),
  // Revenue
  revenueGenerated: numeric("revenue_generated", { precision: 12, scale: 2 }).default("0"),
  totalMetres: numeric("total_metres", { precision: 10, scale: 2 }).default("0"),
  // Costs
  labourCost: numeric("labour_cost", { precision: 12, scale: 2 }).default("0"),
  productCost: numeric("product_cost", { precision: 12, scale: 2 }).default("0"),
  callbackCost: numeric("callback_cost", { precision: 12, scale: 2 }).default("0"),
  totalCost: numeric("total_cost", { precision: 12, scale: 2 }).default("0"),
  // Profit
  grossProfit: numeric("gross_profit", { precision: 12, scale: 2 }).default("0"),
  marginPct: numeric("margin_pct", { precision: 6, scale: 2 }).default("0"),
  profitRank: integer("profit_rank"),
  // Breakdown
  jobsCompleted: integer("jobs_completed").default(0),
  callbackCount: integer("callback_count").default(0),
  productConsumedValue: numeric("product_consumed_value", { precision: 12, scale: 2 }).default("0"),
  calculatedAt: timestamp("calculated_at").notNull().defaultNow(),
});

export type ProfitabilityScore = typeof profitabilityScoresTable.$inferSelect;

import { Router } from "express";
import { db } from "@workspace/db";
import {
  profitabilityScoresTable,
  subcontractorsTable,
  workSessionsTable,
  jobReportsTable,
  subInventoryTable,
  stockItemsTable,
  inventoryTransactionsTable,
  auditFlagsTable,
  bonusCalculationsTable,
} from "@workspace/db";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { workSessionMinutes } from "../lib/date-utils.js";
import { companyId } from "../lib/auth.js";

const router = Router();

function n(v: unknown): number { return Number(v ?? 0); }

// POST /profitability/calculate
router.post("/profitability/calculate", async (req, res) => {
  const { periodType, periodStart, subcontractorId } = req.body;
  if (!periodType || !periodStart) return res.status(400).json({ error: "periodType and periodStart required" });
  const tenantId = companyId(req);

  let periodEnd = periodStart;
  if (periodType === "weekly") {
    const d = new Date(periodStart); d.setDate(d.getDate() + 6);
    periodEnd = d.toISOString().split("T")[0];
  } else if (periodType === "monthly") {
    const d = new Date(periodStart); d.setMonth(d.getMonth() + 1); d.setDate(d.getDate() - 1);
    periodEnd = d.toISOString().split("T")[0];
  }

  const subs = subcontractorId
    ? await db
        .select()
        .from(subcontractorsTable)
        .where(and(eq(subcontractorsTable.id, Number(subcontractorId)), eq(subcontractorsTable.companyId, tenantId)))
    : await db
        .select()
        .from(subcontractorsTable)
        .where(and(eq(subcontractorsTable.companyId, tenantId), eq(subcontractorsTable.active, true)));

  const results = await Promise.all(
    subs.map(async (sub) => {
      const sessions = await db.select().from(workSessionsTable).where(
        and(
          eq(workSessionsTable.companyId, tenantId),
          eq(workSessionsTable.subcontractorId, sub.id),
          gte(workSessionsTable.date, periodStart),
          lte(workSessionsTable.date, periodEnd),
        ),
      );
      const reports = await db.select().from(jobReportsTable).where(
        and(
          eq(jobReportsTable.companyId, tenantId),
          eq(jobReportsTable.subcontractorId, sub.id),
          gte(jobReportsTable.dispatchDate, periodStart),
          lte(jobReportsTable.dispatchDate, periodEnd),
        ),
      );
      const flags = await db.select().from(auditFlagsTable).where(
        and(
          eq(auditFlagsTable.companyId, tenantId),
          eq(auditFlagsTable.subcontractorId, sub.id),
          gte(auditFlagsTable.createdAt, new Date(periodStart)),
        ),
      );
      const invTxns = await db.select().from(inventoryTransactionsTable).where(
        and(
          eq(inventoryTransactionsTable.companyId, tenantId),
          eq(inventoryTransactionsTable.subcontractorId, sub.id),
          eq(inventoryTransactionsTable.transactionType, "used_on_job"),
          gte(inventoryTransactionsTable.createdAt, new Date(periodStart)),
          lte(inventoryTransactionsTable.createdAt, new Date(`${periodEnd}T23:59:59`)),
        ),
      );

      const totalMetres = reports.reduce((a, r) => a + n(r.metersCompleted), 0);
      const totalWorkMinutes = sessions.reduce((a, s) => a + workSessionMinutes(s), 0);
      const jobsCompleted = reports.length;
      const callbackCount = flags.filter((f) => f.flagType === "repeat_callback").length;

      // Revenue: rate_per_metre × total metres
      const ratePerMetre = n((sub as any).ratePerMetre ?? 25);
      const revenueGenerated = totalMetres * ratePerMetre;

      // Labour cost: hourly rate estimate × hours worked
      const hourlyRate = 35; // default $35/hr
      const labourCost = (totalWorkMinutes / 60) * hourlyRate;

      // Product cost: sum of stock used × estimated unit cost
      const stockItems = await db.select().from(stockItemsTable).where(eq(stockItemsTable.companyId, tenantId));
      const priceMap = new Map(stockItems.map((s) => [s.id, n((s as any).unitCost ?? 8)]));
      const productCost = invTxns.reduce((a, t) => a + n(t.quantity) * (priceMap.get(t.stockItemId) ?? 8), 0);

      // Callback cost estimate
      const callbackCost = callbackCount * 150; // $150/callback estimate

      const totalCost = labourCost + productCost + callbackCost;
      const grossProfit = revenueGenerated - totalCost;
      const marginPct = revenueGenerated > 0 ? (grossProfit / revenueGenerated) * 100 : 0;

      const values = {
        companyId: tenantId,
        subcontractorId: sub.id,
        periodType,
        periodStart,
        revenueGenerated: revenueGenerated.toString(),
        totalMetres: totalMetres.toString(),
        labourCost: labourCost.toString(),
        productCost: productCost.toString(),
        callbackCost: callbackCost.toString(),
        totalCost: totalCost.toString(),
        grossProfit: grossProfit.toString(),
        marginPct: marginPct.toString(),
        jobsCompleted,
        callbackCount,
        productConsumedValue: productCost.toString(),
        calculatedAt: new Date(),
      };

      const existing = await db.select().from(profitabilityScoresTable).where(
        and(
          eq(profitabilityScoresTable.companyId, tenantId),
          eq(profitabilityScoresTable.subcontractorId, sub.id),
          eq(profitabilityScoresTable.periodType, periodType),
          eq(profitabilityScoresTable.periodStart, periodStart),
        ),
      ).limit(1);

      const [row] = existing.length
        ? await db
            .update(profitabilityScoresTable)
            .set(values)
            .where(and(eq(profitabilityScoresTable.id, existing[0].id), eq(profitabilityScoresTable.companyId, tenantId)))
            .returning()
        : await db.insert(profitabilityScoresTable).values(values).returning();

      return { ...row, subcontractorName: sub.name, revenueGenerated: n(row.revenueGenerated), totalMetres: n(row.totalMetres), grossProfit: n(row.grossProfit), marginPct: n(row.marginPct) };
    }),
  );

  // Assign profit ranks
  const sorted = results.sort((a, b) => b.grossProfit - a.grossProfit);
  await Promise.all(sorted.map((r, i) =>
    db
      .update(profitabilityScoresTable)
      .set({ profitRank: i + 1 })
      .where(and(eq(profitabilityScoresTable.id, r.id), eq(profitabilityScoresTable.companyId, tenantId))),
  ));

  return res.json(sorted.map((r, i) => ({ ...r, profitRank: i + 1 })));
});

// GET /profitability
router.get("/profitability", async (req, res) => {
  const tenantId = companyId(req);
  const rows = await db
    .select()
    .from(profitabilityScoresTable)
    .where(eq(profitabilityScoresTable.companyId, tenantId))
    .orderBy(desc(profitabilityScoresTable.calculatedAt));
  const subs = await db.select().from(subcontractorsTable).where(eq(subcontractorsTable.companyId, tenantId));
  const subMap = new Map(subs.map((s) => [s.id, s.name]));

  let filtered = rows;
  if (req.query.subcontractorId) filtered = filtered.filter((r) => r.subcontractorId === Number(req.query.subcontractorId));
  if (req.query.periodType) filtered = filtered.filter((r) => r.periodType === req.query.periodType);
  if (req.query.periodStart) filtered = filtered.filter((r) => r.periodStart === req.query.periodStart);

  return res.json(filtered.map((r) => ({
    ...r,
    subcontractorName: subMap.get(r.subcontractorId) ?? "",
    revenueGenerated: n(r.revenueGenerated),
    totalMetres: n(r.totalMetres),
    labourCost: n(r.labourCost),
    productCost: n(r.productCost),
    callbackCost: n(r.callbackCost),
    totalCost: n(r.totalCost),
    grossProfit: n(r.grossProfit),
    marginPct: n(r.marginPct),
    productConsumedValue: n(r.productConsumedValue),
  })));
});

export default router;

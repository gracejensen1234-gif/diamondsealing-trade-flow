import { Router } from "express";
import { db } from "@workspace/db";
import {
  bonusRulesTable,
  bonusCalculationsTable,
  subcontractorsTable,
  workSessionsTable,
  jobReportsTable,
  auditScoresTable,
} from "@workspace/db";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { workSessionMinutes } from "../lib/date-utils.js";

const router = Router();

// GET /bonus-rules
router.get("/bonus-rules", async (_req, res) => {
  const rules = await db.select().from(bonusRulesTable).orderBy(desc(bonusRulesTable.createdAt));
  return res.json(rules.map((r) => ({ ...r, bonusAmount: Number(r.bonusAmount) })));
});

// POST /bonus-rules
router.post("/bonus-rules", async (req, res) => {
  const { name, description, targetMetresPerDay, targetMetresPerWeek, targetMetresPerHour, bonusAmount, bonusType, minAuditScore, active } = req.body;
  if (!name || bonusAmount === undefined || !bonusType) return res.status(400).json({ error: "name, bonusAmount, bonusType required" });

  const [rule] = await db.insert(bonusRulesTable).values({
    name,
    description,
    targetMetresPerDay: targetMetresPerDay?.toString(),
    targetMetresPerWeek: targetMetresPerWeek?.toString(),
    targetMetresPerHour: targetMetresPerHour?.toString(),
    bonusAmount: bonusAmount.toString(),
    bonusType,
    minAuditScore: minAuditScore?.toString(),
    active: active ?? true,
  }).returning();

  return res.status(201).json({ ...rule, bonusAmount: Number(rule.bonusAmount) });
});

// PATCH /bonus-rules/:id
router.patch("/bonus-rules/:id", async (req, res) => {
  const id = Number(req.params.id);
  const updates: Record<string, unknown> = {};
  const { name, description, targetMetresPerDay, targetMetresPerWeek, targetMetresPerHour, bonusAmount, bonusType, minAuditScore, active } = req.body;
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;
  if (targetMetresPerDay !== undefined) updates.targetMetresPerDay = targetMetresPerDay?.toString();
  if (targetMetresPerWeek !== undefined) updates.targetMetresPerWeek = targetMetresPerWeek?.toString();
  if (targetMetresPerHour !== undefined) updates.targetMetresPerHour = targetMetresPerHour?.toString();
  if (bonusAmount !== undefined) updates.bonusAmount = bonusAmount.toString();
  if (bonusType !== undefined) updates.bonusType = bonusType;
  if (minAuditScore !== undefined) updates.minAuditScore = minAuditScore?.toString();
  if (active !== undefined) updates.active = active;
  updates.updatedAt = new Date();

  const [rule] = await db.update(bonusRulesTable).set(updates).where(eq(bonusRulesTable.id, id)).returning();
  if (!rule) return res.status(404).json({ error: "Not found" });
  return res.json({ ...rule, bonusAmount: Number(rule.bonusAmount) });
});

// DELETE /bonus-rules/:id
router.delete("/bonus-rules/:id", async (req, res) => {
  await db.delete(bonusRulesTable).where(eq(bonusRulesTable.id, Number(req.params.id)));
  return res.status(204).send();
});

// GET /bonus-calculations
router.get("/bonus-calculations", async (req, res) => {
  const { weekStart, subcontractorId, status } = req.query;
  const calcs = await db.select().from(bonusCalculationsTable).orderBy(desc(bonusCalculationsTable.calculatedAt));
  const subs = await db.select().from(subcontractorsTable);
  const subMap = new Map(subs.map((s) => [s.id, s.name]));

  let filtered = calcs;
  if (weekStart) filtered = filtered.filter((c) => c.weekStart === weekStart);
  if (subcontractorId) filtered = filtered.filter((c) => c.subcontractorId === Number(subcontractorId));
  if (status) filtered = filtered.filter((c) => c.status === status);

  return res.json(filtered.map((c) => ({
    ...c,
    subcontractorName: subMap.get(c.subcontractorId) ?? "",
    totalMetres: Number(c.totalMetres),
    bonusAmount: Number(c.bonusAmount),
    avgMetresPerHour: c.avgMetresPerHour ? Number(c.avgMetresPerHour) : null,
  })));
});

// POST /bonus-calculations/calculate
router.post("/bonus-calculations/calculate", async (req, res) => {
  const { weekStart } = req.body;
  if (!weekStart) return res.status(400).json({ error: "weekStart required" });

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const weekEndStr = weekEnd.toISOString().split("T")[0];

  const subs = await db.select().from(subcontractorsTable).where(eq(subcontractorsTable.active, true));
  const rules = await db.select().from(bonusRulesTable).where(eq(bonusRulesTable.active, true));

  const results = await Promise.all(
    subs.map(async (sub) => {
      const sessions = await db
        .select()
        .from(workSessionsTable)
        .where(
          and(
            eq(workSessionsTable.subcontractorId, sub.id),
            gte(workSessionsTable.date, weekStart),
            lte(workSessionsTable.date, weekEndStr),
          ),
        );

      const reports = await db
        .select()
        .from(jobReportsTable)
        .where(
          and(
            eq(jobReportsTable.subcontractorId, sub.id),
            gte(jobReportsTable.dispatchDate, weekStart),
            lte(jobReportsTable.dispatchDate, weekEndStr),
          ),
        );

      const totalMetres = reports.reduce((a, r) => a + Number(r.metersCompleted || 0), 0);
      const totalWorkMinutes = sessions.reduce((a, s) => a + workSessionMinutes(s), 0);
      const avgMetresPerHour = totalWorkMinutes > 0 ? totalMetres / (totalWorkMinutes / 60) : null;
      const avgMetresPerDay = sessions.length > 0 ? totalMetres / sessions.length : null;
      const daysWorked = sessions.filter((s) => s.clockedOnAt).length;

      const [auditScore] = await db
        .select()
        .from(auditScoresTable)
        .where(
          and(
            eq(auditScoresTable.subcontractorId, sub.id),
            eq(auditScoresTable.periodType, "weekly"),
            eq(auditScoresTable.periodStart, weekStart),
          ),
        )
        .limit(1);

      const scoreVal = auditScore ? Number(auditScore.adminOverride ? auditScore.adminOverrideScore : auditScore.overallScore) : null;

      // Find applicable bonus rule
      let bestRule: typeof rules[0] | null = null;
      let bonusAmount = 0;
      let bonusEarned = false;

      for (const rule of rules) {
        const meetsAudit = !rule.minAuditScore || scoreVal === null || scoreVal >= Number(rule.minAuditScore);
        const meetsWeek = !rule.targetMetresPerWeek || totalMetres >= Number(rule.targetMetresPerWeek);
        const meetsDay = !rule.targetMetresPerDay || (avgMetresPerDay !== null && avgMetresPerDay >= Number(rule.targetMetresPerDay));
        const meetsHour = !rule.targetMetresPerHour || (avgMetresPerHour !== null && avgMetresPerHour >= Number(rule.targetMetresPerHour));

        if (meetsAudit && meetsWeek && meetsDay && meetsHour) {
          let calc = Number(rule.bonusAmount);
          if (rule.bonusType === "per_metre_over" && rule.targetMetresPerWeek) {
            calc = Math.max(0, totalMetres - Number(rule.targetMetresPerWeek)) * Number(rule.bonusAmount);
          }
          if (!bestRule || calc > bonusAmount) {
            bestRule = rule;
            bonusAmount = calc;
            bonusEarned = true;
          }
        }
      }

      // Upsert calculation
      const existing = await db
        .select()
        .from(bonusCalculationsTable)
        .where(
          and(
            eq(bonusCalculationsTable.subcontractorId, sub.id),
            eq(bonusCalculationsTable.weekStart, weekStart),
          ),
        )
        .limit(1);

      const values = {
        subcontractorId: sub.id,
        weekStart,
        totalMetres: totalMetres.toString(),
        totalWorkMinutes,
        avgMetresPerHour: avgMetresPerHour !== null ? avgMetresPerHour.toString() : null,
        avgMetresPerDay: avgMetresPerDay !== null ? avgMetresPerDay.toString() : null,
        auditScore: scoreVal !== null ? scoreVal.toString() : null,
        bonusRuleId: bestRule?.id ?? null,
        bonusAmount: bonusAmount.toString(),
        bonusEarned,
        status: "pending" as const,
        calculatedAt: new Date(),
      };

      let [calc] = existing.length
        ? await db.update(bonusCalculationsTable).set(values).where(eq(bonusCalculationsTable.id, existing[0].id)).returning()
        : await db.insert(bonusCalculationsTable).values(values).returning();

      return {
        ...calc,
        subcontractorName: sub.name,
        totalMetres: Number(calc.totalMetres),
        bonusAmount: Number(calc.bonusAmount),
        avgMetresPerHour: calc.avgMetresPerHour ? Number(calc.avgMetresPerHour) : null,
        bonusRuleName: bestRule?.name ?? null,
      };
    }),
  );

  return res.json(results);
});

// PATCH /bonus-calculations/:id
router.patch("/bonus-calculations/:id", async (req, res) => {
  const { status, adminNotes } = req.body;
  const updates: Record<string, unknown> = {};
  if (status) updates.status = status;
  if (adminNotes !== undefined) updates.adminNotes = adminNotes;
  if (status === "approved") updates.approvedAt = new Date();

  const [calc] = await db
    .update(bonusCalculationsTable)
    .set(updates)
    .where(eq(bonusCalculationsTable.id, Number(req.params.id)))
    .returning();

  if (!calc) return res.status(404).json({ error: "Not found" });
  return res.json({ ...calc, totalMetres: Number(calc.totalMetres), bonusAmount: Number(calc.bonusAmount) });
});

export default router;

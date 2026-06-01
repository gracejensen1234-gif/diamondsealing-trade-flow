import { Router } from "express";
import { db } from "@workspace/db";
import { workerSkillsTable, subcontractorsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { companyId, requireAdmin } from "../lib/auth.js";

const router = Router();
router.use(requireAdmin);

function formatSkills(row: typeof workerSkillsTable.$inferSelect, subName: string) {
  return {
    ...row,
    subcontractorName: subName,
    qualityScore: Number(row.qualityScore),
    builderRatingAvg: row.builderRatingAvg ? Number(row.builderRatingAvg) : null,
    callbackRate: Number(row.callbackRate),
    punctualityScore: Number(row.punctualityScore),
    attendanceScore: Number(row.attendanceScore),
    photoComplianceScore: Number(row.photoComplianceScore),
    safetyScore: Number(row.safetyScore),
    customSkills: (row.customSkills as string[]) ?? [],
  };
}

// GET /worker-skills
router.get("/worker-skills", async (req, res) => {
  const tenantId = companyId(req);
  const rows = await db.select().from(workerSkillsTable).where(eq(workerSkillsTable.companyId, tenantId));
  const subs = await db.select().from(subcontractorsTable).where(eq(subcontractorsTable.companyId, tenantId));
  const subMap = new Map(subs.map((s) => [s.id, s.name]));
  return res.json(rows.map((r) => formatSkills(r, subMap.get(r.subcontractorId) ?? "")));
});

// GET /worker-skills/:subcontractorId
router.get("/worker-skills/:subcontractorId", async (req, res) => {
  const subId = Number(req.params.subcontractorId);
  const tenantId = companyId(req);
  const [sub] = await db
    .select()
    .from(subcontractorsTable)
    .where(and(eq(subcontractorsTable.id, subId), eq(subcontractorsTable.companyId, tenantId)));
  if (!sub) return res.status(404).json({ error: "Subcontractor not found" });

  let [row] = await db
    .select()
    .from(workerSkillsTable)
    .where(and(eq(workerSkillsTable.companyId, tenantId), eq(workerSkillsTable.subcontractorId, subId)));
  if (!row) {
    [row] = await db.insert(workerSkillsTable).values({ companyId: tenantId, subcontractorId: subId }).returning();
  }
  return res.json(formatSkills(row, sub.name));
});

// PUT /worker-skills/:subcontractorId
router.put("/worker-skills/:subcontractorId", async (req, res) => {
  const subId = Number(req.params.subcontractorId);
  const tenantId = companyId(req);
  const [sub] = await db
    .select()
    .from(subcontractorsTable)
    .where(and(eq(subcontractorsTable.id, subId), eq(subcontractorsTable.companyId, tenantId)));
  if (!sub) return res.status(404).json({ error: "Subcontractor not found" });

  const allowed = [
    "canSilicone","canSikaflex","canFireRated","canWaterproofing","canBackerRod",
    "canPrimer","canJointPrep","canGrindingCutting","canResidential","canCommercial",
    "canPools","canCarParks","customSkills","experienceLevel","yearsExperience",
    "qualityScore","callbackRate","notes",
  ];
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of allowed) {
    if (req.body[k] !== undefined) {
      if (["qualityScore","callbackRate"].includes(k)) updates[k] = String(req.body[k]);
      else updates[k] = req.body[k];
    }
  }

  const existing = await db
    .select()
    .from(workerSkillsTable)
    .where(and(eq(workerSkillsTable.companyId, tenantId), eq(workerSkillsTable.subcontractorId, subId)))
    .limit(1);
  let [row] = existing.length
    ? await db
        .update(workerSkillsTable)
        .set(updates)
        .where(and(eq(workerSkillsTable.companyId, tenantId), eq(workerSkillsTable.subcontractorId, subId)))
        .returning()
    : await db.insert(workerSkillsTable).values({ companyId: tenantId, subcontractorId: subId, ...updates }).returning();

  return res.json(formatSkills(row, sub.name));
});

export default router;

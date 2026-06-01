import { Router } from "express";
import { db } from "@workspace/db";
import { builderProfilesTable, builderRatingsTable, customersTable, subcontractorsTable, workerSkillsTable } from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";
import { companyId } from "../lib/auth.js";

const router = Router();

function fmtProfile(p: typeof builderProfilesTable.$inferSelect) {
  return {
    ...p,
    preferredWorkerIds: (p.preferredWorkerIds as number[]) ?? [],
    avoidedWorkerIds: (p.avoidedWorkerIds as number[]) ?? [],
  };
}

// GET /builder-profiles
router.get("/builder-profiles", async (req, res) => {
  const rows = await db
    .select()
    .from(builderProfilesTable)
    .where(eq(builderProfilesTable.companyId, companyId(req)))
    .orderBy(builderProfilesTable.name);
  return res.json(rows.map(fmtProfile));
});

// POST /builder-profiles
router.post("/builder-profiles", async (req, res) => {
  const {
    name, customerId, contactName, contactPhone, contactEmail, qualityTier, customTierLabel,
    preferredWorkerIds, avoidedWorkerIds, finishExpectations, documentationRequirements,
    signOffRequired, signOffNotes, siteNotes, specialInstructions,
  } = req.body;
  if (!name || !qualityTier) return res.status(400).json({ error: "name and qualityTier required" });
  const tenantId = companyId(req);
  if (customerId) {
    const [customer] = await db
      .select()
      .from(customersTable)
      .where(and(eq(customersTable.id, Number(customerId)), eq(customersTable.companyId, tenantId)));
    if (!customer) return res.status(400).json({ error: "Client not found for this company" });
  }

  const [row] = await db.insert(builderProfilesTable).values({
    companyId: tenantId,
    name, customerId, contactName, contactPhone, contactEmail,
    qualityTier, customTierLabel, preferredWorkerIds: preferredWorkerIds ?? [],
    avoidedWorkerIds: avoidedWorkerIds ?? [], finishExpectations,
    documentationRequirements, signOffRequired: signOffRequired ?? false,
    signOffNotes, siteNotes, specialInstructions,
  }).returning();
  return res.status(201).json(fmtProfile(row));
});

// GET /builder-profiles/:id
router.get("/builder-profiles/:id", async (req, res) => {
  const [row] = await db
    .select()
    .from(builderProfilesTable)
    .where(and(eq(builderProfilesTable.id, Number(req.params.id)), eq(builderProfilesTable.companyId, companyId(req))));
  if (!row) return res.status(404).json({ error: "Not found" });
  return res.json(fmtProfile(row));
});

// PATCH /builder-profiles/:id
router.patch("/builder-profiles/:id", async (req, res) => {
  const allowed = [
    "name","contactName","contactPhone","contactEmail","qualityTier","customTierLabel",
    "preferredWorkerIds","avoidedWorkerIds","finishExpectations","documentationRequirements",
    "signOffRequired","signOffNotes","siteNotes","specialInstructions","active",
  ];
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of allowed) {
    if (req.body[k] !== undefined) updates[k] = req.body[k];
  }
  const [row] = await db
    .update(builderProfilesTable)
    .set(updates)
    .where(and(eq(builderProfilesTable.id, Number(req.params.id)), eq(builderProfilesTable.companyId, companyId(req))))
    .returning();
  if (!row) return res.status(404).json({ error: "Not found" });
  return res.json(fmtProfile(row));
});

// DELETE /builder-profiles/:id
router.delete("/builder-profiles/:id", async (req, res) => {
  await db
    .update(builderProfilesTable)
    .set({ active: false })
    .where(and(eq(builderProfilesTable.id, Number(req.params.id)), eq(builderProfilesTable.companyId, companyId(req))));
  return res.status(204).send();
});

// GET /builder-ratings
router.get("/builder-ratings", async (req, res) => {
  const tenantId = companyId(req);
  const rows = await db
    .select()
    .from(builderRatingsTable)
    .where(eq(builderRatingsTable.companyId, tenantId))
    .orderBy(desc(builderRatingsTable.createdAt));
  const subs = await db.select().from(subcontractorsTable).where(eq(subcontractorsTable.companyId, tenantId));
  const builders = await db.select().from(builderProfilesTable).where(eq(builderProfilesTable.companyId, tenantId));
  const subMap = new Map(subs.map((s) => [s.id, s.name]));
  const builderMap = new Map(builders.map((b) => [b.id, b.name]));

  let filtered = rows;
  if (req.query.subcontractorId) filtered = filtered.filter((r) => r.subcontractorId === Number(req.query.subcontractorId));
  if (req.query.builderProfileId) filtered = filtered.filter((r) => r.builderProfileId === Number(req.query.builderProfileId));

  return res.json(filtered.map((r) => ({
    ...r,
    subcontractorName: subMap.get(r.subcontractorId) ?? "",
    builderName: builderMap.get(r.builderProfileId) ?? "",
  })));
});

// POST /builder-ratings
router.post("/builder-ratings", async (req, res) => {
  const { builderProfileId, subcontractorId, jobAssignmentId, rating, qualityComment, punctualityComment, professionalismComment, wouldRequestAgain, internalNotes } = req.body;
  if (!builderProfileId || !subcontractorId || !rating) return res.status(400).json({ error: "builderProfileId, subcontractorId, rating required" });
  const tenantId = companyId(req);
  const [builderProfile] = await db
    .select()
    .from(builderProfilesTable)
    .where(and(eq(builderProfilesTable.id, Number(builderProfileId)), eq(builderProfilesTable.companyId, tenantId)));
  const [worker] = await db
    .select()
    .from(subcontractorsTable)
    .where(and(eq(subcontractorsTable.id, Number(subcontractorId)), eq(subcontractorsTable.companyId, tenantId)));
  if (!builderProfile || !worker) return res.status(400).json({ error: "Builder profile or employee/subcontractor not found for this company" });

  const [row] = await db.insert(builderRatingsTable).values({
    companyId: tenantId,
    builderProfileId: Number(builderProfileId),
    subcontractorId: Number(subcontractorId),
    jobAssignmentId: jobAssignmentId ? Number(jobAssignmentId) : null,
    rating: Number(rating),
    qualityComment, punctualityComment, professionalismComment,
    wouldRequestAgain, internalNotes,
  }).returning();

  // Update builder average rating
  const allRatings = await db
    .select()
    .from(builderRatingsTable)
    .where(and(eq(builderRatingsTable.companyId, tenantId), eq(builderRatingsTable.builderProfileId, Number(builderProfileId))));
  const avg = Math.round(allRatings.reduce((a, r) => a + r.rating, 0) / allRatings.length);
  await db
    .update(builderProfilesTable)
    .set({ averageRatingGiven: avg })
    .where(and(eq(builderProfilesTable.id, Number(builderProfileId)), eq(builderProfilesTable.companyId, tenantId)));

  // Update employee/subcontractor builder rating average in worker_skills
  const workerRatings = await db
    .select()
    .from(builderRatingsTable)
    .where(and(eq(builderRatingsTable.companyId, tenantId), eq(builderRatingsTable.subcontractorId, Number(subcontractorId))));
  const workerAvg = workerRatings.reduce((a, r) => a + r.rating, 0) / workerRatings.length;
  await db.update(workerSkillsTable)
    .set({ builderRatingAvg: workerAvg.toFixed(2), updatedAt: new Date() })
    .where(and(eq(workerSkillsTable.companyId, tenantId), eq(workerSkillsTable.subcontractorId, Number(subcontractorId))));

  return res.status(201).json({ ...row, builderName: builderProfile.name, subcontractorName: worker.name });
});

export default router;

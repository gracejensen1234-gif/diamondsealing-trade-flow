import { Router } from "express";
import { db } from "@workspace/db";
import { workerCredentialsTable, workerSkillsTable, subcontractorsTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { canAccessSubcontractor, companyId, isAdmin, requireAdmin, workerSubcontractorId } from "../lib/auth.js";

const router = Router();
const MAX_CREDENTIAL_IMAGE_BYTES = 8 * 1024 * 1024;

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

function formatCredential(row: typeof workerCredentialsTable.$inferSelect, subName: string) {
  return {
    ...row,
    subcontractorName: subName,
  };
}

async function findTenantSubcontractor(subcontractorId: number, tenantId: number) {
  const [sub] = await db
    .select()
    .from(subcontractorsTable)
    .where(and(eq(subcontractorsTable.id, subcontractorId), eq(subcontractorsTable.companyId, tenantId)));
  return sub ?? null;
}

function credentialImageSize(dataUrl: string) {
  const base64 = dataUrl.split(",", 2)[1] ?? "";
  return Math.ceil((base64.length * 3) / 4);
}

// GET /worker-skills
router.get("/worker-skills", requireAdmin, async (req, res) => {
  const tenantId = companyId(req);
  const rows = await db.select().from(workerSkillsTable).where(eq(workerSkillsTable.companyId, tenantId));
  const subs = await db.select().from(subcontractorsTable).where(eq(subcontractorsTable.companyId, tenantId));
  const subMap = new Map(subs.map((s) => [s.id, s.name]));
  return res.json(rows.map((r) => formatSkills(r, subMap.get(r.subcontractorId) ?? "")));
});

// GET /worker-skills/:subcontractorId
router.get("/worker-skills/:subcontractorId", requireAdmin, async (req, res) => {
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
router.put("/worker-skills/:subcontractorId", requireAdmin, async (req, res) => {
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

// GET /worker-credentials?subcontractorId=
router.get("/worker-credentials", async (req, res) => {
  const tenantId = companyId(req);
  const requestedSubcontractorId = req.query.subcontractorId ? Number(req.query.subcontractorId) : null;
  const ownSubcontractorId = workerSubcontractorId(req);
  if (ownSubcontractorId && requestedSubcontractorId && requestedSubcontractorId !== ownSubcontractorId) {
    return res.status(403).json({ error: "You can only access your own employee/subcontractor records" });
  }
  const subcontractorId = ownSubcontractorId ?? requestedSubcontractorId;
  const conditions = [eq(workerCredentialsTable.companyId, tenantId)];

  if (subcontractorId) {
    if (!canAccessSubcontractor(req, subcontractorId)) {
      return res.status(403).json({ error: "You can only access your own employee/subcontractor records" });
    }
    const sub = await findTenantSubcontractor(subcontractorId, tenantId);
    if (!sub) return res.status(404).json({ error: "Employee/subcontractor not found" });
    conditions.push(eq(workerCredentialsTable.subcontractorId, subcontractorId));
  } else if (!isAdmin(req)) {
    return res.status(403).json({ error: "Employee/subcontractor profile is not linked" });
  }

  const rows = await db
    .select()
    .from(workerCredentialsTable)
    .where(and(...conditions))
    .orderBy(desc(workerCredentialsTable.createdAt));
  const subs = await db.select().from(subcontractorsTable).where(eq(subcontractorsTable.companyId, tenantId));
  const subMap = new Map(subs.map((s) => [s.id, s.name]));

  return res.json(rows.map((row) => formatCredential(row, subMap.get(row.subcontractorId) ?? "")));
});

// POST /worker-credentials
router.post("/worker-credentials", async (req, res) => {
  const tenantId = companyId(req);
  const subcontractorId = workerSubcontractorId(req) ?? Number(req.body?.subcontractorId);
  const documentType = typeof req.body?.documentType === "string" ? req.body.documentType.trim() : "";
  const label = typeof req.body?.label === "string" ? req.body.label.trim() : "";
  const imageData = typeof req.body?.imageData === "string" ? req.body.imageData : "";
  const fileName = typeof req.body?.fileName === "string" ? req.body.fileName.trim() : "";
  const expiryDate = typeof req.body?.expiryDate === "string" ? req.body.expiryDate.trim() : "";
  const notes = typeof req.body?.notes === "string" ? req.body.notes.trim() : "";

  if (!subcontractorId) return res.status(400).json({ error: "subcontractorId is required" });
  if (!canAccessSubcontractor(req, subcontractorId)) {
    return res.status(403).json({ error: "You can only update your own employee/subcontractor records" });
  }
  if (documentType.length < 2 || documentType.length > 80) return res.status(400).json({ error: "Document type is required" });
  if (label.length < 2 || label.length > 120) return res.status(400).json({ error: "Document label is required" });
  if (!imageData.startsWith("data:image/")) return res.status(400).json({ error: "Credential image is required" });
  if (credentialImageSize(imageData) > MAX_CREDENTIAL_IMAGE_BYTES) {
    return res.status(400).json({ error: "Credential image is too large" });
  }
  if (expiryDate && !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) return res.status(400).json({ error: "Expiry date must use YYYY-MM-DD" });

  const sub = await findTenantSubcontractor(subcontractorId, tenantId);
  if (!sub) return res.status(404).json({ error: "Employee/subcontractor not found" });

  const [row] = await db.insert(workerCredentialsTable).values({
    companyId: tenantId,
    subcontractorId,
    documentType,
    label,
    imageData,
    fileName: fileName || null,
    expiryDate: expiryDate || null,
    notes: notes || null,
  }).returning();

  return res.status(201).json(formatCredential(row, sub.name));
});

// DELETE /worker-credentials/:id
router.delete("/worker-credentials/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });

  const [existing] = await db
    .select()
    .from(workerCredentialsTable)
    .where(and(eq(workerCredentialsTable.id, id), eq(workerCredentialsTable.companyId, companyId(req))));
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (!canAccessSubcontractor(req, existing.subcontractorId)) {
    return res.status(403).json({ error: "You can only update your own employee/subcontractor records" });
  }

  await db
    .delete(workerCredentialsTable)
    .where(and(eq(workerCredentialsTable.id, id), eq(workerCredentialsTable.companyId, companyId(req))));

  return res.status(204).send();
});

export default router;

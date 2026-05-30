import { Router } from "express";
import { db } from "@workspace/db";
import {
  docketsTable,
  subcontractorsTable,
  jobAssignmentsTable,
  jobsTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";

const router = Router();

async function enrichDocket(d: typeof docketsTable.$inferSelect) {
  const [sub] = await db.select({ name: subcontractorsTable.name }).from(subcontractorsTable).where(eq(subcontractorsTable.id, d.subcontractorId));
  return {
    ...d,
    metresCompleted: d.metresCompleted ? Number(d.metresCompleted) : null,
    photosBefore: (d.photosBefore as string[]) ?? [],
    photosAfter: (d.photosAfter as string[]) ?? [],
    coloursUsed: (d.coloursUsed as string[]) ?? [],
  };
}

// GET /dockets
router.get("/dockets", async (req, res) => {
  const { subcontractorId, jobAssignmentId } = req.query;
  let query = db.select().from(docketsTable).orderBy(desc(docketsTable.createdAt));

  const rows = await query;
  let filtered = rows;
  if (subcontractorId) filtered = filtered.filter((d) => d.subcontractorId === Number(subcontractorId));
  if (jobAssignmentId) filtered = filtered.filter((d) => d.jobAssignmentId === Number(jobAssignmentId));

  return res.json(await Promise.all(filtered.map(enrichDocket)));
});

// POST /dockets
router.post("/dockets", async (req, res) => {
  const {
    subcontractorId, jobAssignmentId, builderName, jobTitle, jobAddress,
    workDescription, metresCompleted, coloursUsed, photosBefore, photosAfter, notes,
  } = req.body;

  if (!subcontractorId) return res.status(400).json({ error: "subcontractorId required" });

  // Generate docket number
  const count = await db.select().from(docketsTable);
  const docketNumber = `DS-${String(count.length + 1).padStart(4, "0")}`;

  const [docket] = await db.insert(docketsTable).values({
    subcontractorId: Number(subcontractorId),
    jobAssignmentId: jobAssignmentId ? Number(jobAssignmentId) : null,
    docketNumber,
    builderName,
    jobTitle,
    jobAddress,
    workDescription,
    metresCompleted: metresCompleted?.toString(),
    coloursUsed: coloursUsed ?? [],
    photosBefore: photosBefore ?? [],
    photosAfter: photosAfter ?? [],
    notes,
    status: "draft",
  }).returning();

  return res.status(201).json(await enrichDocket(docket));
});

// GET /dockets/:id
router.get("/dockets/:id", async (req, res) => {
  const [docket] = await db.select().from(docketsTable).where(eq(docketsTable.id, Number(req.params.id)));
  if (!docket) return res.status(404).json({ error: "Not found" });
  return res.json(await enrichDocket(docket));
});

// PATCH /dockets/:id
router.patch("/dockets/:id", async (req, res) => {
  const {
    builderSignature, subcontractorSignature, photosBefore, photosAfter,
    workDescription, metresCompleted, coloursUsed, notes, status, builderName,
  } = req.body;

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (builderSignature !== undefined) {
    updates.builderSignature = builderSignature;
    updates.builderSigned = true;
  }
  if (subcontractorSignature !== undefined) {
    updates.subcontractorSignature = subcontractorSignature;
    updates.subcontractorSigned = true;
  }
  if (photosBefore !== undefined) updates.photosBefore = photosBefore;
  if (photosAfter !== undefined) updates.photosAfter = photosAfter;
  if (workDescription !== undefined) updates.workDescription = workDescription;
  if (metresCompleted !== undefined) updates.metresCompleted = metresCompleted?.toString();
  if (coloursUsed !== undefined) updates.coloursUsed = coloursUsed;
  if (notes !== undefined) updates.notes = notes;
  if (builderName !== undefined) updates.builderName = builderName;
  if (status !== undefined) {
    updates.status = status;
    if (status === "complete") updates.completedAt = new Date();
  }

  const [docket] = await db.update(docketsTable).set(updates).where(eq(docketsTable.id, Number(req.params.id))).returning();
  if (!docket) return res.status(404).json({ error: "Not found" });
  return res.json(await enrichDocket(docket));
});

export default router;

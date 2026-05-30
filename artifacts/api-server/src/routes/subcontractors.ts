import { Router } from "express";
import { db } from "@workspace/db";
import { subcontractorsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  CreateSubcontractorBody,
  GetSubcontractorParams,
  UpdateSubcontractorParams,
  UpdateSubcontractorBody,
} from "@workspace/api-zod";

const router = Router();

router.get("/subcontractors", async (req, res) => {
  const subs = await db.select().from(subcontractorsTable).orderBy(subcontractorsTable.name);
  return res.json(subs.map((s) => ({ ...s, ratePerMetre: s.ratePerMetre ? Number(s.ratePerMetre) : null })));
});

router.post("/subcontractors", async (req, res) => {
  const parsed = CreateSubcontractorBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid body" });
  const [sub] = await db.insert(subcontractorsTable).values({
    name: parsed.data.name,
    email: parsed.data.email ?? null,
    phone: parsed.data.phone ?? null,
    vehiclePlate: parsed.data.vehiclePlate ?? null,
    abn: parsed.data.abn ?? null,
    ratePerMetre: parsed.data.ratePerMetre != null ? String(parsed.data.ratePerMetre) : null,
    active: parsed.data.active ?? true,
  }).returning();
  return res.status(201).json({ ...sub, ratePerMetre: sub.ratePerMetre ? Number(sub.ratePerMetre) : null });
});

router.get("/subcontractors/:id", async (req, res) => {
  const parsed = GetSubcontractorParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });
  const [sub] = await db.select().from(subcontractorsTable).where(eq(subcontractorsTable.id, parsed.data.id));
  if (!sub) return res.status(404).json({ error: "Not found" });
  return res.json({ ...sub, ratePerMetre: sub.ratePerMetre ? Number(sub.ratePerMetre) : null });
});

router.patch("/subcontractors/:id", async (req, res) => {
  const params = UpdateSubcontractorParams.safeParse({ id: Number(req.params.id) });
  const body = UpdateSubcontractorBody.safeParse(req.body);
  if (!params.success || !body.success) return res.status(400).json({ error: "Invalid request" });
  const updates: Record<string, unknown> = {};
  if (body.data.name !== undefined) updates.name = body.data.name;
  if (body.data.email !== undefined) updates.email = body.data.email;
  if (body.data.phone !== undefined) updates.phone = body.data.phone;
  if (body.data.vehiclePlate !== undefined) updates.vehiclePlate = body.data.vehiclePlate;
  if (body.data.abn !== undefined) updates.abn = body.data.abn;
  if (body.data.ratePerMetre !== undefined) updates.ratePerMetre = String(body.data.ratePerMetre);
  if (body.data.active !== undefined) updates.active = body.data.active;
  const [sub] = await db.update(subcontractorsTable).set(updates).where(eq(subcontractorsTable.id, params.data.id)).returning();
  if (!sub) return res.status(404).json({ error: "Not found" });
  return res.json({ ...sub, ratePerMetre: sub.ratePerMetre ? Number(sub.ratePerMetre) : null });
});

export default router;

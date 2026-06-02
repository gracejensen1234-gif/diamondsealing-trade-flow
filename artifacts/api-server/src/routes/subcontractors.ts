import { Router } from "express";
import { db } from "@workspace/db";
import { subcontractorsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import {
  CreateSubcontractorBody,
  GetSubcontractorParams,
  UpdateSubcontractorParams,
  UpdateSubcontractorBody,
} from "@workspace/api-zod";
import { canAccessSubcontractor, companyId, isAdmin, requireAdmin } from "../lib/auth.js";

const router = Router();

function serializeSubcontractor(sub: typeof subcontractorsTable.$inferSelect, includeAdminFields: boolean) {
  const base = {
    id: sub.id,
    companyId: sub.companyId,
    name: sub.name,
    email: sub.email,
    phone: sub.phone,
    abn: sub.abn,
    hourlyRate: sub.hourlyRate ? Number(sub.hourlyRate) : null,
    active: sub.active,
    createdAt: sub.createdAt,
  };

  return includeAdminFields
    ? { ...base, ratePerMetre: sub.ratePerMetre ? Number(sub.ratePerMetre) : null }
    : base;
}

router.get("/subcontractors", async (req, res) => {
  const admin = isAdmin(req);
  const subs = admin
    ? await db
      .select()
      .from(subcontractorsTable)
      .where(eq(subcontractorsTable.companyId, companyId(req)))
      .orderBy(subcontractorsTable.name)
    : await db
      .select()
      .from(subcontractorsTable)
      .where(and(
        eq(subcontractorsTable.id, req.authUser!.subcontractorId ?? 0),
        eq(subcontractorsTable.companyId, companyId(req)),
      ))
      .orderBy(subcontractorsTable.name);
  return res.json(subs.map((s) => serializeSubcontractor(s, admin)));
});

router.post("/subcontractors", requireAdmin, async (req, res) => {
  const parsed = CreateSubcontractorBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid body" });
  const [sub] = await db.insert(subcontractorsTable).values({
    companyId: companyId(req),
    name: parsed.data.name,
    email: parsed.data.email ?? null,
    phone: parsed.data.phone ?? null,
    abn: parsed.data.abn ?? null,
    ratePerMetre: parsed.data.ratePerMetre != null ? String(parsed.data.ratePerMetre) : null,
    hourlyRate: parsed.data.hourlyRate != null ? String(parsed.data.hourlyRate) : null,
    active: parsed.data.active ?? true,
  }).returning();
  return res.status(201).json(serializeSubcontractor(sub, true));
});

router.get("/subcontractors/:id", async (req, res) => {
  const parsed = GetSubcontractorParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });
  if (!canAccessSubcontractor(req, parsed.data.id)) {
    return res.status(403).json({ error: "You can only view your own employee/subcontractor profile" });
  }
  const [sub] = await db
    .select()
    .from(subcontractorsTable)
    .where(and(eq(subcontractorsTable.id, parsed.data.id), eq(subcontractorsTable.companyId, companyId(req))));
  if (!sub) return res.status(404).json({ error: "Not found" });
  return res.json(serializeSubcontractor(sub, isAdmin(req)));
});

router.patch("/subcontractors/:id", requireAdmin, async (req, res) => {
  const params = UpdateSubcontractorParams.safeParse({ id: Number(req.params.id) });
  const body = UpdateSubcontractorBody.safeParse(req.body);
  if (!params.success || !body.success) return res.status(400).json({ error: "Invalid request" });
  const updates: Record<string, unknown> = {};
  if (body.data.name !== undefined) updates.name = body.data.name;
  if (body.data.email !== undefined) updates.email = body.data.email;
  if (body.data.phone !== undefined) updates.phone = body.data.phone;
  if (body.data.abn !== undefined) updates.abn = body.data.abn;
  if (body.data.ratePerMetre !== undefined) updates.ratePerMetre = String(body.data.ratePerMetre);
  if (body.data.hourlyRate !== undefined) updates.hourlyRate = String(body.data.hourlyRate);
  if (body.data.active !== undefined) updates.active = body.data.active;
  const [sub] = await db
    .update(subcontractorsTable)
    .set(updates)
    .where(and(eq(subcontractorsTable.id, params.data.id), eq(subcontractorsTable.companyId, companyId(req))))
    .returning();
  if (!sub) return res.status(404).json({ error: "Not found" });
  return res.json(serializeSubcontractor(sub, true));
});

export default router;

import { Router } from "express";
import { db } from "@workspace/db";
import { appUsersTable, subcontractorsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import {
  CreateSubcontractorBody,
  GetSubcontractorParams,
  UpdateSubcontractorParams,
  UpdateSubcontractorBody,
} from "@workspace/api-zod";
import { canAccessSubcontractor, companyId, hashPassword, isAdmin, requireAdmin } from "../lib/auth.js";

const router = Router();
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

router.post("/subcontractors/:id/worker-account", requireAdmin, async (req, res) => {
  const subId = Number(req.params.id);
  if (!Number.isInteger(subId) || subId <= 0) return res.status(400).json({ error: "Invalid employee/subcontractor id" });

  const loginEmail = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const temporaryPassword = typeof req.body?.password === "string" ? req.body.password : "";
  const loginName = typeof req.body?.name === "string" ? req.body.name.trim() : "";

  if (!EMAIL_PATTERN.test(loginEmail)) return res.status(400).json({ error: "A valid login email is required" });
  if (temporaryPassword.length < 6 || temporaryPassword.length > 128) {
    return res.status(400).json({ error: "Temporary password must be at least 6 characters" });
  }
  if (loginName.length > 120) return res.status(400).json({ error: "Login name is too long" });

  const tenantId = companyId(req);
  const [sub] = await db
    .select()
    .from(subcontractorsTable)
    .where(and(eq(subcontractorsTable.id, subId), eq(subcontractorsTable.companyId, tenantId)));
  if (!sub) return res.status(404).json({ error: "Employee/subcontractor profile not found" });

  const [existingByEmail] = await db
    .select()
    .from(appUsersTable)
    .where(eq(appUsersTable.email, loginEmail))
    .limit(1);
  const [existingForSubcontractor] = await db
    .select()
    .from(appUsersTable)
    .where(and(
      eq(appUsersTable.companyId, tenantId),
      eq(appUsersTable.role, "worker"),
      eq(appUsersTable.subcontractorId, sub.id),
    ))
    .limit(1);

  if (existingByEmail) {
    if (existingByEmail.companyId !== tenantId) {
      return res.status(409).json({ error: "This email is already used by another company account" });
    }
    if (existingByEmail.role !== "worker") {
      return res.status(409).json({ error: "This email belongs to an admin account" });
    }
    if (existingByEmail.subcontractorId && existingByEmail.subcontractorId !== sub.id) {
      return res.status(409).json({ error: "This email is already linked to another employee/subcontractor" });
    }
  }
  if (existingByEmail && existingForSubcontractor && existingByEmail.id !== existingForSubcontractor.id) {
    return res.status(409).json({ error: "This employee/subcontractor already has a different login account" });
  }

  const passwordHash = await hashPassword(temporaryPassword);
  const displayName = loginName || sub.name;
  const userValues = {
    companyId: tenantId,
    name: displayName,
    email: loginEmail,
    role: "worker" as const,
    subcontractorId: sub.id,
    passwordHash,
    active: true,
    updatedAt: new Date(),
  };

  const account = await db.transaction(async (tx) => {
    const existingAccount = existingByEmail ?? existingForSubcontractor;
    const [savedAccount] = existingAccount
      ? await tx.update(appUsersTable)
        .set(userValues)
        .where(eq(appUsersTable.id, existingAccount.id))
        .returning()
      : await tx.insert(appUsersTable)
        .values(userValues)
        .returning();

    if (sub.email !== loginEmail) {
      await tx
        .update(subcontractorsTable)
        .set({ email: loginEmail, active: true })
        .where(and(eq(subcontractorsTable.id, sub.id), eq(subcontractorsTable.companyId, tenantId)));
    }

    return savedAccount;
  });

  return res.json({
    user: {
      id: account.id,
      name: account.name,
      email: account.email,
      role: account.role,
      subcontractorId: account.subcontractorId,
      active: account.active,
    },
    temporaryPasswordSet: true,
  });
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

import { Router } from "express";
import { db } from "@workspace/db";
import { appUsersTable, companyAccountsTable, staffInvitesTable, subcontractorsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import {
  authenticateByEmailPassword,
  authSetupStatus,
  clearSessionCookie,
  ensureEnvUsers,
  hashPassword,
  requireAuth,
  setSessionCookie,
} from "../lib/auth.js";

const router = Router();
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function signupsEnabled() {
  return process.env.SIGNUPS_ENABLED?.toLowerCase() !== "false";
}

function adminSignupCode() {
  return process.env.ADMIN_SIGNUP_CODE?.trim() || "";
}

function adminSignupsEnabled() {
  return process.env.ADMIN_SIGNUPS_ENABLED?.toLowerCase() === "true" && Boolean(adminSignupCode());
}

function slugifyCompany(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "company";
}

function normalizeInviteCode(value: string) {
  return value.trim().replace(/\s+/g, "").toUpperCase();
}

async function nextCompanySlug(companyName: string) {
  const base = slugifyCompany(companyName);
  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const slug = suffix === 0 ? base : `${base}-${suffix + 1}`;
    const [existing] = await db.select({ id: companyAccountsTable.id }).from(companyAccountsTable).where(eq(companyAccountsTable.slug, slug));
    if (!existing) return slug;
  }
  return `${base}-${Date.now()}`;
}

async function findCompanyByCode(companyCode: string) {
  const slug = slugifyCompany(companyCode);
  const [company] = await db
    .select()
    .from(companyAccountsTable)
    .where(eq(companyAccountsTable.slug, slug));
  return company ?? null;
}

router.get("/auth/setup-status", async (_req, res) => {
  try {
    await ensureEnvUsers();
  } catch {
    return res.json(authSetupStatus());
  }

  return res.json(authSetupStatus());
});

router.post("/auth/register", async (req, res) => {
  if (!signupsEnabled()) {
    return res.status(403).json({ error: "Account creation is not enabled" });
  }
  if (!authSetupStatus().configured) {
    return res.status(503).json({
      error: "Login is not configured yet",
      setup: authSetupStatus(),
    });
  }

  const accountType = req.body?.accountType === "worker"
    ? "worker"
    : req.body?.accountType === "company"
      ? "company"
      : req.body?.accountType === "staff"
        ? "staff"
        : "admin";
  const companyName = typeof req.body?.companyName === "string" ? req.body.companyName.trim() : "";
  const companyCode = typeof req.body?.companyCode === "string" ? req.body.companyCode.trim() : "";
  const staffInviteCode = typeof req.body?.staffInviteCode === "string" ? normalizeInviteCode(req.body.staffInviteCode) : "";
  const submittedAdminSignupCode = typeof req.body?.adminSignupCode === "string" ? req.body.adminSignupCode.trim() : "";
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const phone = typeof req.body?.phone === "string" ? req.body.phone.trim() : "";
  const abn = typeof req.body?.abn === "string" ? req.body.abn.trim() : "";

  if (accountType === "admin" && (!adminSignupsEnabled() || submittedAdminSignupCode !== adminSignupCode())) {
    return res.status(403).json({ error: "Admin account creation is invite-only" });
  }

  if ((accountType === "admin" || accountType === "company") && (companyName.length < 2 || companyName.length > 120)) {
    return res.status(400).json({ error: "Company name is required" });
  }
  if (accountType === "worker" && (companyCode.length < 2 || companyCode.length > 120)) {
    return res.status(400).json({ error: "Company code is required" });
  }
  if (accountType === "staff" && (staffInviteCode.length < 8 || staffInviteCode.length > 80)) {
    return res.status(400).json({ error: "Staff invite code is required" });
  }
  if (name.length < 2 || name.length > 120) return res.status(400).json({ error: "Your name is required" });
  if (!EMAIL_PATTERN.test(email)) return res.status(400).json({ error: "A valid email is required" });
  if (password.length < 6 || password.length > 128) return res.status(400).json({ error: "Password must be at least 6 characters" });
  if (phone.length > 60) return res.status(400).json({ error: "Phone number is too long" });
  if (abn.length > 40) return res.status(400).json({ error: "ABN is too long" });
  const [existingUser] = await db.select({ id: appUsersTable.id }).from(appUsersTable).where(eq(appUsersTable.email, email));
  if (existingUser) {
    return res.status(409).json({ error: "An account already exists for this email" });
  }

  if (accountType === "staff") {
    const [invite] = await db
      .select()
      .from(staffInvitesTable)
      .where(eq(staffInvitesTable.inviteCode, staffInviteCode));
    if (!invite) return res.status(404).json({ error: "Staff invite code not found" });
    if (invite.status !== "pending") return res.status(400).json({ error: "This staff invite is no longer active" });
    if (invite.expiresAt.getTime() < Date.now()) {
      await db.update(staffInvitesTable)
        .set({ status: "expired", updatedAt: new Date() })
        .where(eq(staffInvitesTable.id, invite.id));
      return res.status(400).json({ error: "This staff invite has expired" });
    }
    if (invite.email.toLowerCase() !== email) {
      return res.status(400).json({ error: "Use the email address this staff invite was created for" });
    }

    const [company] = await db
      .select()
      .from(companyAccountsTable)
      .where(eq(companyAccountsTable.id, invite.companyId));
    if (!company) return res.status(404).json({ error: "Company account not found for this invite" });

    const passwordHash = await hashPassword(password);
    const result = await db.transaction(async (tx) => {
      const [createdStaff] = await tx.insert(appUsersTable).values({
        companyId: company.id,
        name,
        email,
        role: "admin",
        passwordHash,
        active: true,
      }).returning();

      await tx.update(staffInvitesTable)
        .set({
          status: "accepted",
          acceptedByUserId: createdStaff.id,
          acceptedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(staffInvitesTable.id, invite.id));

      return createdStaff;
    });

    const user = {
      id: result.id,
      companyId: company.id,
      companyName: company.name,
      companySlug: company.slug,
      name: result.name,
      email: result.email,
      role: "admin" as const,
      subcontractorId: null,
    };

    setSessionCookie(res, user);
    return res.status(201).json({ user });
  }

  if (accountType === "worker") {
    const company = await findCompanyByCode(companyCode);
    if (!company) return res.status(404).json({ error: "Company code not found" });

    const passwordHash = await hashPassword(password);
    const result = await db.transaction(async (tx) => {
      let [subcontractor] = await tx
        .select()
        .from(subcontractorsTable)
        .where(and(
          eq(subcontractorsTable.companyId, company.id),
          eq(subcontractorsTable.email, email),
        ))
        .limit(1);

      if (subcontractor) {
        const updates: Record<string, unknown> = { name, active: true };
        if (phone) updates.phone = phone;
        if (abn) updates.abn = abn;
        [subcontractor] = await tx
          .update(subcontractorsTable)
          .set(updates)
          .where(and(
            eq(subcontractorsTable.id, subcontractor.id),
            eq(subcontractorsTable.companyId, company.id),
          ))
          .returning();
      } else {
        [subcontractor] = await tx.insert(subcontractorsTable).values({
          companyId: company.id,
          name,
          email,
          phone: phone || null,
          abn: abn || null,
          active: true,
        }).returning();
      }

      const [createdWorker] = await tx.insert(appUsersTable).values({
        companyId: company.id,
        name,
        email,
        role: "worker",
        subcontractorId: subcontractor.id,
        passwordHash,
        active: true,
      }).returning();

      return { createdWorker, subcontractor };
    });

    const user = {
      id: result.createdWorker.id,
      companyId: company.id,
      companyName: company.name,
      companySlug: company.slug,
      name: result.createdWorker.name,
      email: result.createdWorker.email,
      role: "worker" as const,
      subcontractorId: result.subcontractor.id,
    };

    setSessionCookie(res, user);
    return res.status(201).json({ user });
  }

  const slug = await nextCompanySlug(companyName);
  const passwordHash = await hashPassword(password);

  const result = await db.transaction(async (tx) => {
    const [company] = await tx.insert(companyAccountsTable).values({
      name: companyName,
      slug,
      status: "trial",
      subscriptionPlan: "trial",
    }).returning();

    const [user] = await tx.insert(appUsersTable).values({
      companyId: company.id,
      name,
      email,
      role: "admin",
      passwordHash,
      active: true,
    }).returning();

    return { company, user };
  });

  const user = {
    id: result.user.id,
    companyId: result.company.id,
    companyName: result.company.name,
    companySlug: result.company.slug,
    name: result.user.name,
    email: result.user.email,
    role: "admin" as const,
    subcontractorId: null,
  };

  setSessionCookie(res, user);
  return res.status(201).json({ user });
});

router.post("/auth/login", async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";

  if (!authSetupStatus().configured) {
    return res.status(503).json({
      error: "Login is not configured yet",
      setup: authSetupStatus(),
    });
  }

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const user = await authenticateByEmailPassword(email, password);
  if (!user) return res.status(401).json({ error: "Invalid email or password" });

  setSessionCookie(res, user);
  return res.json({ user });
});

router.post("/auth/logout", (_req, res) => {
  clearSessionCookie(res);
  return res.status(204).send();
});

router.get("/auth/me", requireAuth, (req, res) => {
  return res.json({ user: req.authUser });
});

export default router;

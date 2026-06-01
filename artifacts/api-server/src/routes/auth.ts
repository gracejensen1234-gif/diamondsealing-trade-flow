import { Router } from "express";
import { db } from "@workspace/db";
import { appUsersTable, companyAccountsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
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

function slugifyCompany(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "company";
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

  const companyName = typeof req.body?.companyName === "string" ? req.body.companyName.trim() : "";
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";

  if (companyName.length < 2 || companyName.length > 120) return res.status(400).json({ error: "Company name is required" });
  if (name.length < 2 || name.length > 120) return res.status(400).json({ error: "Your name is required" });
  if (!EMAIL_PATTERN.test(email)) return res.status(400).json({ error: "A valid email is required" });
  if (password.length < 6 || password.length > 128) return res.status(400).json({ error: "Password must be at least 6 characters" });
  const [existingUser] = await db.select({ id: appUsersTable.id }).from(appUsersTable).where(eq(appUsersTable.email, email));
  if (existingUser) {
    return res.status(409).json({ error: "An account already exists for this email" });
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

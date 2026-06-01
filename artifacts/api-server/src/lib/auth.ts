import type { NextFunction, Request, Response } from "express";
import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { db } from "@workspace/db";
import {
  activityTable,
  allocationRecommendationsTable,
  appUsersTable,
  appointmentsTable,
  auditFlagsTable,
  auditScoresTable,
  bonusCalculationsTable,
  bonusRulesTable,
  builderProfilesTable,
  builderRatingsTable,
  companyAccountsTable,
  customersTable,
  docketsTable,
  gpsTracksTable,
  inventoryTransactionsTable,
  invoicesTable,
  jobAssignmentsTable,
  jobReportsTable,
  jobsTable,
  locationVerificationsTable,
  monthlyAwardsTable,
  monthlyRankingsTable,
  notificationsTable,
  profitabilityScoresTable,
  productivitySnapshotsTable,
  pushSubscriptionsTable,
  quotesTable,
  restockRequestsTable,
  scoringWeightsTable,
  stockItemsTable,
  stockItemSupplierPrefsTable,
  subInventoryTable,
  subcontractorsTable,
  supplierOrderItemsTable,
  supplierOrdersTable,
  supplierProfilesTable,
  weeklyInvoicesTable,
  weeklyPlannerProposalsTable,
  workerSkillsTable,
  workSessionsTable,
  xeroSettingsTable,
  type AppUser,
} from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";

const scrypt = promisify(scryptCallback);
const SESSION_COOKIE = "ds_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

export type AppRole = "admin" | "worker";

export interface AuthUser {
  id: number;
  companyId: number;
  companyName: string;
  companySlug: string;
  name: string;
  email: string;
  role: AppRole;
  subcontractorId: number | null;
}

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser;
    }
  }
}

type SessionPayload = {
  sub: number;
  exp: number;
};

function authSecret() {
  return process.env.AUTH_SECRET || process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || "";
}

function toPublicUser(user: AppUser): AuthUser {
  return {
    id: user.id,
    companyId: user.companyId,
    companyName: "",
    companySlug: "",
    name: user.name,
    email: user.email,
    role: user.role as AppRole,
    subcontractorId: user.subcontractorId ?? null,
  };
}

async function toPublicUserWithCompany(user: AppUser): Promise<AuthUser> {
  const [company] = await db
    .select({ name: companyAccountsTable.name, slug: companyAccountsTable.slug })
    .from(companyAccountsTable)
    .where(eq(companyAccountsTable.id, user.companyId));

  return {
    ...toPublicUser(user),
    companyName: company?.name ?? "Company",
    companySlug: company?.slug ?? "",
  };
}

function safeCompare(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function signPayload(payload: string) {
  const secret = authSecret();
  if (!secret) throw new Error("AUTH_SECRET is required for login sessions");
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function createSessionToken(userId: number) {
  const payload = Buffer.from(
    JSON.stringify({
      sub: userId,
      exp: Date.now() + SESSION_TTL_MS,
    } satisfies SessionPayload),
  ).toString("base64url");
  return `${payload}.${signPayload(payload)}`;
}

async function userFromSessionToken(token: string | undefined): Promise<AuthUser | null> {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  try {
    if (!safeCompare(signPayload(payload), signature)) return null;
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionPayload;
    if (!parsed.sub || !parsed.exp || parsed.exp < Date.now()) return null;

    const [user] = await db.select().from(appUsersTable).where(eq(appUsersTable.id, parsed.sub));
    if (!user?.active) return null;
    return toPublicUserWithCompany(user);
  } catch {
    return null;
  }
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  const hash = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${hash.toString("base64url")}`;
}

export async function verifyPassword(password: string, storedHash: string) {
  const [scheme, salt, hash] = storedHash.split(":");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const candidate = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hash, "base64url");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

async function upsertEnvUser(input: {
  companyId: number;
  name: string;
  email: string;
  password: string;
  role: AppRole;
  subcontractorId?: number | null;
}) {
  const email = input.email.trim().toLowerCase();
  const [existing] = await db.select().from(appUsersTable).where(eq(appUsersTable.email, email));
  const passwordHash = existing && (await verifyPassword(input.password, existing.passwordHash))
    ? existing.passwordHash
    : await hashPassword(input.password);

  const values = {
    name: input.name.trim(),
    companyId: input.companyId,
    email,
    role: input.role,
    subcontractorId: input.subcontractorId ?? null,
    passwordHash,
    active: true,
    updatedAt: new Date(),
  };

  if (existing) {
    await db.update(appUsersTable).set(values).where(eq(appUsersTable.id, existing.id));
    return;
  }

  await db.insert(appUsersTable).values(values);
}

function slugifyCompany(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "default-company";
}

async function getOrCreateEnvCompany() {
  const name = process.env.COMPANY_ACCOUNT_NAME?.trim() || process.env.DEFAULT_COMPANY_NAME?.trim() || "Company Account";
  const slug = process.env.COMPANY_ACCOUNT_SLUG?.trim() || slugifyCompany(name);
  const [existing] = await db.select().from(companyAccountsTable).where(eq(companyAccountsTable.slug, slug));
  if (existing) {
    const [updated] = await db
      .update(companyAccountsTable)
      .set({ name, updatedAt: new Date() })
      .where(eq(companyAccountsTable.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db.insert(companyAccountsTable).values({
    name,
    slug,
    status: "trial",
    subscriptionPlan: "trial",
  }).returning();
  return created;
}

async function backfillLegacyCompanyRows(companyId: number) {
  await Promise.all([
    db.update(activityTable).set({ companyId }).where(isNull(activityTable.companyId)),
    db.update(allocationRecommendationsTable).set({ companyId }).where(isNull(allocationRecommendationsTable.companyId)),
    db.update(appointmentsTable).set({ companyId }).where(isNull(appointmentsTable.companyId)),
    db.update(auditFlagsTable).set({ companyId }).where(isNull(auditFlagsTable.companyId)),
    db.update(auditScoresTable).set({ companyId }).where(isNull(auditScoresTable.companyId)),
    db.update(bonusCalculationsTable).set({ companyId }).where(isNull(bonusCalculationsTable.companyId)),
    db.update(bonusRulesTable).set({ companyId }).where(isNull(bonusRulesTable.companyId)),
    db.update(builderProfilesTable).set({ companyId }).where(isNull(builderProfilesTable.companyId)),
    db.update(builderRatingsTable).set({ companyId }).where(isNull(builderRatingsTable.companyId)),
    db.update(customersTable).set({ companyId }).where(isNull(customersTable.companyId)),
    db.update(docketsTable).set({ companyId }).where(isNull(docketsTable.companyId)),
    db.update(gpsTracksTable).set({ companyId }).where(isNull(gpsTracksTable.companyId)),
    db.update(inventoryTransactionsTable).set({ companyId }).where(isNull(inventoryTransactionsTable.companyId)),
    db.update(invoicesTable).set({ companyId }).where(isNull(invoicesTable.companyId)),
    db.update(jobAssignmentsTable).set({ companyId }).where(isNull(jobAssignmentsTable.companyId)),
    db.update(jobReportsTable).set({ companyId }).where(isNull(jobReportsTable.companyId)),
    db.update(jobsTable).set({ companyId }).where(isNull(jobsTable.companyId)),
    db.update(locationVerificationsTable).set({ companyId }).where(isNull(locationVerificationsTable.companyId)),
    db.update(monthlyAwardsTable).set({ companyId }).where(isNull(monthlyAwardsTable.companyId)),
    db.update(monthlyRankingsTable).set({ companyId }).where(isNull(monthlyRankingsTable.companyId)),
    db.update(notificationsTable).set({ companyId }).where(isNull(notificationsTable.companyId)),
    db.update(profitabilityScoresTable).set({ companyId }).where(isNull(profitabilityScoresTable.companyId)),
    db.update(productivitySnapshotsTable).set({ companyId }).where(isNull(productivitySnapshotsTable.companyId)),
    db.update(pushSubscriptionsTable).set({ companyId }).where(isNull(pushSubscriptionsTable.companyId)),
    db.update(quotesTable).set({ companyId }).where(isNull(quotesTable.companyId)),
    db.update(restockRequestsTable).set({ companyId }).where(isNull(restockRequestsTable.companyId)),
    db.update(scoringWeightsTable).set({ companyId }).where(isNull(scoringWeightsTable.companyId)),
    db.update(stockItemsTable).set({ companyId }).where(isNull(stockItemsTable.companyId)),
    db.update(stockItemSupplierPrefsTable).set({ companyId }).where(isNull(stockItemSupplierPrefsTable.companyId)),
    db.update(subInventoryTable).set({ companyId }).where(isNull(subInventoryTable.companyId)),
    db.update(subcontractorsTable).set({ companyId }).where(isNull(subcontractorsTable.companyId)),
    db.update(supplierOrderItemsTable).set({ companyId }).where(isNull(supplierOrderItemsTable.companyId)),
    db.update(supplierOrdersTable).set({ companyId }).where(isNull(supplierOrdersTable.companyId)),
    db.update(supplierProfilesTable).set({ companyId }).where(isNull(supplierProfilesTable.companyId)),
    db.update(weeklyInvoicesTable).set({ companyId }).where(isNull(weeklyInvoicesTable.companyId)),
    db.update(weeklyPlannerProposalsTable).set({ companyId }).where(isNull(weeklyPlannerProposalsTable.companyId)),
    db.update(workerSkillsTable).set({ companyId }).where(isNull(workerSkillsTable.companyId)),
    db.update(workSessionsTable).set({ companyId }).where(isNull(workSessionsTable.companyId)),
    db.update(xeroSettingsTable).set({ companyId }).where(isNull(xeroSettingsTable.companyId)),
  ]);
}

async function resolveWorkerSubcontractorId(companyId: number) {
  const explicitId = Number(process.env.TEST_WORKER_SUBCONTRACTOR_ID);
  if (explicitId) {
    const [existing] = await db
      .select()
      .from(subcontractorsTable)
      .where(and(eq(subcontractorsTable.id, explicitId), eq(subcontractorsTable.companyId, companyId)));
    if (existing) return existing.id;
  }

  const workerEmail = process.env.TEST_WORKER_EMAIL?.trim().toLowerCase();
  const workerName = process.env.TEST_WORKER_NAME?.trim() || "Test Employee/Subcontractor";

  if (workerEmail) {
    const [byEmail] = await db
      .select()
      .from(subcontractorsTable)
      .where(and(eq(subcontractorsTable.email, workerEmail), eq(subcontractorsTable.companyId, companyId)));
    if (byEmail) return byEmail.id;
  }

  const [created] = await db
    .insert(subcontractorsTable)
    .values({
      companyId,
      name: workerName,
      email: workerEmail ?? null,
      active: true,
    })
    .returning();
  return created.id;
}

let envUserSetup: Promise<void> | null = null;

export async function ensureEnvUsers() {
  if (envUserSetup) return envUserSetup;

  envUserSetup = (async () => {
    const company = await getOrCreateEnvCompany();
    await backfillLegacyCompanyRows(company.id);
    const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (adminEmail && adminPassword) {
      await upsertEnvUser({
        companyId: company.id,
        name: process.env.ADMIN_NAME || "Admin User",
        email: adminEmail,
        password: adminPassword,
        role: "admin",
      });
    }

    const workerEmail = process.env.TEST_WORKER_EMAIL?.trim().toLowerCase();
    const workerPassword = process.env.TEST_WORKER_PASSWORD;

    if (workerEmail && workerPassword) {
      await upsertEnvUser({
        companyId: company.id,
        name: process.env.TEST_WORKER_NAME || "Test Employee/Subcontractor",
        email: workerEmail,
        password: workerPassword,
        role: "worker",
        subcontractorId: await resolveWorkerSubcontractorId(company.id),
      });
    }
  })();

  return envUserSetup;
}

export function authSetupStatus() {
  const hasSessionSecret = Boolean(authSecret());
  return {
    configured: hasSessionSecret,
    adminEmailConfigured: Boolean(process.env.ADMIN_EMAIL),
    adminPasswordConfigured: Boolean(process.env.ADMIN_PASSWORD),
    workerConfigured: Boolean(process.env.TEST_WORKER_EMAIL && process.env.TEST_WORKER_PASSWORD),
  };
}

export async function authenticateByEmailPassword(email: string, password: string) {
  await ensureEnvUsers();
  const [user] = await db
    .select()
    .from(appUsersTable)
    .where(eq(appUsersTable.email, email.trim().toLowerCase()));

  if (!user?.active) return null;
  if (!(await verifyPassword(password, user.passwordHash))) return null;
  return toPublicUserWithCompany(user);
}

export function setSessionCookie(res: Response, user: AuthUser) {
  res.cookie(SESSION_COOKIE, createSessionToken(user.id), {
    httpOnly: true,
    maxAge: SESSION_TTL_MS,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, {
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

export async function attachAuthUser(req: Request, _res: Response, next: NextFunction) {
  req.authUser = (await userFromSessionToken(req.cookies?.[SESSION_COOKIE])) ?? undefined;
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.authUser) {
    return res.status(401).json({ error: "Login required" });
  }
  return next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.authUser?.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  return next();
}

export function isAdmin(req: Request) {
  return req.authUser?.role === "admin";
}

export function workerSubcontractorId(req: Request) {
  return req.authUser?.role === "worker" ? req.authUser.subcontractorId : null;
}

export function companyId(req: Request) {
  if (!req.authUser?.companyId) {
    throw new Error("Authenticated user is missing a company account");
  }
  return req.authUser.companyId;
}

export function requireCompany(req: Request, res: Response, next: NextFunction) {
  if (!req.authUser?.companyId) {
    return res.status(403).json({ error: "Company account required" });
  }
  return next();
}

export function sameCompany(req: Request, row: { companyId?: number | null } | null | undefined) {
  return Boolean(row?.companyId && req.authUser?.companyId === row.companyId);
}

export function canAccessSubcontractor(req: Request, subcontractorId: number | null | undefined) {
  if (isAdmin(req)) return true;
  return Boolean(subcontractorId && req.authUser?.subcontractorId === subcontractorId);
}

export function requireSubcontractorAccess(req: Request, res: Response, subcontractorId: number | null | undefined) {
  if (canAccessSubcontractor(req, subcontractorId)) return true;
  res.status(403).json({ error: "You can only access your own employee/subcontractor records" });
  return false;
}

export function workerApiScope(req: Request, res: Response, next: NextFunction) {
  if (isAdmin(req)) return next();

  const path = req.path;
  const method = req.method.toUpperCase();
  const allowed =
    (method === "GET" && (path === "/subcontractors" || /^\/subcontractors\/\d+$/.test(path))) ||
    path.startsWith("/work-sessions") ||
    path.startsWith("/dispatch") ||
    path.startsWith("/job-reports") ||
    (method === "GET" && path === "/stock-items") ||
    path.startsWith("/notifications") ||
    path.startsWith("/push-subscriptions") ||
    (path.startsWith("/location-verifications") && method !== "PATCH");

  if (!allowed) {
    return res.status(403).json({ error: "Employee/subcontractor access is limited to field operations" });
  }

  return next();
}

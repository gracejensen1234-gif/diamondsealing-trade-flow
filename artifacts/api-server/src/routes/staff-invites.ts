import { randomBytes } from "node:crypto";
import { Router, type Request } from "express";
import { db } from "@workspace/db";
import { appUsersTable, staffInvitesTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { companyId, requireAdmin } from "../lib/auth.js";

const router = Router();
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normaliseEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function generateInviteCode() {
  return `SF-${randomBytes(4).toString("hex").toUpperCase()}-${randomBytes(4).toString("hex").toUpperCase()}`;
}

function appBaseUrl(req: Request) {
  const configured = process.env.APP_BASE_URL?.trim() || process.env.PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const proto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0] || req.protocol || "https";
  const host = req.get("host") || "localhost";
  return `${proto}://${host}`;
}

function inviteUrl(req: Request, inviteCode: string) {
  const params = new URLSearchParams({ mode: "staff", invite: inviteCode });
  return `${appBaseUrl(req)}/?${params.toString()}`;
}

function serializeInvite(req: Request, invite: typeof staffInvitesTable.$inferSelect) {
  return {
    ...invite,
    inviteUrl: invite.status === "pending" ? inviteUrl(req, invite.inviteCode) : null,
  };
}

router.get("/staff-invites", requireAdmin, async (req, res) => {
  const rows = await db
    .select()
    .from(staffInvitesTable)
    .where(eq(staffInvitesTable.companyId, companyId(req)))
    .orderBy(desc(staffInvitesTable.createdAt));

  const now = Date.now();
  const expiredPending = rows.filter((row) => row.status === "pending" && row.expiresAt.getTime() < now);
  if (expiredPending.length > 0) {
    await Promise.all(expiredPending.map((row) => (
      db.update(staffInvitesTable)
        .set({ status: "expired", updatedAt: new Date() })
        .where(and(eq(staffInvitesTable.id, row.id), eq(staffInvitesTable.companyId, companyId(req))))
    )));
  }

  return res.json(rows.map((row) => serializeInvite(req, {
    ...row,
    status: row.status === "pending" && row.expiresAt.getTime() < now ? "expired" : row.status,
  })));
});

router.post("/staff-invites", requireAdmin, async (req, res) => {
  const tenantId = companyId(req);
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const email = normaliseEmail(req.body?.email);
  const expiresInDays = Math.min(Math.max(Number(req.body?.expiresInDays) || 14, 1), 90);

  if (name.length > 120) return res.status(400).json({ error: "Name is too long" });
  if (!EMAIL_PATTERN.test(email)) return res.status(400).json({ error: "A valid staff email is required" });

  const [existingUser] = await db.select({ id: appUsersTable.id }).from(appUsersTable).where(eq(appUsersTable.email, email));
  if (existingUser) return res.status(409).json({ error: "An account already exists for this email" });

  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
  let inviteCode = generateInviteCode();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const [existingInvite] = await db.select({ id: staffInvitesTable.id }).from(staffInvitesTable).where(eq(staffInvitesTable.inviteCode, inviteCode));
    if (!existingInvite) break;
    inviteCode = generateInviteCode();
  }

  const [invite] = await db.insert(staffInvitesTable).values({
    companyId: tenantId,
    name: name || null,
    email,
    inviteCode,
    role: "admin",
    status: "pending",
    invitedByUserId: req.authUser?.id ?? null,
    expiresAt,
  }).returning();

  return res.status(201).json(serializeInvite(req, invite));
});

router.patch("/staff-invites/:id/revoke", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid invite id" });

  const [invite] = await db.update(staffInvitesTable)
    .set({ status: "revoked", updatedAt: new Date() })
    .where(and(
      eq(staffInvitesTable.id, id),
      eq(staffInvitesTable.companyId, companyId(req)),
      eq(staffInvitesTable.status, "pending"),
    ))
    .returning();
  if (!invite) return res.status(404).json({ error: "Pending invite not found" });

  return res.json(serializeInvite(req, invite));
});

export default router;

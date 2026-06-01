import { Router } from "express";
import { db } from "@workspace/db";
import { leaveRequestsTable, subcontractorsTable } from "@workspace/db";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { canAccessSubcontractor, companyId, isAdmin, requireAdmin, workerSubcontractorId } from "../lib/auth.js";
import { createAndSendNotification } from "../lib/notificationService";

const router = Router();
const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;

type LeaveStatus = "pending" | "approved" | "declined" | "cancelled";

function formatLeaveRequest(row: typeof leaveRequestsTable.$inferSelect, subcontractorName: string) {
  return {
    ...row,
    subcontractorName,
  };
}

async function findTenantSubcontractor(subcontractorId: number, tenantId: number) {
  const [sub] = await db
    .select()
    .from(subcontractorsTable)
    .where(and(eq(subcontractorsTable.id, subcontractorId), eq(subcontractorsTable.companyId, tenantId)));
  return sub ?? null;
}

function validDate(value: unknown) {
  return typeof value === "string" && dateOnlyPattern.test(value);
}

// GET /leave-requests?subcontractorId=&status=&startDate=&endDate=
router.get("/leave-requests", async (req, res) => {
  const tenantId = companyId(req);
  const requestedSubcontractorId = req.query.subcontractorId ? Number(req.query.subcontractorId) : null;
  const ownSubcontractorId = workerSubcontractorId(req);
  if (ownSubcontractorId && requestedSubcontractorId && requestedSubcontractorId !== ownSubcontractorId) {
    return res.status(403).json({ error: "You can only access your own leave requests" });
  }

  const subcontractorId = ownSubcontractorId ?? requestedSubcontractorId;
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const startDate = typeof req.query.startDate === "string" ? req.query.startDate : "";
  const endDate = typeof req.query.endDate === "string" ? req.query.endDate : "";
  const conditions = [eq(leaveRequestsTable.companyId, tenantId)];

  if (subcontractorId) {
    if (!canAccessSubcontractor(req, subcontractorId)) {
      return res.status(403).json({ error: "You can only access your own leave requests" });
    }
    const sub = await findTenantSubcontractor(subcontractorId, tenantId);
    if (!sub) return res.status(404).json({ error: "Employee/subcontractor not found" });
    conditions.push(eq(leaveRequestsTable.subcontractorId, subcontractorId));
  } else if (!isAdmin(req)) {
    return res.status(403).json({ error: "Employee/subcontractor profile is not linked" });
  }

  if (status) {
    if (!["pending", "approved", "declined", "cancelled"].includes(status)) return res.status(400).json({ error: "Invalid status" });
    conditions.push(eq(leaveRequestsTable.status, status as LeaveStatus));
  }
  if (startDate) {
    if (!validDate(startDate)) return res.status(400).json({ error: "startDate must use YYYY-MM-DD" });
    conditions.push(gte(leaveRequestsTable.dayOffDate, startDate));
  }
  if (endDate) {
    if (!validDate(endDate)) return res.status(400).json({ error: "endDate must use YYYY-MM-DD" });
    conditions.push(lte(leaveRequestsTable.dayOffDate, endDate));
  }

  const rows = await db
    .select()
    .from(leaveRequestsTable)
    .where(and(...conditions))
    .orderBy(desc(leaveRequestsTable.dayOffDate), desc(leaveRequestsTable.createdAt));
  const subs = await db.select().from(subcontractorsTable).where(eq(subcontractorsTable.companyId, tenantId));
  const subMap = new Map(subs.map((s) => [s.id, s.name]));

  return res.json(rows.map((row) => formatLeaveRequest(row, subMap.get(row.subcontractorId) ?? "")));
});

// POST /leave-requests
router.post("/leave-requests", async (req, res) => {
  const tenantId = companyId(req);
  const subcontractorId = workerSubcontractorId(req) ?? Number(req.body?.subcontractorId);
  const dayOffDate = typeof req.body?.dayOffDate === "string" ? req.body.dayOffDate.trim() : "";
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";

  if (!subcontractorId) return res.status(400).json({ error: "subcontractorId is required" });
  if (!canAccessSubcontractor(req, subcontractorId)) return res.status(403).json({ error: "You can only request leave for yourself" });
  if (!validDate(dayOffDate)) return res.status(400).json({ error: "Day off date must use YYYY-MM-DD" });
  if (reason.length > 500) return res.status(400).json({ error: "Reason is too long" });

  const sub = await findTenantSubcontractor(subcontractorId, tenantId);
  if (!sub) return res.status(404).json({ error: "Employee/subcontractor not found" });

  const [row] = await db.insert(leaveRequestsTable).values({
    companyId: tenantId,
    subcontractorId,
    dayOffDate,
    reason: reason || null,
    status: "pending",
  }).returning();

  return res.status(201).json(formatLeaveRequest(row, sub.name));
});

// PATCH /leave-requests/:id
router.patch("/leave-requests/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const tenantId = companyId(req);
  const status = typeof req.body?.status === "string" ? req.body.status.trim() : "";
  const adminNote = typeof req.body?.adminNote === "string" ? req.body.adminNote.trim() : "";

  if (!id) return res.status(400).json({ error: "Invalid id" });
  if (!["approved", "declined"].includes(status)) return res.status(400).json({ error: "Status must be approved or declined" });
  if (adminNote.length > 500) return res.status(400).json({ error: "Admin note is too long" });

  const [existing] = await db
    .select()
    .from(leaveRequestsTable)
    .where(and(eq(leaveRequestsTable.id, id), eq(leaveRequestsTable.companyId, tenantId)));
  if (!existing) return res.status(404).json({ error: "Not found" });

  const [row] = await db
    .update(leaveRequestsTable)
    .set({
      status: status as LeaveStatus,
      adminNote: adminNote || null,
      decidedByUserId: req.authUser?.id ?? null,
      decidedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(leaveRequestsTable.id, id), eq(leaveRequestsTable.companyId, tenantId)))
    .returning();

  const sub = await findTenantSubcontractor(row.subcontractorId, tenantId);
  await createAndSendNotification({
    subcontractorId: row.subcontractorId,
    type: "general",
    title: status === "approved" ? "Day off approved" : "Day off declined",
    body: status === "approved"
      ? `Your day off request for ${row.dayOffDate} was approved.`
      : `Your day off request for ${row.dayOffDate} was declined.${adminNote ? ` ${adminNote}` : ""}`,
    priority: "normal",
    actionUrl: "/field",
    linkedEntityType: "leave_request",
    linkedEntityId: row.id,
  }).catch(() => null);

  return res.json(formatLeaveRequest(row, sub?.name ?? ""));
});

// DELETE /leave-requests/:id
router.delete("/leave-requests/:id", async (req, res) => {
  const id = Number(req.params.id);
  const tenantId = companyId(req);
  if (!id) return res.status(400).json({ error: "Invalid id" });

  const [existing] = await db
    .select()
    .from(leaveRequestsTable)
    .where(and(eq(leaveRequestsTable.id, id), eq(leaveRequestsTable.companyId, tenantId)));
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (!canAccessSubcontractor(req, existing.subcontractorId)) return res.status(403).json({ error: "You can only cancel your own leave requests" });
  if (existing.status !== "pending" && !isAdmin(req)) return res.status(400).json({ error: "Only pending requests can be cancelled" });

  const [row] = await db
    .update(leaveRequestsTable)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(and(eq(leaveRequestsTable.id, id), eq(leaveRequestsTable.companyId, tenantId)))
    .returning();
  const sub = await findTenantSubcontractor(row.subcontractorId, tenantId);

  return res.json(formatLeaveRequest(row, sub?.name ?? ""));
});

export default router;

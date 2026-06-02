import { Router } from "express";
import { db } from "@workspace/db";
import {
  jobReportsTable, jobsTable, subcontractorsTable,
  stockItemsTable, activityTable, jobAssignmentsTable,
  inventoryTransactionsTable, subInventoryTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  CreateJobReportBody,
  GetJobReportParams,
  ListJobReportsQueryParams,
} from "@workspace/api-zod";
import { dateOnlyOrToday } from "../lib/date-utils.js";
import { canAccessSubcontractor, companyId, requireSubcontractorAccess, workerSubcontractorId } from "../lib/auth.js";

const router = Router();

async function enrichReport(r: typeof jobReportsTable.$inferSelect) {
  const tenantId = r.companyId ?? 0;
  const [job] = r.jobId
    ? await db
      .select({ title: jobsTable.title })
      .from(jobsTable)
      .where(and(eq(jobsTable.id, r.jobId), eq(jobsTable.companyId, tenantId)))
    : [null];
  const [sub] = await db
    .select({ name: subcontractorsTable.name })
    .from(subcontractorsTable)
    .where(and(eq(subcontractorsTable.id, r.subcontractorId), eq(subcontractorsTable.companyId, tenantId)));

  const rawStock = Array.isArray(r.stockUsed)
    ? (r.stockUsed as Array<{ stockItemId: number; quantityUsed: number }>)
    : [];

  const enrichedStock = await Promise.all(
    rawStock.map(async (s) => {
      const [item] = await db
        .select()
        .from(stockItemsTable)
        .where(and(eq(stockItemsTable.id, s.stockItemId), eq(stockItemsTable.companyId, tenantId)));
      return {
        stockItemId: s.stockItemId,
        stockItemName: item?.name ?? "Unknown",
        quantityUsed: Number(s.quantityUsed),
        unit: item?.unit ?? "unit",
      };
    }),
  );

  return {
    ...r,
    jobTitle: job?.title ?? null,
    subcontractorName: sub?.name ?? null,
    metersCompleted: Number(r.metersCompleted),
    hoursWorked: r.hoursWorked == null ? null : Number(r.hoursWorked),
    photos: Array.isArray(r.photos) ? r.photos : [],
    silikoneColoursUsed: Array.isArray(r.silikoneColoursUsed) ? r.silikoneColoursUsed : [],
    stockUsed: enrichedStock,
  };
}

router.get("/job-reports", async (req, res) => {
  const parsed = ListJobReportsQueryParams.safeParse({
    ...req.query,
    jobId: req.query.jobId ? Number(req.query.jobId) : undefined,
    subcontractorId: req.query.subcontractorId ? Number(req.query.subcontractorId) : undefined,
    hasIssues:
      req.query.hasIssues === "true"
        ? true
        : req.query.hasIssues === "false"
          ? false
          : undefined,
  });
  if (!parsed.success) return res.status(400).json({ error: "Invalid query" });

  const conditions = [eq(jobReportsTable.companyId, companyId(req))];
  if (parsed.data.jobId) conditions.push(eq(jobReportsTable.jobId, parsed.data.jobId));
  const ownSubcontractorId = workerSubcontractorId(req);
  const subcontractorId = ownSubcontractorId ?? parsed.data.subcontractorId;
  if (subcontractorId) conditions.push(eq(jobReportsTable.subcontractorId, subcontractorId));
  if (parsed.data.date) conditions.push(eq(jobReportsTable.dispatchDate, dateOnlyOrToday(parsed.data.date)));

  let reports = await db
    .select()
    .from(jobReportsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(jobReportsTable.createdAt);

  if (parsed.data.hasIssues === true) {
    reports = reports.filter((r) => r.issueType !== "none");
  }

  const enriched = await Promise.all(reports.map(enrichReport));
  return res.json(enriched);
});

router.post("/job-reports", async (req, res) => {
  const parsed = CreateJobReportBody.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: "Invalid body", details: parsed.error.issues });

  if (!requireSubcontractorAccess(req, res, parsed.data.subcontractorId)) return;

  if (!parsed.data.photos || parsed.data.photos.length === 0) {
    return res.status(400).json({ error: "At least one photo is required" });
  }

  const [job] = await db
    .select({ id: jobsTable.id })
    .from(jobsTable)
    .where(and(eq(jobsTable.id, parsed.data.jobId), eq(jobsTable.companyId, companyId(req))));
  if (!job) return res.status(404).json({ error: "Job not found" });

  if (parsed.data.jobAssignmentId) {
    const [assignment] = await db
      .select()
      .from(jobAssignmentsTable)
      .where(and(eq(jobAssignmentsTable.id, parsed.data.jobAssignmentId), eq(jobAssignmentsTable.companyId, companyId(req))));
    if (!assignment) return res.status(404).json({ error: "Job assignment not found" });
    if (assignment.subcontractorId !== parsed.data.subcontractorId) {
      return res.status(403).json({ error: "This report must match the assigned employee/subcontractor" });
    }
    const [existingReport] = await db
      .select({ id: jobReportsTable.id })
      .from(jobReportsTable)
      .where(and(
        eq(jobReportsTable.jobAssignmentId, parsed.data.jobAssignmentId),
        eq(jobReportsTable.companyId, companyId(req)),
      ))
      .limit(1);
    if (existingReport) return res.status(409).json({ error: "A report has already been submitted for this work block" });
  }

  const stockByItemId = new Map<number, number>();
  for (const usage of parsed.data.stockUsed ?? []) {
    const quantityUsed = Number(usage.quantityUsed);
    if (!Number.isFinite(quantityUsed) || quantityUsed < 0) {
      return res.status(400).json({ error: "Stock quantities must be zero or higher" });
    }
    if (quantityUsed === 0) continue;
    stockByItemId.set(usage.stockItemId, (stockByItemId.get(usage.stockItemId) ?? 0) + quantityUsed);
  }
  const stockUsed = Array.from(stockByItemId.entries()).map(([stockItemId, quantityUsed]) => ({ stockItemId, quantityUsed }));
  const tenantId = companyId(req);

  const inventoryRows = new Map<number, typeof subInventoryTable.$inferSelect>();
  for (const usage of stockUsed) {
    const [stockItem] = await db
      .select({ id: stockItemsTable.id, name: stockItemsTable.name, unit: stockItemsTable.unit })
      .from(stockItemsTable)
      .where(and(eq(stockItemsTable.id, usage.stockItemId), eq(stockItemsTable.companyId, tenantId)));
    if (!stockItem) return res.status(400).json({ error: `Stock item #${usage.stockItemId} is not set up for this company` });

    const [inventory] = await db
      .select()
      .from(subInventoryTable)
      .where(and(
        eq(subInventoryTable.companyId, tenantId),
        eq(subInventoryTable.subcontractorId, parsed.data.subcontractorId),
        eq(subInventoryTable.stockItemId, usage.stockItemId),
      ))
      .limit(1);
    if (!inventory) return res.status(400).json({ error: `${stockItem.name} has not been issued to this employee/subcontractor yet` });

    const currentQuantity = Number(inventory.currentQuantity);
    if (currentQuantity < usage.quantityUsed) {
      return res.status(400).json({
        error: `${stockItem.name}: only ${currentQuantity} ${stockItem.unit} currently recorded, but ${usage.quantityUsed} was entered`,
      });
    }
    inventoryRows.set(usage.stockItemId, inventory);
  }

  const report = await db.transaction(async (tx) => {
    const [createdReport] = await tx
      .insert(jobReportsTable)
      .values({
        companyId: tenantId,
        jobId: parsed.data.jobId,
        jobAssignmentId: parsed.data.jobAssignmentId ?? null,
        subcontractorId: parsed.data.subcontractorId,
        dispatchDate: dateOnlyOrToday(parsed.data.dispatchDate),
        metersCompleted: String(parsed.data.metersCompleted),
        hoursWorked: parsed.data.hoursWorked != null ? String(parsed.data.hoursWorked) : null,
        photos: parsed.data.photos,
        silikoneColoursUsed: parsed.data.silikoneColoursUsed ?? [],
        stockUsed,
        issueType: parsed.data.issueType,
        issueDescription: parsed.data.issueDescription ?? null,
        workDescription: parsed.data.workDescription?.trim() || null,
        generalNotes: parsed.data.generalNotes ?? null,
      })
      .returning();

    for (const usage of stockUsed) {
      const inventory = inventoryRows.get(usage.stockItemId);
      if (!inventory) continue;
      const nextQuantity = Number(inventory.currentQuantity) - usage.quantityUsed;
      await tx.insert(inventoryTransactionsTable).values({
        companyId: tenantId,
        subcontractorId: parsed.data.subcontractorId,
        stockItemId: usage.stockItemId,
        transactionType: "used_on_job",
        quantity: usage.quantityUsed.toString(),
        jobAssignmentId: parsed.data.jobAssignmentId ?? null,
        referenceNote: `Job report #${createdReport.id} - ${parsed.data.metersCompleted}m completed`,
        recordedBy: req.authUser?.email ?? "field",
      });
      await tx
        .update(subInventoryTable)
        .set({ currentQuantity: nextQuantity.toString(), updatedAt: new Date() })
        .where(and(eq(subInventoryTable.id, inventory.id), eq(subInventoryTable.companyId, tenantId)));
    }

    if (parsed.data.jobAssignmentId) {
      await tx
        .update(jobAssignmentsTable)
        .set({ status: "completed", departedAt: new Date() })
        .where(and(eq(jobAssignmentsTable.id, parsed.data.jobAssignmentId), eq(jobAssignmentsTable.companyId, tenantId)));
    }

    await tx.insert(activityTable).values({
      companyId: tenantId,
      type: "job_report_submitted",
      description: `Job report submitted — ${parsed.data.metersCompleted}m completed${stockUsed.length ? `, ${stockUsed.length} stock item${stockUsed.length === 1 ? "" : "s"} used` : ""}`,
      entityId: createdReport.id,
      entityType: "job_report",
    });

    return createdReport;
  });

  return res.status(201).json(await enrichReport(report));
});

router.get("/job-reports/:id", async (req, res) => {
  const parsed = GetJobReportParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });

  const [report] = await db
    .select()
    .from(jobReportsTable)
    .where(and(eq(jobReportsTable.id, parsed.data.id), eq(jobReportsTable.companyId, companyId(req))));
  if (!report) return res.status(404).json({ error: "Not found" });
  if (!canAccessSubcontractor(req, report.subcontractorId)) {
    return res.status(403).json({ error: "You can only view your own job reports" });
  }

  return res.json(await enrichReport(report));
});

export default router;

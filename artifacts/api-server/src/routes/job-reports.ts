import { Router } from "express";
import { db } from "@workspace/db";
import {
  jobReportsTable, jobsTable, subcontractorsTable,
  stockItemsTable, activityTable, jobAssignmentsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  CreateJobReportBody,
  GetJobReportParams,
  ListJobReportsQueryParams,
} from "@workspace/api-zod";

const router = Router();

async function enrichReport(r: typeof jobReportsTable.$inferSelect) {
  const [job] = r.jobId
    ? await db.select({ title: jobsTable.title }).from(jobsTable).where(eq(jobsTable.id, r.jobId))
    : [null];
  const [sub] = await db
    .select({ name: subcontractorsTable.name })
    .from(subcontractorsTable)
    .where(eq(subcontractorsTable.id, r.subcontractorId));

  const rawStock = Array.isArray(r.stockUsed)
    ? (r.stockUsed as Array<{ stockItemId: number; quantityUsed: number }>)
    : [];

  const enrichedStock = await Promise.all(
    rawStock.map(async (s) => {
      const [item] = await db
        .select()
        .from(stockItemsTable)
        .where(eq(stockItemsTable.id, s.stockItemId));
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

  const conditions = [];
  if (parsed.data.jobId) conditions.push(eq(jobReportsTable.jobId, parsed.data.jobId));
  if (parsed.data.subcontractorId)
    conditions.push(eq(jobReportsTable.subcontractorId, parsed.data.subcontractorId));
  if (parsed.data.date) conditions.push(eq(jobReportsTable.dispatchDate, parsed.data.date));

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

  if (!parsed.data.photos || parsed.data.photos.length === 0) {
    return res.status(400).json({ error: "At least one photo is required" });
  }

  const stockUsed = (parsed.data.stockUsed ?? []).map((s) => ({
    stockItemId: s.stockItemId,
    quantityUsed: Number(s.quantityUsed),
  }));

  const [report] = await db
    .insert(jobReportsTable)
    .values({
      jobId: parsed.data.jobId,
      jobAssignmentId: parsed.data.jobAssignmentId ?? null,
      subcontractorId: parsed.data.subcontractorId,
      dispatchDate:
        parsed.data.dispatchDate ?? new Date().toISOString().split("T")[0],
      metersCompleted: String(parsed.data.metersCompleted),
      photos: parsed.data.photos,
      silikoneColoursUsed: parsed.data.silikoneColoursUsed ?? [],
      stockUsed,
      issueType: parsed.data.issueType,
      issueDescription: parsed.data.issueDescription ?? null,
      generalNotes: parsed.data.generalNotes ?? null,
    })
    .returning();

  if (parsed.data.jobAssignmentId) {
    await db
      .update(jobAssignmentsTable)
      .set({ status: "completed", departedAt: new Date() })
      .where(eq(jobAssignmentsTable.id, parsed.data.jobAssignmentId));
  }

  await db.insert(activityTable).values({
    type: "job_report_submitted",
    description: `Job report submitted — ${parsed.data.metersCompleted}m completed`,
    entityId: report.id,
    entityType: "job_report",
  });

  return res.status(201).json(await enrichReport(report));
});

router.get("/job-reports/:id", async (req, res) => {
  const parsed = GetJobReportParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });

  const [report] = await db
    .select()
    .from(jobReportsTable)
    .where(eq(jobReportsTable.id, parsed.data.id));
  if (!report) return res.status(404).json({ error: "Not found" });

  return res.json(await enrichReport(report));
});

export default router;

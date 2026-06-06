import { Router } from "express";
import { db } from "@workspace/db";
import {
  auditFlagsTable,
  jobReportsTable,
  jobsTable,
  subcontractorsTable,
  stockItemsTable,
  activityTable,
  jobAssignmentsTable,
  inventoryTransactionsTable,
  subInventoryTable,
  locationVerificationsTable,
  workSessionsTable,
} from "@workspace/db";
import { eq, and, gte, lte } from "drizzle-orm";
import {
  CreateJobReportBody,
  GetJobReportParams,
  ListJobReportsQueryParams,
} from "@workspace/api-zod";
import { dateOnlyOrToday } from "../lib/date-utils.js";
import {
  canAccessSubcontractor,
  companyId,
  requireAdmin,
  requireSubcontractorAccess,
  workerSubcontractorId,
} from "../lib/auth.js";
import {
  getAuditModel,
  getOpenAIClient,
  hasOpenAIConfig,
} from "../lib/openai-client.js";
import { logger } from "../lib/logger.js";
import {
  cleanupExpiredJobReportPhotos,
  getActiveJobPhotoData,
  getPhotoRetentionCompanyStatus,
  getPhotoRetentionSummary,
} from "../lib/photoRetention.js";
import type OpenAI from "openai";

const router = Router();

type FlagType = (typeof auditFlagsTable.$inferSelect)["flagType"];

type AIAuditFlag = {
  flagType: FlagType;
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
  suggestedAction: string;
};

const VALID_AI_FLAG_TYPES: FlagType[] = [
  "missing_photos",
  "low_photo_count",
  "wrong_colour",
  "unusual_stock_ratio",
  "excessive_break",
  "early_departure",
  "late_arrival",
  "missing_stock_usage",
  "low_metres_vs_time",
  "repeat_callback",
  "incomplete_documentation",
  "safety_concern",
  "missing_builder_contact",
  "photo_quality_concern",
  "inconsistent_data",
  "possible_false_reporting",
  "other",
];

function parseAIFlags(raw: unknown): AIAuditFlag[] {
  if (!Array.isArray(raw)) return [];
  const parsed: AIAuditFlag[] = [];

  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const flag = entry as Record<string, unknown>;
    if (
      typeof flag.flagType !== "string" ||
      !VALID_AI_FLAG_TYPES.includes(flag.flagType as FlagType) ||
      typeof flag.severity !== "string" ||
      !["info", "warning", "critical"].includes(flag.severity) ||
      typeof flag.title !== "string" ||
      typeof flag.description !== "string"
    ) {
      continue;
    }

    parsed.push({
      flagType: flag.flagType as FlagType,
      severity: flag.severity as "info" | "warning" | "critical",
      title: flag.title.slice(0, 120),
      description: flag.description,
      suggestedAction:
        typeof flag.suggestedAction === "string"
          ? flag.suggestedAction
          : "Review the job report and completion photos.",
    });
  }

  return parsed;
}

async function runAutomaticPhotoAudit(
  report: typeof jobReportsTable.$inferSelect,
) {
  if (!hasOpenAIConfig()) return { status: "not_configured", flagsCreated: 0 };

  const imagePhotos = getActiveJobPhotoData(report.photos);
  if (imagePhotos.length === 0) return { status: "no_images", flagsCreated: 0 };

  const tenantId = report.companyId ?? 0;
  const [existingFlag] = await db
    .select({ id: auditFlagsTable.id })
    .from(auditFlagsTable)
    .where(
      and(
        eq(auditFlagsTable.companyId, tenantId),
        eq(auditFlagsTable.jobReportId, report.id),
        eq(auditFlagsTable.aiGenerated, true),
      ),
    )
    .limit(1);
  if (existingFlag) return { status: "already_scanned", flagsCreated: 0 };

  const openai = getOpenAIClient();
  if (!openai) return { status: "not_configured", flagsCreated: 0 };

  const [[sub], [job], assignmentRows] = await Promise.all([
    db
      .select()
      .from(subcontractorsTable)
      .where(
        and(
          eq(subcontractorsTable.id, report.subcontractorId),
          eq(subcontractorsTable.companyId, tenantId),
        ),
      )
      .limit(1),
    db
      .select()
      .from(jobsTable)
      .where(
        and(eq(jobsTable.id, report.jobId), eq(jobsTable.companyId, tenantId)),
      )
      .limit(1),
    report.jobAssignmentId
      ? db
          .select()
          .from(jobAssignmentsTable)
          .where(
            and(
              eq(jobAssignmentsTable.id, report.jobAssignmentId),
              eq(jobAssignmentsTable.companyId, tenantId),
            ),
          )
          .limit(1)
      : Promise.resolve([]),
  ]);
  const assignment = assignmentRows[0] ?? null;

  const rawStock = Array.isArray(report.stockUsed)
    ? (report.stockUsed as Array<{ stockItemId: number; quantityUsed: number }>)
    : [];
  const stockSummary = await Promise.all(
    rawStock.map(async (usage) => {
      const [item] = await db
        .select({
          name: stockItemsTable.name,
          colour: stockItemsTable.colour,
          unit: stockItemsTable.unit,
        })
        .from(stockItemsTable)
        .where(
          and(
            eq(stockItemsTable.id, usage.stockItemId),
            eq(stockItemsTable.companyId, tenantId),
          ),
        )
        .limit(1);
      return `${usage.quantityUsed} ${item?.unit ?? "unit"} ${item?.name ?? `stock #${usage.stockItemId}`}${item?.colour ? ` (${item.colour})` : ""}`;
    }),
  );

  const targetDate = dateOnlyOrToday(report.dispatchDate);
  const locationVerifications = report.jobAssignmentId
    ? await db
        .select()
        .from(locationVerificationsTable)
        .where(
          and(
            eq(locationVerificationsTable.companyId, tenantId),
            eq(
              locationVerificationsTable.jobAssignmentId,
              report.jobAssignmentId,
            ),
          ),
        )
    : await db
        .select()
        .from(locationVerificationsTable)
        .where(
          and(
            eq(locationVerificationsTable.companyId, tenantId),
            eq(
              locationVerificationsTable.subcontractorId,
              report.subcontractorId,
            ),
            gte(
              locationVerificationsTable.createdAt,
              new Date(`${targetDate}T00:00:00`),
            ),
            lte(
              locationVerificationsTable.createdAt,
              new Date(`${targetDate}T23:59:59`),
            ),
          ),
        );

  const requiredColours = Array.isArray(job?.requiredColours)
    ? (job.requiredColours as string[])
    : [];
  const coloursUsed = Array.isArray(report.silikoneColoursUsed)
    ? (report.silikoneColoursUsed as string[])
    : [];
  const summary = [
    `Employee/Subcontractor: ${sub?.name ?? `#${report.subcontractorId}`}`,
    `Job: ${job?.title ?? `#${report.jobId}`}`,
    job?.address ? `Address: ${job.address}` : null,
    assignment?.workArea ? `Work block: ${assignment.workArea}` : null,
    assignment?.notes ? `Assignment notes: ${assignment.notes}` : null,
    `Date: ${targetDate}`,
    `Metres completed: ${Number(report.metersCompleted || 0)}`,
    report.hoursWorked ? `Hours worked: ${Number(report.hoursWorked)}` : null,
    report.workDescription
      ? `Work description: ${report.workDescription}`
      : null,
    requiredColours.length
      ? `Required colours: ${requiredColours.join(", ")}`
      : null,
    coloursUsed.length
      ? `Worker reported colours used: ${coloursUsed.join(", ")}`
      : null,
    stockSummary.length
      ? `Stock used: ${stockSummary.join(", ")}`
      : "Stock used: none recorded",
    `Issue type reported by worker: ${report.issueType || "none"}`,
    report.issueDescription
      ? `Worker issue notes: ${report.issueDescription}`
      : null,
    report.generalNotes ? `General notes: ${report.generalNotes}` : null,
    `Completion photos supplied: ${imagePhotos.length}`,
    locationVerifications.length
      ? `Location checks: ${locationVerifications
          .map(
            (item) =>
              `${item.eventType} ${item.status}${item.distanceMetres ? ` (${Number(item.distanceMetres).toFixed(0)}m away)` : ""}`,
          )
          .join("; ")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const systemPrompt = `You are an AI photo auditor for a joint sealing operations app.
Review completion photos and job report details for admin review only. Do not penalise workers automatically.

Look for genuine concerns such as:
- poor sealant finish, gaps, smearing, missing tooling, messy edges, incomplete joints
- wrong colour or obvious colour mismatch compared with required/reported colours
- missing or unclear photos, photos that do not show completed sealing, unsafe site conditions
- unusual stock usage, metres/hours inconsistencies, incomplete documentation, location concerns

Return JSON only with key "flags" containing an array. Return an empty array when there is no clear concern.
Each flag must include flagType, severity, title, description, suggestedAction.
Valid flagType values: ${VALID_AI_FLAG_TYPES.join(", ")}.
Severity must be info, warning, or critical.
Be conservative: if the photo is simply unclear, use photo_quality_concern instead of inventing a defect.`;

  const userContent: OpenAI.ChatCompletionContentPart[] = [
    { type: "text", text: summary },
    ...imagePhotos.slice(0, 6).map(
      (photo): OpenAI.ChatCompletionContentPartImage => ({
        type: "image_url",
        image_url: { url: photo, detail: "high" },
      }),
    ),
  ];

  const response = await openai.chat.completions.create({
    model: getAuditModel(),
    max_tokens: 1400,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
  });

  const raw = response.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw) as { flags?: unknown[] };
  const aiFlags = parseAIFlags(parsed.flags);

  const inserted = [];
  for (const aiFlag of aiFlags) {
    const [flag] = await db
      .insert(auditFlagsTable)
      .values({
        companyId: tenantId,
        subcontractorId: report.subcontractorId,
        jobReportId: report.id,
        jobAssignmentId: report.jobAssignmentId ?? null,
        flagType: aiFlag.flagType,
        severity: aiFlag.severity,
        title: aiFlag.title,
        description: aiFlag.description,
        evidence: {
          suggestedAction: aiFlag.suggestedAction,
          source: "automatic_job_report_photo_audit",
          model: getAuditModel(),
          photoCount: imagePhotos.length,
        },
        status: "pending",
        aiGenerated: true,
        showToWorker: false,
      })
      .returning();
    inserted.push(flag);
  }

  return { status: "completed", flagsCreated: inserted.length };
}

async function enrichReport(r: typeof jobReportsTable.$inferSelect) {
  const tenantId = r.companyId ?? 0;
  const [job] = r.jobId
    ? await db
        .select({ title: jobsTable.title })
        .from(jobsTable)
        .where(
          and(eq(jobsTable.id, r.jobId), eq(jobsTable.companyId, tenantId)),
        )
    : [null];
  const [sub] = await db
    .select({ name: subcontractorsTable.name })
    .from(subcontractorsTable)
    .where(
      and(
        eq(subcontractorsTable.id, r.subcontractorId),
        eq(subcontractorsTable.companyId, tenantId),
      ),
    );

  const rawStock = Array.isArray(r.stockUsed)
    ? (r.stockUsed as Array<{ stockItemId: number; quantityUsed: number }>)
    : [];

  const enrichedStock = await Promise.all(
    rawStock.map(async (s) => {
      const [item] = await db
        .select()
        .from(stockItemsTable)
        .where(
          and(
            eq(stockItemsTable.id, s.stockItemId),
            eq(stockItemsTable.companyId, tenantId),
          ),
        );
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
    photoRetention: getPhotoRetentionSummary({
      photos: r.photos,
      createdAt: r.createdAt,
    }),
    silikoneColoursUsed: Array.isArray(r.silikoneColoursUsed)
      ? r.silikoneColoursUsed
      : [],
    stockUsed: enrichedStock,
  };
}

router.get("/job-reports", async (req, res) => {
  const parsed = ListJobReportsQueryParams.safeParse({
    ...req.query,
    jobId: req.query.jobId ? Number(req.query.jobId) : undefined,
    subcontractorId: req.query.subcontractorId
      ? Number(req.query.subcontractorId)
      : undefined,
    hasIssues:
      req.query.hasIssues === "true"
        ? true
        : req.query.hasIssues === "false"
          ? false
          : undefined,
  });
  if (!parsed.success) return res.status(400).json({ error: "Invalid query" });

  const conditions = [eq(jobReportsTable.companyId, companyId(req))];
  if (parsed.data.jobId)
    conditions.push(eq(jobReportsTable.jobId, parsed.data.jobId));
  const ownSubcontractorId = workerSubcontractorId(req);
  const subcontractorId = ownSubcontractorId ?? parsed.data.subcontractorId;
  if (subcontractorId)
    conditions.push(eq(jobReportsTable.subcontractorId, subcontractorId));
  if (parsed.data.date)
    conditions.push(
      eq(jobReportsTable.dispatchDate, dateOnlyOrToday(parsed.data.date)),
    );

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

router.get(
  "/job-reports/photo-retention/status",
  requireAdmin,
  async (req, res) => {
    return res.json(await getPhotoRetentionCompanyStatus(companyId(req)));
  },
);

router.post(
  "/job-reports/photo-retention/cleanup",
  requireAdmin,
  async (req, res) => {
    const dryRun = req.body?.dryRun !== false;
    return res.json(
      await cleanupExpiredJobReportPhotos({
        companyId: companyId(req),
        dryRun,
      }),
    );
  },
);

router.post("/job-reports", async (req, res) => {
  const parsed = CreateJobReportBody.safeParse(req.body);
  if (!parsed.success)
    return res
      .status(400)
      .json({ error: "Invalid body", details: parsed.error.issues });

  if (!requireSubcontractorAccess(req, res, parsed.data.subcontractorId))
    return;

  if (workerSubcontractorId(req)) {
    const today = new Date().toISOString().split("T")[0];
    const [session] = await db
      .select()
      .from(workSessionsTable)
      .where(
        and(
          eq(workSessionsTable.companyId, companyId(req)),
          eq(workSessionsTable.subcontractorId, parsed.data.subcontractorId),
          eq(workSessionsTable.date, today),
        ),
      );
    if (!session || session.status === "clocked_off") {
      return res
        .status(400)
        .json({ error: "Clock in before completing this job" });
    }
    if (session.status === "on_break") {
      return res
        .status(400)
        .json({ error: "End break before completing this job" });
    }
  }

  if (!parsed.data.photos || parsed.data.photos.length === 0) {
    return res.status(400).json({ error: "At least one photo is required" });
  }

  const [job] = await db
    .select({ id: jobsTable.id })
    .from(jobsTable)
    .where(
      and(
        eq(jobsTable.id, parsed.data.jobId),
        eq(jobsTable.companyId, companyId(req)),
      ),
    );
  if (!job) return res.status(404).json({ error: "Job not found" });

  if (parsed.data.jobAssignmentId) {
    const [assignment] = await db
      .select()
      .from(jobAssignmentsTable)
      .where(
        and(
          eq(jobAssignmentsTable.id, parsed.data.jobAssignmentId),
          eq(jobAssignmentsTable.companyId, companyId(req)),
        ),
      );
    if (!assignment)
      return res.status(404).json({ error: "Job assignment not found" });
    if (assignment.subcontractorId !== parsed.data.subcontractorId) {
      return res.status(403).json({
        error: "This report must match the assigned employee/subcontractor",
      });
    }
    const [existingReport] = await db
      .select({ id: jobReportsTable.id })
      .from(jobReportsTable)
      .where(
        and(
          eq(jobReportsTable.jobAssignmentId, parsed.data.jobAssignmentId),
          eq(jobReportsTable.companyId, companyId(req)),
        ),
      )
      .limit(1);
    if (existingReport)
      return res.status(409).json({
        error: "A report has already been submitted for this work block",
      });
  }

  const stockByItemId = new Map<number, number>();
  for (const usage of parsed.data.stockUsed ?? []) {
    const quantityUsed = Number(usage.quantityUsed);
    if (!Number.isFinite(quantityUsed) || quantityUsed < 0) {
      return res
        .status(400)
        .json({ error: "Stock quantities must be zero or higher" });
    }
    if (quantityUsed === 0) continue;
    stockByItemId.set(
      usage.stockItemId,
      (stockByItemId.get(usage.stockItemId) ?? 0) + quantityUsed,
    );
  }
  const stockUsed = Array.from(stockByItemId.entries()).map(
    ([stockItemId, quantityUsed]) => ({ stockItemId, quantityUsed }),
  );
  const tenantId = companyId(req);
  if (parsed.data.metersCompleted > 0 && stockUsed.length === 0) {
    return res.status(400).json({
      error: "Stock usage is required when submitting completed metres",
    });
  }

  const inventoryRows = new Map<
    number,
    typeof subInventoryTable.$inferSelect
  >();
  for (const usage of stockUsed) {
    const [stockItem] = await db
      .select({
        id: stockItemsTable.id,
        name: stockItemsTable.name,
        unit: stockItemsTable.unit,
      })
      .from(stockItemsTable)
      .where(
        and(
          eq(stockItemsTable.id, usage.stockItemId),
          eq(stockItemsTable.companyId, tenantId),
        ),
      );
    if (!stockItem)
      return res.status(400).json({
        error: `Stock item #${usage.stockItemId} is not set up for this company`,
      });

    const [inventory] = await db
      .select()
      .from(subInventoryTable)
      .where(
        and(
          eq(subInventoryTable.companyId, tenantId),
          eq(subInventoryTable.subcontractorId, parsed.data.subcontractorId),
          eq(subInventoryTable.stockItemId, usage.stockItemId),
        ),
      )
      .limit(1);
    if (!inventory)
      return res.status(400).json({
        error: `${stockItem.name} has not been issued to this employee/subcontractor yet`,
      });

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
        hoursWorked:
          parsed.data.hoursWorked != null
            ? String(parsed.data.hoursWorked)
            : null,
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
      const nextQuantity =
        Number(inventory.currentQuantity) - usage.quantityUsed;
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
        .set({
          currentQuantity: nextQuantity.toString(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(subInventoryTable.id, inventory.id),
            eq(subInventoryTable.companyId, tenantId),
          ),
        );
    }

    if (parsed.data.jobAssignmentId) {
      await tx
        .update(jobAssignmentsTable)
        .set({ status: "completed", departedAt: new Date() })
        .where(
          and(
            eq(jobAssignmentsTable.id, parsed.data.jobAssignmentId),
            eq(jobAssignmentsTable.companyId, tenantId),
          ),
        );
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

  const aiAuditQueued = hasOpenAIConfig();
  if (aiAuditQueued) {
    void runAutomaticPhotoAudit(report)
      .then((result) => {
        logger.info(
          { reportId: report.id, jobId: report.jobId, ...result },
          "automatic AI photo audit finished",
        );
      })
      .catch((err) => {
        logger.warn(
          { err, reportId: report.id, jobId: report.jobId },
          "automatic AI photo audit failed",
        );
      });
  }

  return res
    .status(201)
    .json({ ...(await enrichReport(report)), aiAuditQueued });
});

router.get("/job-reports/:id", async (req, res) => {
  const parsed = GetJobReportParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });

  const [report] = await db
    .select()
    .from(jobReportsTable)
    .where(
      and(
        eq(jobReportsTable.id, parsed.data.id),
        eq(jobReportsTable.companyId, companyId(req)),
      ),
    );
  if (!report) return res.status(404).json({ error: "Not found" });
  if (!canAccessSubcontractor(req, report.subcontractorId)) {
    return res
      .status(403)
      .json({ error: "You can only view your own job reports" });
  }

  return res.json(await enrichReport(report));
});

export default router;

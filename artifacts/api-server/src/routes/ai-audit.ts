import { Router } from "express";
import { db } from "@workspace/db";
import {
  auditFlagsTable,
  auditScoresTable,
  subcontractorsTable,
  jobReportsTable,
  jobAssignmentsTable,
  workSessionsTable,
  docketsTable,
  locationVerificationsTable,
} from "@workspace/db";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { createAndSendNotification } from "../lib/notificationService.js";
import {
  getAuditModel,
  getOpenAIClient,
  hasOpenAIConfig,
} from "../lib/openai-client.js";
import { workSessionMinutes } from "../lib/date-utils.js";
import { companyId } from "../lib/auth.js";
import {
  getActiveJobPhotoData,
  getJobPhotoEntries,
} from "../lib/photoRetention.js";
import type OpenAI from "openai";

const router = Router();

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuditRule {
  type: string;
  severity: "info" | "warning" | "critical";
  title: string;
  check: (data: AuditContext) => {
    triggered: boolean;
    description: string;
    evidence: Record<string, unknown>;
  };
}

interface AuditContext {
  subcontractorId: number;
  date: string;
  reports: (typeof jobReportsTable.$inferSelect)[];
  sessions: (typeof workSessionsTable.$inferSelect)[];
  dockets: (typeof docketsTable.$inferSelect)[];
}

type FlagType = (typeof auditFlagsTable.$inferSelect)["flagType"];

interface AIAuditFlag {
  flagType: FlagType;
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
  suggestedAction: string;
  jobReportId?: number;
}

// ─── Rule-based checks ────────────────────────────────────────────────────────

const AUDIT_RULES: AuditRule[] = [
  {
    type: "missing_photos",
    severity: "warning",
    title: "Job completed without photos",
    check({ reports }) {
      const missing = reports.filter((r) => {
        const photos = getJobPhotoEntries(r.photos);
        return photos.length === 0;
      });
      return {
        triggered: missing.length > 0,
        description: `${missing.length} job report(s) submitted without any photos.`,
        evidence: { jobReportIds: missing.map((r) => r.id) },
      };
    },
  },
  {
    type: "low_metres",
    severity: "info",
    title: "Below average daily metres",
    check({ reports, sessions }) {
      const totalMetres = reports.reduce(
        (a, r) => a + Number(r.metersCompleted || 0),
        0,
      );
      const workMinutes = sessions.reduce(
        (a, s) => a + workSessionMinutes(s),
        0,
      );
      const mPerHour =
        workMinutes > 0 ? totalMetres / (workMinutes / 60) : null;
      const triggered = mPerHour !== null && mPerHour < 4 && workMinutes > 60;
      return {
        triggered,
        description: triggered
          ? `Productivity of ${mPerHour?.toFixed(1)} m/hr is below the 4 m/hr threshold.`
          : "Productivity is acceptable.",
        evidence: { totalMetres, workMinutes, metresPerHour: mPerHour },
      };
    },
  },
  {
    type: "long_shift",
    severity: "warning",
    title: "Unusually long shift",
    check({ sessions }) {
      const long = sessions.filter((s) => workSessionMinutes(s) > 600);
      return {
        triggered: long.length > 0,
        description:
          long.length > 0
            ? `Shift of ${Math.round((workSessionMinutes(long[0]) / 60) * 10) / 10} hours detected (>10hr).`
            : "",
        evidence: { sessionIds: long.map((s) => s.id) },
      };
    },
  },
  {
    type: "no_report_submitted",
    severity: "critical",
    title: "Clocked in but no job report submitted",
    check({ reports, sessions }) {
      const hasSession = sessions.some((s) => s.clockedOnAt);
      return {
        triggered: hasSession && reports.length === 0,
        description:
          "Subcontractor clocked in but submitted no job completion reports.",
        evidence: { sessionCount: sessions.length },
      };
    },
  },
  {
    type: "missing_stock_usage",
    severity: "info",
    title: "Job report missing stock usage",
    check({ reports }) {
      const missing = reports.filter((r) => {
        const stock = (r.stockUsed as unknown[]) ?? [];
        return stock.length === 0;
      });
      return {
        triggered: missing.length > 0,
        description: `${missing.length} job report(s) submitted without recording any stock usage.`,
        evidence: { jobReportIds: missing.map((r) => r.id) },
      };
    },
  },
  {
    type: "unsigned_docket",
    severity: "warning",
    title: "Docket not fully signed",
    check({ dockets }) {
      const unsigned = dockets.filter(
        (d) => !d.builderSigned || !d.subcontractorSigned,
      );
      return {
        triggered: unsigned.length > 0,
        description: `${unsigned.length} docket(s) missing signatures.`,
        evidence: { docketIds: unsigned.map((d) => d.id) },
      };
    },
  },
];

function calcScoreFromFlags(
  flags: (typeof auditFlagsTable.$inferSelect)[],
): number {
  let score = 100;
  for (const flag of flags) {
    if (flag.severity === "critical") score -= 20;
    else if (flag.severity === "warning") score -= 10;
    else score -= 3;
  }
  return Math.max(0, Math.min(100, score));
}

// ─── AI analysis helper ───────────────────────────────────────────────────────

const VALID_FLAG_TYPES: FlagType[] = [
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

async function runAIAnalysis(
  sub: { id: number; name: string },
  date: string,
  reports: (typeof jobReportsTable.$inferSelect)[],
  locationVerifications: (typeof locationVerificationsTable.$inferSelect)[],
): Promise<AIAuditFlag[]> {
  if (reports.length === 0) return [];
  const openai = getOpenAIClient();
  if (!openai) {
    throw new Error(
      "OPENAI_API_KEY is not configured. Add it to the server environment before running AI photo audits.",
    );
  }

  const systemPrompt = `You are a quality audit assistant for a joint sealing subcontractor company.
Analyse the job report data and completion photos provided and flag genuine quality, safety, or compliance concerns for admin review.
You do NOT penalise employees/subcontractors automatically — your flags are suggestions for a human admin to review.
Only flag real concerns. Do not invent issues. If everything looks fine, return an empty array.

Return a JSON object with a single key "flags" containing an array. Each flag must have:
- flagType: one of [missing_photos, low_photo_count, wrong_colour, unusual_stock_ratio, excessive_break, early_departure, late_arrival, missing_stock_usage, low_metres_vs_time, repeat_callback, incomplete_documentation, safety_concern, missing_builder_contact, photo_quality_concern, inconsistent_data, possible_false_reporting, other]
- severity: "info", "warning", or "critical"
- title: short title (max 8 words)
- description: clear explanation for admin review (2-3 sentences)
- suggestedAction: concrete follow-up action for the admin
- jobReportId: (optional) the id of the specific job report this flag relates to`;

  const summaryParts: string[] = [
    `Employee/Subcontractor: ${sub.name}`,
    `Date: ${date}`,
    `Job reports submitted: ${reports.length}`,
  ];

  const photoItems: OpenAI.ChatCompletionContentPartImage[] = [];

  for (const report of reports) {
    const photos = getJobPhotoEntries(report.photos);
    const activePhotos = getActiveJobPhotoData(report.photos);
    const stock =
      (report.stockUsed as { itemName?: string; quantity?: number }[]) ?? [];
    const metres = Number(report.metersCompleted || 0);

    summaryParts.push(
      `\nJob Report ID ${report.id}:`,
      `  Metres completed: ${metres}`,
      `  Stock used: ${stock.length > 0 ? stock.map((s) => `${s.quantity ?? "?"} x ${s.itemName ?? "unknown"}`).join(", ") : "none recorded"}`,
      `  Issue type: ${report.issueType || "none"}`,
      report.issueDescription
        ? `  Issue description: ${report.issueDescription}`
        : "",
      report.generalNotes ? `  Notes: ${report.generalNotes}` : "",
      `  Completion photos recorded: ${photos.length}`,
      `  Completion photos available for AI review: ${activePhotos.length}`,
    );

    const photosToSend = activePhotos.slice(0, 4);
    for (const photo of photosToSend) {
      photoItems.push({
        type: "image_url",
        image_url: { url: photo, detail: "low" },
      });
    }
  }

  if (locationVerifications.length > 0) {
    summaryParts.push("\nLocation verification events:");
    for (const lv of locationVerifications) {
      const dist = lv.distanceMetres
        ? `${Number(lv.distanceMetres).toFixed(0)}m from job`
        : "";
      summaryParts.push(
        `  ${lv.eventType}: ${lv.status}${dist ? " (" + dist + ")" : ""}`,
      );
    }
  }

  const userContent: OpenAI.ChatCompletionContentPart[] = [
    { type: "text", text: summaryParts.filter(Boolean).join("\n") },
    ...photoItems,
  ];

  const response = await openai.chat.completions.create({
    model: getAuditModel(),
    max_tokens: 1500,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
  });

  const raw = response.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw) as { flags?: unknown[] };
  const flags = Array.isArray(parsed.flags) ? parsed.flags : [];

  return flags.filter((f): f is AIAuditFlag => {
    if (typeof f !== "object" || f === null) return false;
    const flag = f as Record<string, unknown>;
    return (
      typeof flag.flagType === "string" &&
      VALID_FLAG_TYPES.includes(flag.flagType as FlagType) &&
      typeof flag.severity === "string" &&
      ["info", "warning", "critical"].includes(flag.severity) &&
      typeof flag.title === "string" &&
      typeof flag.description === "string"
    );
  });
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /audit/ai-status
router.get("/audit/ai-status", (_req, res) => {
  return res.json({
    configured: hasOpenAIConfig(),
    model: getAuditModel(),
    message: hasOpenAIConfig()
      ? "AI photo auditing is ready."
      : "OPENAI_API_KEY is not configured. Add it to the server environment before running AI photo audits.",
  });
});

// POST /audit/run  (rule-based)
router.post("/audit/run", async (req, res) => {
  const { subcontractorId, date } = req.body;
  const tenantId = companyId(req);
  const targetDate = date || new Date().toISOString().split("T")[0];
  const targetSubId = subcontractorId ? Number(subcontractorId) : null;

  const subs = targetSubId
    ? await db
        .select()
        .from(subcontractorsTable)
        .where(
          and(
            eq(subcontractorsTable.id, targetSubId),
            eq(subcontractorsTable.companyId, tenantId),
          ),
        )
    : await db
        .select()
        .from(subcontractorsTable)
        .where(
          and(
            eq(subcontractorsTable.companyId, tenantId),
            eq(subcontractorsTable.active, true),
          ),
        );

  const allFlags: (typeof auditFlagsTable.$inferSelect & {
    subcontractorName: string;
  })[] = [];

  for (const sub of subs) {
    const reports = await db
      .select()
      .from(jobReportsTable)
      .where(
        and(
          eq(jobReportsTable.companyId, tenantId),
          eq(jobReportsTable.subcontractorId, sub.id),
          eq(jobReportsTable.dispatchDate, targetDate),
        ),
      );

    const sessions = await db
      .select()
      .from(workSessionsTable)
      .where(
        and(
          eq(workSessionsTable.companyId, tenantId),
          eq(workSessionsTable.subcontractorId, sub.id),
          eq(workSessionsTable.date, targetDate),
        ),
      );

    const dockets = await db
      .select()
      .from(docketsTable)
      .where(
        and(
          eq(docketsTable.companyId, tenantId),
          eq(docketsTable.subcontractorId, sub.id),
        ),
      );

    if (sessions.length === 0 && reports.length === 0) continue;

    const ctx: AuditContext = {
      subcontractorId: sub.id,
      date: targetDate,
      reports,
      sessions,
      dockets,
    };

    for (const rule of AUDIT_RULES) {
      const result = rule.check(ctx);
      if (!result.triggered) continue;

      const [flag] = await db
        .insert(auditFlagsTable)
        .values({
          companyId: tenantId,
          subcontractorId: sub.id,
          flagType: rule.type as FlagType,
          severity: rule.severity,
          title: rule.title,
          description: result.description,
          evidence: result.evidence,
          status: "pending",
          aiGenerated: false,
          showToWorker: rule.severity !== "info",
        })
        .returning();

      allFlags.push({ ...flag, subcontractorName: sub.name });
    }
  }

  return res.json(allFlags);
});

// POST /audit/ai-run  (AI-powered analysis)
router.post("/audit/ai-run", async (req, res) => {
  if (!hasOpenAIConfig()) {
    return res.status(400).json({
      error: "OpenAI is not configured",
      message:
        "OPENAI_API_KEY is not configured. Add it to the server environment before running AI photo audits.",
    });
  }

  const { subcontractorId, date } = req.body;
  const tenantId = companyId(req);
  const targetDate =
    (date as string | undefined) || new Date().toISOString().split("T")[0];
  const targetSubId = subcontractorId ? Number(subcontractorId) : null;

  const subs = targetSubId
    ? await db
        .select()
        .from(subcontractorsTable)
        .where(
          and(
            eq(subcontractorsTable.id, targetSubId),
            eq(subcontractorsTable.companyId, tenantId),
          ),
        )
    : await db
        .select()
        .from(subcontractorsTable)
        .where(
          and(
            eq(subcontractorsTable.companyId, tenantId),
            eq(subcontractorsTable.active, true),
          ),
        );

  const results: {
    subcontractorId: number;
    subcontractorName: string;
    flagsCreated: number;
    flags: (typeof auditFlagsTable.$inferSelect)[];
    error?: string;
  }[] = [];

  for (const sub of subs) {
    const [reports, locationVerifications] = await Promise.all([
      db
        .select()
        .from(jobReportsTable)
        .where(
          and(
            eq(jobReportsTable.companyId, tenantId),
            eq(jobReportsTable.subcontractorId, sub.id),
            eq(jobReportsTable.dispatchDate, targetDate),
          ),
        ),
      db
        .select()
        .from(locationVerificationsTable)
        .where(
          and(
            eq(locationVerificationsTable.companyId, tenantId),
            eq(locationVerificationsTable.subcontractorId, sub.id),
            gte(
              locationVerificationsTable.createdAt,
              new Date(`${targetDate}T00:00:00`),
            ),
            lte(
              locationVerificationsTable.createdAt,
              new Date(`${targetDate}T23:59:59`),
            ),
          ),
        ),
    ]);

    if (reports.length === 0) {
      results.push({
        subcontractorId: sub.id,
        subcontractorName: sub.name,
        flagsCreated: 0,
        flags: [],
      });
      continue;
    }

    let aiFlags: AIAuditFlag[] = [];
    let analysisError: string | undefined;

    try {
      aiFlags = await runAIAnalysis(
        sub,
        targetDate,
        reports,
        locationVerifications,
      );
    } catch (err) {
      req.log.error(
        { err, subcontractorId: sub.id },
        "AI audit analysis failed",
      );
      analysisError = err instanceof Error ? err.message : "Unknown error";
    }

    const insertedFlags: (typeof auditFlagsTable.$inferSelect)[] = [];

    for (const aiFlag of aiFlags) {
      const reportId =
        typeof aiFlag.jobReportId === "number"
          ? reports.find((r) => r.id === aiFlag.jobReportId)?.id
          : undefined;

      if (reportId) {
        const [existingFlag] = await db
          .select({ id: auditFlagsTable.id })
          .from(auditFlagsTable)
          .where(
            and(
              eq(auditFlagsTable.companyId, tenantId),
              eq(auditFlagsTable.jobReportId, reportId),
              eq(auditFlagsTable.flagType, aiFlag.flagType),
              eq(auditFlagsTable.aiGenerated, true),
            ),
          )
          .limit(1);
        if (existingFlag) continue;
      }

      const [flag] = await db
        .insert(auditFlagsTable)
        .values({
          companyId: tenantId,
          subcontractorId: sub.id,
          jobReportId: reportId ?? null,
          flagType: aiFlag.flagType,
          severity: aiFlag.severity,
          title: aiFlag.title,
          description: aiFlag.description,
          evidence: { suggestedAction: aiFlag.suggestedAction },
          status: "pending",
          aiGenerated: true,
          showToWorker: false,
        })
        .returning();

      insertedFlags.push(flag);
    }

    results.push({
      subcontractorId: sub.id,
      subcontractorName: sub.name,
      flagsCreated: insertedFlags.length,
      flags: insertedFlags,
      ...(analysisError ? { error: analysisError } : {}),
    });
  }

  return res.json(results);
});

// GET /audit/flags
router.get("/audit/flags", async (req, res) => {
  const tenantId = companyId(req);
  const flags = await db
    .select()
    .from(auditFlagsTable)
    .where(eq(auditFlagsTable.companyId, tenantId))
    .orderBy(desc(auditFlagsTable.createdAt));
  const subs = await db
    .select()
    .from(subcontractorsTable)
    .where(eq(subcontractorsTable.companyId, tenantId));
  const subMap = new Map(subs.map((s) => [s.id, s.name]));

  let filtered = flags;
  if (req.query.subcontractorId)
    filtered = filtered.filter(
      (f) => f.subcontractorId === Number(req.query.subcontractorId),
    );
  if (req.query.status)
    filtered = filtered.filter((f) => f.status === req.query.status);
  if (req.query.severity)
    filtered = filtered.filter((f) => f.severity === req.query.severity);
  if (req.query.startDate)
    filtered = filtered.filter(
      (f) => f.createdAt >= new Date(req.query.startDate as string),
    );
  if (req.query.aiGenerated !== undefined)
    filtered = filtered.filter(
      (f) => f.aiGenerated === (req.query.aiGenerated === "true"),
    );

  return res.json(
    filtered.map((f) => ({
      ...f,
      subcontractorName: subMap.get(f.subcontractorId) ?? "",
    })),
  );
});

// PATCH /audit/flags/:id
router.patch("/audit/flags/:id", async (req, res) => {
  const { status, adminNotes, workerFeedback, showToWorker } = req.body;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (status) updates.status = status;
  if (adminNotes !== undefined) updates.adminNotes = adminNotes;
  if (workerFeedback !== undefined) updates.workerFeedback = workerFeedback;
  if (showToWorker !== undefined) updates.showToWorker = showToWorker;

  const [flag] = await db
    .update(auditFlagsTable)
    .set(updates)
    .where(
      and(
        eq(auditFlagsTable.id, Number(req.params.id)),
        eq(auditFlagsTable.companyId, companyId(req)),
      ),
    )
    .returning();
  if (!flag) return res.status(404).json({ error: "Not found" });

  const [sub] = await db
    .select({ name: subcontractorsTable.name })
    .from(subcontractorsTable)
    .where(
      and(
        eq(subcontractorsTable.id, flag.subcontractorId),
        eq(subcontractorsTable.companyId, companyId(req)),
      ),
    );

  if (status === "fix_requested" || showToWorker === true) {
    try {
      await createAndSendNotification({
        subcontractorId: flag.subcontractorId,
        type: "audit_fix_request",
        title: "Audit follow-up requested",
        body: `${flag.title}: ${adminNotes || "Please review this job audit item."}`,
        priority: flag.severity === "critical" ? "high" : "normal",
        actionUrl: "/notifications",
        linkedEntityType: "audit_flag",
        linkedEntityId: flag.id,
      });
    } catch (err) {
      req.log.warn(
        { err, auditFlagId: flag.id },
        "Failed to send audit fix notification",
      );
    }
  }

  return res.json({ ...flag, subcontractorName: sub?.name ?? "" });
});

// GET /audit/scores
router.get("/audit/scores", async (req, res) => {
  const tenantId = companyId(req);
  const scores = await db
    .select()
    .from(auditScoresTable)
    .where(eq(auditScoresTable.companyId, tenantId))
    .orderBy(desc(auditScoresTable.calculatedAt));
  const subs = await db
    .select()
    .from(subcontractorsTable)
    .where(eq(subcontractorsTable.companyId, tenantId));
  const subMap = new Map(subs.map((s) => [s.id, s.name]));

  let filtered = scores;
  if (req.query.subcontractorId)
    filtered = filtered.filter(
      (s) => s.subcontractorId === Number(req.query.subcontractorId),
    );
  if (req.query.periodType)
    filtered = filtered.filter((s) => s.periodType === req.query.periodType);
  if (req.query.periodStart)
    filtered = filtered.filter((s) => s.periodStart === req.query.periodStart);

  return res.json(
    filtered.map((s) => ({
      ...s,
      subcontractorName: subMap.get(s.subcontractorId) ?? "",
      overallScore: Number(s.overallScore),
      photoComplianceScore: s.photoComplianceScore
        ? Number(s.photoComplianceScore)
        : null,
      punctualityScore: s.punctualityScore ? Number(s.punctualityScore) : null,
      productivityScore: s.productivityScore
        ? Number(s.productivityScore)
        : null,
      documentationScore: s.documentationScore
        ? Number(s.documentationScore)
        : null,
      stockAccuracyScore: s.stockAccuracyScore
        ? Number(s.stockAccuracyScore)
        : null,
      safetyScore: s.safetyScore ? Number(s.safetyScore) : null,
      callbackRate: s.callbackRate ? Number(s.callbackRate) : null,
      adminOverrideScore: s.adminOverrideScore
        ? Number(s.adminOverrideScore)
        : null,
    })),
  );
});

// POST /audit/scores/calculate
router.post("/audit/scores/calculate", async (req, res) => {
  const { periodType, periodStart, subcontractorId } = req.body;
  const tenantId = companyId(req);
  if (!periodType || !periodStart)
    return res
      .status(400)
      .json({ error: "periodType and periodStart required" });

  let periodEnd = periodStart;
  if (periodType === "weekly") {
    const d = new Date(periodStart);
    d.setDate(d.getDate() + 6);
    periodEnd = d.toISOString().split("T")[0];
  } else if (periodType === "monthly") {
    const d = new Date(periodStart);
    d.setMonth(d.getMonth() + 1);
    d.setDate(d.getDate() - 1);
    periodEnd = d.toISOString().split("T")[0];
  }

  const subs = subcontractorId
    ? await db
        .select()
        .from(subcontractorsTable)
        .where(
          and(
            eq(subcontractorsTable.id, Number(subcontractorId)),
            eq(subcontractorsTable.companyId, tenantId),
          ),
        )
    : await db
        .select()
        .from(subcontractorsTable)
        .where(
          and(
            eq(subcontractorsTable.companyId, tenantId),
            eq(subcontractorsTable.active, true),
          ),
        );

  const results = await Promise.all(
    subs.map(async (sub) => {
      const flags = await db
        .select()
        .from(auditFlagsTable)
        .where(
          and(
            eq(auditFlagsTable.companyId, tenantId),
            eq(auditFlagsTable.subcontractorId, sub.id),
            gte(auditFlagsTable.createdAt, new Date(periodStart)),
            lte(auditFlagsTable.createdAt, new Date(`${periodEnd}T23:59:59`)),
          ),
        );

      const criticalCount = flags.filter(
        (f) => f.severity === "critical",
      ).length;

      const photoFlags = flags.filter(
        (f) =>
          f.flagType === "missing_photos" ||
          f.flagType === "low_photo_count" ||
          f.flagType === "photo_quality_concern",
      );
      const photoScore = Math.max(0, 100 - photoFlags.length * 20);

      const punctualityFlags = flags.filter(
        (f) => f.flagType === "late_arrival",
      );
      const punctualityScore = Math.max(0, 100 - punctualityFlags.length * 15);

      const productivityFlags = flags.filter(
        (f) => f.flagType === "low_metres_vs_time",
      );
      const productivityScore = Math.max(
        0,
        100 - productivityFlags.length * 15,
      );

      const docFlags = flags.filter((f) =>
        [
          "no_report_submitted",
          "missing_stock_usage",
          "incomplete_documentation",
        ].includes(f.flagType),
      );
      const documentationScore = Math.max(0, 100 - docFlags.length * 15);

      const overallScore = calcScoreFromFlags(flags);

      const values = {
        companyId: tenantId,
        subcontractorId: sub.id,
        periodType,
        periodStart,
        overallScore: overallScore.toString(),
        photoComplianceScore: photoScore.toString(),
        punctualityScore: punctualityScore.toString(),
        productivityScore: productivityScore.toString(),
        documentationScore: documentationScore.toString(),
        flagCount: flags.length,
        criticalFlagCount: criticalCount,
        adminOverride: false,
        calculatedAt: new Date(),
      };

      const existing = await db
        .select()
        .from(auditScoresTable)
        .where(
          and(
            eq(auditScoresTable.companyId, tenantId),
            eq(auditScoresTable.subcontractorId, sub.id),
            eq(auditScoresTable.periodType, periodType),
            eq(auditScoresTable.periodStart, periodStart),
          ),
        )
        .limit(1);

      const [score] = existing.length
        ? await db
            .update(auditScoresTable)
            .set(values)
            .where(
              and(
                eq(auditScoresTable.id, existing[0].id),
                eq(auditScoresTable.companyId, tenantId),
              ),
            )
            .returning()
        : await db.insert(auditScoresTable).values(values).returning();

      return {
        ...score,
        subcontractorName: sub.name,
        overallScore: Number(score.overallScore),
      };
    }),
  );

  return res.json(results);
});

export default router;

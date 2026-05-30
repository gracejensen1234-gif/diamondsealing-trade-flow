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
} from "@workspace/db";
import { eq, and, gte, lte, desc, count } from "drizzle-orm";

const router = Router();

interface AuditRule {
  type: string;
  severity: "info" | "warning" | "critical";
  title: string;
  check: (data: AuditContext) => { triggered: boolean; description: string; evidence: Record<string, unknown> };
}

interface AuditContext {
  subcontractorId: number;
  date: string;
  reports: typeof jobReportsTable.$inferSelect[];
  sessions: typeof workSessionsTable.$inferSelect[];
  dockets: typeof docketsTable.$inferSelect[];
}

const AUDIT_RULES: AuditRule[] = [
  {
    type: "missing_photos",
    severity: "warning",
    title: "Job completed without photos",
    check({ reports }) {
      const missing = reports.filter((r) => {
        const photos = (r.photos as string[]) ?? [];
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
      const totalMetres = reports.reduce((a, r) => a + Number(r.metersCompleted || 0), 0);
      const workMinutes = sessions.reduce((a, s) => a + (s.totalWorkMinutes || 0), 0);
      const mPerHour = workMinutes > 0 ? totalMetres / (workMinutes / 60) : null;
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
      const long = sessions.filter((s) => (s.totalWorkMinutes || 0) > 600);
      return {
        triggered: long.length > 0,
        description: long.length > 0 ? `Shift of ${Math.round((long[0].totalWorkMinutes || 0) / 60 * 10) / 10} hours detected (>10hr).` : "",
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
        description: "Subcontractor clocked in but submitted no job completion reports.",
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
      const unsigned = dockets.filter((d) => !d.builderSigned || !d.subcontractorSigned);
      return {
        triggered: unsigned.length > 0,
        description: `${unsigned.length} docket(s) missing signatures.`,
        evidence: { docketIds: unsigned.map((d) => d.id) },
      };
    },
  },
];

function calcScoreFromFlags(flags: typeof auditFlagsTable.$inferSelect[]): number {
  let score = 100;
  for (const flag of flags) {
    if (flag.severity === "critical") score -= 20;
    else if (flag.severity === "warning") score -= 10;
    else score -= 3;
  }
  return Math.max(0, Math.min(100, score));
}

// POST /audit/run
router.post("/audit/run", async (req, res) => {
  const { subcontractorId, date } = req.body;
  const targetDate = date || new Date().toISOString().split("T")[0];
  const targetSubId = subcontractorId ? Number(subcontractorId) : null;

  const subs = targetSubId
    ? await db.select().from(subcontractorsTable).where(eq(subcontractorsTable.id, targetSubId))
    : await db.select().from(subcontractorsTable).where(eq(subcontractorsTable.active, true));

  const allFlags: (typeof auditFlagsTable.$inferSelect & { subcontractorName: string })[] = [];

  for (const sub of subs) {
    const reports = await db
      .select()
      .from(jobReportsTable)
      .where(and(eq(jobReportsTable.subcontractorId, sub.id), eq(jobReportsTable.dispatchDate, targetDate)));

    const sessions = await db
      .select()
      .from(workSessionsTable)
      .where(and(eq(workSessionsTable.subcontractorId, sub.id), eq(workSessionsTable.date, targetDate)));

    const dockets = await db
      .select()
      .from(docketsTable)
      .where(eq(docketsTable.subcontractorId, sub.id));

    if (sessions.length === 0 && reports.length === 0) continue;

    const ctx: AuditContext = { subcontractorId: sub.id, date: targetDate, reports, sessions, dockets };

    for (const rule of AUDIT_RULES) {
      const result = rule.check(ctx);
      if (!result.triggered) continue;

      const [flag] = await db.insert(auditFlagsTable).values({
        subcontractorId: sub.id,
        flagType: rule.type,
        severity: rule.severity,
        title: rule.title,
        description: result.description,
        evidence: result.evidence,
        status: "pending",
        showToWorker: rule.severity !== "info",
      }).returning();

      allFlags.push({ ...flag, subcontractorName: sub.name });
    }
  }

  return res.json(allFlags);
});

// GET /audit/flags
router.get("/audit/flags", async (req, res) => {
  const flags = await db.select().from(auditFlagsTable).orderBy(desc(auditFlagsTable.createdAt));
  const subs = await db.select().from(subcontractorsTable);
  const subMap = new Map(subs.map((s) => [s.id, s.name]));

  let filtered = flags;
  if (req.query.subcontractorId) filtered = filtered.filter((f) => f.subcontractorId === Number(req.query.subcontractorId));
  if (req.query.status) filtered = filtered.filter((f) => f.status === req.query.status);
  if (req.query.severity) filtered = filtered.filter((f) => f.severity === req.query.severity);
  if (req.query.startDate) filtered = filtered.filter((f) => f.createdAt >= new Date(req.query.startDate as string));

  return res.json(filtered.map((f) => ({ ...f, subcontractorName: subMap.get(f.subcontractorId) ?? "" })));
});

// PATCH /audit/flags/:id
router.patch("/audit/flags/:id", async (req, res) => {
  const { status, adminNotes, workerFeedback, showToWorker } = req.body;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (status) updates.status = status;
  if (adminNotes !== undefined) updates.adminNotes = adminNotes;
  if (workerFeedback !== undefined) updates.workerFeedback = workerFeedback;
  if (showToWorker !== undefined) updates.showToWorker = showToWorker;

  const [flag] = await db.update(auditFlagsTable).set(updates).where(eq(auditFlagsTable.id, Number(req.params.id))).returning();
  if (!flag) return res.status(404).json({ error: "Not found" });

  const [sub] = await db.select({ name: subcontractorsTable.name }).from(subcontractorsTable).where(eq(subcontractorsTable.id, flag.subcontractorId));
  return res.json({ ...flag, subcontractorName: sub?.name ?? "" });
});

// GET /audit/scores
router.get("/audit/scores", async (req, res) => {
  const scores = await db.select().from(auditScoresTable).orderBy(desc(auditScoresTable.calculatedAt));
  const subs = await db.select().from(subcontractorsTable);
  const subMap = new Map(subs.map((s) => [s.id, s.name]));

  let filtered = scores;
  if (req.query.subcontractorId) filtered = filtered.filter((s) => s.subcontractorId === Number(req.query.subcontractorId));
  if (req.query.periodType) filtered = filtered.filter((s) => s.periodType === req.query.periodType);
  if (req.query.periodStart) filtered = filtered.filter((s) => s.periodStart === req.query.periodStart);

  return res.json(filtered.map((s) => ({
    ...s,
    subcontractorName: subMap.get(s.subcontractorId) ?? "",
    overallScore: Number(s.overallScore),
    photoComplianceScore: s.photoComplianceScore ? Number(s.photoComplianceScore) : null,
    punctualityScore: s.punctualityScore ? Number(s.punctualityScore) : null,
    productivityScore: s.productivityScore ? Number(s.productivityScore) : null,
    documentationScore: s.documentationScore ? Number(s.documentationScore) : null,
    stockAccuracyScore: s.stockAccuracyScore ? Number(s.stockAccuracyScore) : null,
    safetyScore: s.safetyScore ? Number(s.safetyScore) : null,
    callbackRate: s.callbackRate ? Number(s.callbackRate) : null,
    adminOverrideScore: s.adminOverrideScore ? Number(s.adminOverrideScore) : null,
  })));
});

// POST /audit/scores/calculate
router.post("/audit/scores/calculate", async (req, res) => {
  const { periodType, periodStart, subcontractorId } = req.body;
  if (!periodType || !periodStart) return res.status(400).json({ error: "periodType and periodStart required" });

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
    ? await db.select().from(subcontractorsTable).where(eq(subcontractorsTable.id, Number(subcontractorId)))
    : await db.select().from(subcontractorsTable).where(eq(subcontractorsTable.active, true));

  const results = await Promise.all(
    subs.map(async (sub) => {
      const flags = await db
        .select()
        .from(auditFlagsTable)
        .where(
          and(
            eq(auditFlagsTable.subcontractorId, sub.id),
            gte(auditFlagsTable.createdAt, new Date(periodStart)),
            lte(auditFlagsTable.createdAt, new Date(`${periodEnd}T23:59:59`)),
          ),
        );

      const criticalCount = flags.filter((f) => f.severity === "critical").length;
      const warningCount = flags.filter((f) => f.severity === "warning").length;

      // Sub-scores based on flag types
      const photoFlags = flags.filter((f) => f.flagType === "missing_photos");
      const photoScore = Math.max(0, 100 - photoFlags.length * 20);

      const punctualityFlags = flags.filter((f) => f.flagType === "late_arrival");
      const punctualityScore = Math.max(0, 100 - punctualityFlags.length * 15);

      const productivityFlags = flags.filter((f) => f.flagType === "low_metres");
      const productivityScore = Math.max(0, 100 - productivityFlags.length * 15);

      const docFlags = flags.filter((f) => ["no_report_submitted", "missing_stock_usage"].includes(f.flagType));
      const documentationScore = Math.max(0, 100 - docFlags.length * 15);

      const overallScore = calcScoreFromFlags(flags);

      const values = {
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
            eq(auditScoresTable.subcontractorId, sub.id),
            eq(auditScoresTable.periodType, periodType),
            eq(auditScoresTable.periodStart, periodStart),
          ),
        )
        .limit(1);

      const [score] = existing.length
        ? await db.update(auditScoresTable).set(values).where(eq(auditScoresTable.id, existing[0].id)).returning()
        : await db.insert(auditScoresTable).values(values).returning();

      return { ...score, subcontractorName: sub.name, overallScore: Number(score.overallScore) };
    }),
  );

  return res.json(results);
});

export default router;

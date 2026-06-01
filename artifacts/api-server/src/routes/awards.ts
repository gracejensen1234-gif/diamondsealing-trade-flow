import { Router } from "express";
import { db } from "@workspace/db";
import {
  monthlyRankingsTable,
  scoringWeightsTable,
  monthlyAwardsTable,
  subcontractorsTable,
  workSessionsTable,
  jobReportsTable,
  auditScoresTable,
  auditFlagsTable,
} from "@workspace/db";
import { eq, and, gte, lte, desc, asc } from "drizzle-orm";
import { workSessionMinutes } from "../lib/date-utils.js";
import { companyId } from "../lib/auth.js";

const router = Router();

function n(v: unknown): number {
  return Number(v ?? 0);
}

// GET /monthly-rankings
router.get("/monthly-rankings", async (req, res) => {
  const month = (req.query.month as string) || new Date().toISOString().slice(0, 7);
  const tenantId = companyId(req);
  const rows = await db
    .select()
    .from(monthlyRankingsTable)
    .where(and(eq(monthlyRankingsTable.companyId, tenantId), eq(monthlyRankingsTable.month, month)))
    .orderBy(asc(monthlyRankingsTable.rank));

  const subs = await db.select().from(subcontractorsTable).where(eq(subcontractorsTable.companyId, tenantId));
  const subMap = new Map(subs.map((s) => [s.id, s.name]));

  return res.json(
    rows.map((r) => ({
      ...r,
      subcontractorName: subMap.get(r.subcontractorId) ?? "",
      totalScore: n(r.totalScore),
      metresScore: n(r.metresScore),
      metresPerHourScore: n(r.metresPerHourScore),
      auditScore: n(r.auditScore),
      punctualityScore: n(r.punctualityScore),
      photoComplianceScore: n(r.photoComplianceScore),
      callbackScore: n(r.callbackScore),
      attendanceScore: n(r.attendanceScore),
      totalMetres: n(r.totalMetres),
      avgMetresPerHour: n(r.avgMetresPerHour),
    })),
  );
});

// POST /monthly-rankings/calculate
router.post("/monthly-rankings/calculate", async (req, res) => {
  const { month } = req.body;
  if (!month) return res.status(400).json({ error: "month required (YYYY-MM)" });
  const tenantId = companyId(req);

  const monthStart = `${month}-01`;
  const nextMonth = new Date(`${month}-01`);
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  const monthEnd = nextMonth.toISOString().split("T")[0];

  const [weights] = await db
    .select()
    .from(scoringWeightsTable)
    .where(and(eq(scoringWeightsTable.companyId, tenantId), eq(scoringWeightsTable.active, true)))
    .limit(1);

  const w = {
    metres: n(weights?.metresWeight ?? 25),
    metresPerHour: n(weights?.metresPerHourWeight ?? 20),
    audit: n(weights?.auditWeight ?? 20),
    punctuality: n(weights?.punctualityWeight ?? 15),
    photoCompliance: n(weights?.photoComplianceWeight ?? 10),
    callback: n(weights?.callbackWeight ?? 5),
    attendance: n(weights?.attendanceWeight ?? 5),
  };

  const subs = await db
    .select()
    .from(subcontractorsTable)
    .where(and(eq(subcontractorsTable.companyId, tenantId), eq(subcontractorsTable.active, true)));

  const rankings = await Promise.all(
    subs.map(async (sub) => {
      const sessions = await db
        .select()
        .from(workSessionsTable)
        .where(and(
          eq(workSessionsTable.companyId, tenantId),
          eq(workSessionsTable.subcontractorId, sub.id),
          gte(workSessionsTable.date, monthStart),
          lte(workSessionsTable.date, monthEnd),
        ));

      const reports = await db
        .select()
        .from(jobReportsTable)
        .where(and(
          eq(jobReportsTable.companyId, tenantId),
          eq(jobReportsTable.subcontractorId, sub.id),
          gte(jobReportsTable.dispatchDate, monthStart),
          lte(jobReportsTable.dispatchDate, monthEnd),
        ));

      const flags = await db
        .select()
        .from(auditFlagsTable)
        .where(and(
          eq(auditFlagsTable.companyId, tenantId),
          eq(auditFlagsTable.subcontractorId, sub.id),
          gte(auditFlagsTable.createdAt, new Date(monthStart)),
          lte(auditFlagsTable.createdAt, new Date(monthEnd)),
        ));

      const [auditScore] = await db
        .select()
        .from(auditScoresTable)
        .where(and(
          eq(auditScoresTable.companyId, tenantId),
          eq(auditScoresTable.subcontractorId, sub.id),
          eq(auditScoresTable.periodType, "monthly"),
          eq(auditScoresTable.periodStart, monthStart),
        ))
        .limit(1);

      const totalMetres = reports.reduce((a, r) => a + n(r.metersCompleted), 0);
      const totalWorkMinutes = sessions.reduce((a, s) => a + workSessionMinutes(s), 0);
      const daysWorked = sessions.filter((s) => s.clockedOnAt).length;
      const avgMetresPerHour = totalWorkMinutes > 0 ? totalMetres / (totalWorkMinutes / 60) : 0;
      const jobsCompleted = reports.length;
      const criticalFlags = flags.filter((f) => f.severity === "critical").length;
      const missingPhotoJobs = reports.filter((r) => ((r.photos as string[]) ?? []).length === 0).length;

      const TOP_METRES = 600;
      const TOP_MPH = 15;
      const metresScoreRaw = Math.min(100, (totalMetres / TOP_METRES) * 100);
      const mphScoreRaw = Math.min(100, (avgMetresPerHour / TOP_MPH) * 100);
      const auditScoreRaw = auditScore
        ? n(auditScore.adminOverride ? auditScore.adminOverrideScore : auditScore.overallScore)
        : Math.max(0, 100 - criticalFlags * 20);
      const punctualityScoreRaw = Math.max(0, 100 - flags.filter((f) => f.flagType === "late_arrival").length * 15);
      const photoScoreRaw = jobsCompleted > 0 ? Math.max(0, 100 - (missingPhotoJobs / jobsCompleted) * 100) : 100;
      const callbackScoreRaw = Math.max(0, 100 - criticalFlags * 15);
      const attendanceScoreRaw = Math.min(100, (daysWorked / 20) * 100);

      const totalWeights = w.metres + w.metresPerHour + w.audit + w.punctuality + w.photoCompliance + w.callback + w.attendance;
      const totalScore =
        (metresScoreRaw * w.metres +
          mphScoreRaw * w.metresPerHour +
          auditScoreRaw * w.audit +
          punctualityScoreRaw * w.punctuality +
          photoScoreRaw * w.photoCompliance +
          callbackScoreRaw * w.callback +
          attendanceScoreRaw * w.attendance) /
        totalWeights;

      const values = {
        companyId: tenantId,
        subcontractorId: sub.id,
        month,
        totalScore: totalScore.toString(),
        metresScore: metresScoreRaw.toString(),
        metresPerHourScore: mphScoreRaw.toString(),
        auditScore: auditScoreRaw.toString(),
        punctualityScore: punctualityScoreRaw.toString(),
        photoComplianceScore: photoScoreRaw.toString(),
        callbackScore: callbackScoreRaw.toString(),
        attendanceScore: attendanceScoreRaw.toString(),
        totalMetres: totalMetres.toString(),
        avgMetresPerHour: avgMetresPerHour.toString(),
        daysWorked,
        jobsCompleted,
        callbackCount: criticalFlags,
        lateArrivals: flags.filter((f) => f.flagType === "late_arrival").length,
        missingPhotoJobs,
        auditFlagCount: flags.length,
        calculatedAt: new Date(),
      };

      const existing = await db
        .select()
        .from(monthlyRankingsTable)
        .where(and(
          eq(monthlyRankingsTable.companyId, tenantId),
          eq(monthlyRankingsTable.subcontractorId, sub.id),
          eq(monthlyRankingsTable.month, month),
        ))
        .limit(1);

      const [row] = existing.length
        ? await db
            .update(monthlyRankingsTable)
            .set(values)
            .where(and(eq(monthlyRankingsTable.id, existing[0].id), eq(monthlyRankingsTable.companyId, tenantId)))
            .returning()
        : await db.insert(monthlyRankingsTable).values(values).returning();

      return { ...row, subcontractorName: sub.name, totalScore: n(row.totalScore) };
    }),
  );

  const sorted = rankings.sort((a, b) => b.totalScore - a.totalScore);
  const ranked = await Promise.all(
    sorted.map(async (r, i) => {
      const [updated] = await db
        .update(monthlyRankingsTable)
        .set({ rank: i + 1 })
        .where(and(eq(monthlyRankingsTable.id, r.id), eq(monthlyRankingsTable.companyId, tenantId)))
        .returning();
      return { ...r, rank: i + 1, totalScore: n(updated.totalScore) };
    }),
  );

  return res.json(ranked);
});

// GET /scoring-weights
router.get("/scoring-weights", async (req, res) => {
  const tenantId = companyId(req);
  let [weights] = await db
    .select()
    .from(scoringWeightsTable)
    .where(and(eq(scoringWeightsTable.companyId, tenantId), eq(scoringWeightsTable.active, true)))
    .limit(1);
  if (!weights) {
    [weights] = await db.insert(scoringWeightsTable).values({ companyId: tenantId, name: "default" }).returning();
  }
  return res.json({
    ...weights,
    metresWeight: n(weights.metresWeight),
    metresPerHourWeight: n(weights.metresPerHourWeight),
    auditWeight: n(weights.auditWeight),
    punctualityWeight: n(weights.punctualityWeight),
    photoComplianceWeight: n(weights.photoComplianceWeight),
    callbackWeight: n(weights.callbackWeight),
    attendanceWeight: n(weights.attendanceWeight),
  });
});

// PATCH /scoring-weights
router.patch("/scoring-weights", async (req, res) => {
  const fields = [
    "metresWeight", "metresPerHourWeight", "auditWeight",
    "punctualityWeight", "photoComplianceWeight", "callbackWeight", "attendanceWeight",
  ];
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  for (const f of fields) {
    if (req.body[f] !== undefined) updates[f] = req.body[f].toString();
  }

  const tenantId = companyId(req);
  let [weights] = await db
    .select()
    .from(scoringWeightsTable)
    .where(and(eq(scoringWeightsTable.companyId, tenantId), eq(scoringWeightsTable.active, true)))
    .limit(1);
  if (!weights) {
    [weights] = await db.insert(scoringWeightsTable).values({ companyId: tenantId, name: "default" }).returning();
  }
  const [updated] = await db
    .update(scoringWeightsTable)
    .set(updates)
    .where(and(eq(scoringWeightsTable.id, weights.id), eq(scoringWeightsTable.companyId, tenantId)))
    .returning();
  return res.json({
    ...updated,
    metresWeight: n(updated.metresWeight),
    metresPerHourWeight: n(updated.metresPerHourWeight),
    auditWeight: n(updated.auditWeight),
    punctualityWeight: n(updated.punctualityWeight),
    photoComplianceWeight: n(updated.photoComplianceWeight),
    callbackWeight: n(updated.callbackWeight),
    attendanceWeight: n(updated.attendanceWeight),
  });
});

// GET /monthly-awards
router.get("/monthly-awards", async (req, res) => {
  const tenantId = companyId(req);
  const awards = await db
    .select()
    .from(monthlyAwardsTable)
    .where(eq(monthlyAwardsTable.companyId, tenantId))
    .orderBy(desc(monthlyAwardsTable.createdAt));
  const subs = await db.select().from(subcontractorsTable).where(eq(subcontractorsTable.companyId, tenantId));
  const subMap = new Map(subs.map((s) => [s.id, s.name]));
  return res.json(
    awards.map((a) => ({
      ...a,
      winnerName: subMap.get(a.winnerId) ?? "",
      awardValue: a.awardValue ? n(a.awardValue) : null,
      totalScore: a.totalScore ? n(a.totalScore) : null,
    })),
  );
});

// POST /monthly-awards
router.post("/monthly-awards", async (req, res) => {
  const { month, winnerId, awardType, awardTitle, awardDescription, awardValue, winnerPhoto, reasonText, totalScore } = req.body;
  if (!month || !winnerId || !awardType || !awardTitle || !reasonText) {
    return res.status(400).json({ error: "month, winnerId, awardType, awardTitle, reasonText required" });
  }
  const tenantId = companyId(req);
  const [winner] = await db
    .select()
    .from(subcontractorsTable)
    .where(and(eq(subcontractorsTable.id, Number(winnerId)), eq(subcontractorsTable.companyId, tenantId)));
  if (!winner) return res.status(400).json({ error: "Winner not found for this company" });
  const [award] = await db
    .insert(monthlyAwardsTable)
    .values({
      companyId: tenantId,
      month,
      winnerId: Number(winnerId),
      awardType,
      awardTitle,
      awardDescription,
      awardValue: awardValue?.toString(),
      winnerPhoto,
      reasonText,
      totalScore: totalScore?.toString(),
    })
    .returning();
  return res.status(201).json({ ...award, winnerName: winner.name, awardValue: award.awardValue ? n(award.awardValue) : null });
});

// GET /monthly-awards/current — must be before /:id
router.get("/monthly-awards/current", async (req, res) => {
  const tenantId = companyId(req);
  const [award] = await db
    .select()
    .from(monthlyAwardsTable)
    .where(and(eq(monthlyAwardsTable.companyId, tenantId), eq(monthlyAwardsTable.publishedToStaff, true)))
    .orderBy(desc(monthlyAwardsTable.publishedAt))
    .limit(1);
  if (!award) return res.status(404).json({ error: "No published award" });
  const [sub] = await db
    .select({ name: subcontractorsTable.name })
    .from(subcontractorsTable)
    .where(and(eq(subcontractorsTable.id, award.winnerId), eq(subcontractorsTable.companyId, tenantId)));
  return res.json({ ...award, winnerName: sub?.name ?? "", awardValue: award.awardValue ? n(award.awardValue) : null });
});

// PATCH /monthly-awards/:id
router.patch("/monthly-awards/:id", async (req, res) => {
  const updates: Record<string, unknown> = {};
  const strFields = ["awardType", "awardTitle", "awardDescription", "winnerPhoto", "reasonText"];
  for (const f of strFields) {
    if (req.body[f] !== undefined) updates[f] = req.body[f];
  }
  if (req.body.awardValue !== undefined) updates.awardValue = req.body.awardValue?.toString();
  if (req.body.adminApproved !== undefined) updates.adminApproved = req.body.adminApproved;
  if (req.body.publishedToStaff !== undefined) {
    updates.publishedToStaff = req.body.publishedToStaff;
    if (req.body.publishedToStaff === true) updates.publishedAt = new Date();
  }

  const tenantId = companyId(req);
  const [award] = await db
    .update(monthlyAwardsTable)
    .set(updates)
    .where(and(eq(monthlyAwardsTable.id, Number(req.params.id)), eq(monthlyAwardsTable.companyId, tenantId)))
    .returning();
  if (!award) return res.status(404).json({ error: "Not found" });
  const [sub] = await db
    .select({ name: subcontractorsTable.name })
    .from(subcontractorsTable)
    .where(and(eq(subcontractorsTable.id, award.winnerId), eq(subcontractorsTable.companyId, tenantId)));
  return res.json({ ...award, winnerName: sub?.name ?? "", awardValue: award.awardValue ? n(award.awardValue) : null });
});

export default router;

import { Router } from "express";
import { db } from "@workspace/db";
import {
  workSessionsTable,
  subcontractorsTable,
  jobReportsTable,
  jobAssignmentsTable,
  auditScoresTable,
  bonusCalculationsTable,
  bonusRulesTable,
} from "@workspace/db";
import { eq, and, gte, lte, desc, sql } from "drizzle-orm";
import { workSessionMinutes } from "../lib/date-utils.js";

const router = Router();

function metresPerHour(metres: number, workMinutes: number): number | null {
  if (!workMinutes || workMinutes <= 0) return null;
  return Math.round((metres / (workMinutes / 60)) * 100) / 100;
}

function currentWeekStart(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  return monday.toISOString().split("T")[0];
}

// GET /analytics/productivity
router.get("/analytics/productivity", async (req, res) => {
  const startDate = (req.query.startDate as string) || currentWeekStart();
  const endDate = (req.query.endDate as string) || new Date().toISOString().split("T")[0];
  const subcontractorId = req.query.subcontractorId ? Number(req.query.subcontractorId) : undefined;

  const subs = await db.select().from(subcontractorsTable).where(
    subcontractorId ? eq(subcontractorsTable.id, subcontractorId) : undefined,
  );

  const result = await Promise.all(
    subs.map(async (sub) => {
      const sessions = await db
        .select()
        .from(workSessionsTable)
        .where(
          and(
            eq(workSessionsTable.subcontractorId, sub.id),
            gte(workSessionsTable.date, startDate),
            lte(workSessionsTable.date, endDate),
          ),
        )
        .orderBy(workSessionsTable.date);

      const reports = await db
        .select()
        .from(jobReportsTable)
        .where(
          and(
            eq(jobReportsTable.subcontractorId, sub.id),
            gte(jobReportsTable.dispatchDate, startDate),
            lte(jobReportsTable.dispatchDate, endDate),
          ),
        );

      const metresByDate = new Map<string, number>();
      const jobsByDate = new Map<string, number>();
      for (const r of reports) {
        if (!r.dispatchDate) continue;
        const m = metresByDate.get(r.dispatchDate) || 0;
        metresByDate.set(r.dispatchDate, m + Number(r.metersCompleted || 0));
        jobsByDate.set(r.dispatchDate, (jobsByDate.get(r.dispatchDate) || 0) + 1);
      }

      const dailyBreakdown = sessions.map((s) => {
        const metres = metresByDate.get(s.date) || 0;
        const wm = workSessionMinutes(s);
        return {
          date: s.date,
          metres,
          workMinutes: wm,
          metresPerHour: metresPerHour(metres, wm),
          jobsCompleted: jobsByDate.get(s.date) || 0,
        };
      });

      const totalMetres = dailyBreakdown.reduce((a, d) => a + d.metres, 0);
      const totalWorkMinutes = dailyBreakdown.reduce((a, d) => a + d.workMinutes, 0);
      const daysWorked = sessions.filter((s) => s.clockedOnAt).length;

      return {
        subcontractorId: sub.id,
        subcontractorName: sub.name,
        totalMetres,
        totalWorkMinutes,
        avgMetresPerHour: metresPerHour(totalMetres, totalWorkMinutes),
        avgMetresPerDay: daysWorked > 0 ? Math.round((totalMetres / daysWorked) * 100) / 100 : null,
        daysWorked,
        jobsCompleted: reports.length,
        dailyBreakdown,
      };
    }),
  );

  const allMetresPerHour = result.map((r) => r.avgMetresPerHour).filter((v): v is number => v !== null);
  const avgMetresPerHour = allMetresPerHour.length
    ? Math.round((allMetresPerHour.reduce((a, b) => a + b, 0) / allMetresPerHour.length) * 100) / 100
    : 0;
  const totalMetres = result.reduce((a, r) => a + r.totalMetres, 0);
  const daysWorked = result.reduce((a, r) => a + r.daysWorked, 0);
  const avgMetresPerDay = daysWorked > 0 ? Math.round((totalMetres / daysWorked) * 100) / 100 : 0;

  return res.json({
    subcontractors: result,
    weeklyAverages: { avgMetresPerHour, avgMetresPerDay, totalMetres },
  });
});

// GET /analytics/productivity/friday-summary
router.get("/analytics/productivity/friday-summary", async (req, res) => {
  const subcontractorId = Number(req.query.subcontractorId);
  if (!subcontractorId) return res.status(400).json({ error: "subcontractorId required" });

  const [sub] = await db.select().from(subcontractorsTable).where(eq(subcontractorsTable.id, subcontractorId));
  if (!sub) return res.status(404).json({ error: "Subcontractor not found" });

  const weekStart = currentWeekStart();
  const weekEnd = new Date();
  const weekEndStr = weekEnd.toISOString().split("T")[0];

  const sessions = await db
    .select()
    .from(workSessionsTable)
    .where(
      and(
        eq(workSessionsTable.subcontractorId, subcontractorId),
        gte(workSessionsTable.date, weekStart),
        lte(workSessionsTable.date, weekEndStr),
      ),
    );

  const reports = await db
    .select()
    .from(jobReportsTable)
    .where(
      and(
        eq(jobReportsTable.subcontractorId, subcontractorId),
        gte(jobReportsTable.dispatchDate, weekStart),
        lte(jobReportsTable.dispatchDate, weekEndStr),
      ),
    );

  const totalMetres = reports.reduce((a, r) => a + Number(r.metersCompleted || 0), 0);
  const totalWorkMinutes = sessions.reduce((a, s) => a + workSessionMinutes(s), 0);
  const daysWorked = sessions.filter((s) => s.clockedOnAt).length;
  const mPerHour = metresPerHour(totalMetres, totalWorkMinutes);
  const avgMetresPerDay = daysWorked > 0 ? Math.round((totalMetres / daysWorked) * 100) / 100 : 0;

  // Get audit score
  const [auditScore] = await db
    .select()
    .from(auditScoresTable)
    .where(
      and(
        eq(auditScoresTable.subcontractorId, subcontractorId),
        eq(auditScoresTable.periodType, "weekly"),
        eq(auditScoresTable.periodStart, weekStart),
      ),
    )
    .limit(1);

  // Get bonus earned
  const [bonusCalc] = await db
    .select({
      calc: bonusCalculationsTable,
      rule: bonusRulesTable,
    })
    .from(bonusCalculationsTable)
    .leftJoin(bonusRulesTable, eq(bonusCalculationsTable.bonusRuleId, bonusRulesTable.id))
    .where(
      and(
        eq(bonusCalculationsTable.subcontractorId, subcontractorId),
        eq(bonusCalculationsTable.weekStart, weekStart),
      ),
    )
    .limit(1);

  const metresByDate = new Map<string, number>();
  for (const r of reports) {
    if (!r.dispatchDate) continue;
    metresByDate.set(r.dispatchDate, (metresByDate.get(r.dispatchDate) || 0) + Number(r.metersCompleted || 0));
  }
  const workMinutesByDate = new Map<string, number>();
  for (const s of sessions) {
    workMinutesByDate.set(s.date, workSessionMinutes(s));
  }

  let topDay: { date: string; metres: number; metresPerHour: number } | null = null;
  for (const [date, metres] of metresByDate) {
    const wm = workMinutesByDate.get(date) || 0;
    const mph = metresPerHour(metres, wm) || 0;
    if (!topDay || metres > topDay.metres) {
      topDay = { date, metres, metresPerHour: mph };
    }
  }

  const bonusEarned = bonusCalc?.calc?.bonusEarned ? Number(bonusCalc.calc.bonusAmount) : 0;

  let message = "";
  if (mPerHour !== null) {
    if (mPerHour >= 15) message = "🌟 Exceptional week! Outstanding productivity.";
    else if (mPerHour >= 10) message = "👍 Great week! Above average performance.";
    else if (mPerHour >= 6) message = "✅ Solid week. Keep it up!";
    else message = "Keep pushing — you can get your pace up next week!";
  }

  return res.json({
    subcontractorId: sub.id,
    subcontractorName: sub.name,
    weekStart,
    weekEnd: weekEndStr,
    totalMetres,
    totalWorkHours: Math.round((totalWorkMinutes / 60) * 100) / 100,
    avgMetresPerHour: mPerHour,
    avgMetresPerDay,
    daysWorked,
    jobsCompleted: reports.length,
    bonusEarned,
    bonusRuleName: bonusCalc?.rule?.name ?? null,
    auditScore: auditScore ? Number(auditScore.adminOverride ? auditScore.adminOverrideScore : auditScore.overallScore) : null,
    topDay,
    message,
  });
});

// GET /analytics/leaderboard
router.get("/analytics/leaderboard", async (req, res) => {
  const month = (req.query.month as string) || new Date().toISOString().slice(0, 7);
  const monthStart = `${month}-01`;
  const nextMonth = new Date(`${month}-01`);
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  const monthEnd = nextMonth.toISOString().split("T")[0];

  const subs = await db.select().from(subcontractorsTable).where(eq(subcontractorsTable.active, true));

  const entries = await Promise.all(
    subs.map(async (sub) => {
      const reports = await db
        .select()
        .from(jobReportsTable)
        .where(
          and(
            eq(jobReportsTable.subcontractorId, sub.id),
            gte(jobReportsTable.dispatchDate, monthStart),
            lte(jobReportsTable.dispatchDate, monthEnd),
          ),
        );

      const sessions = await db
        .select()
        .from(workSessionsTable)
        .where(
          and(
            eq(workSessionsTable.subcontractorId, sub.id),
            gte(workSessionsTable.date, monthStart),
            lte(workSessionsTable.date, monthEnd),
          ),
        );

      const totalMetres = reports.reduce((a, r) => a + Number(r.metersCompleted || 0), 0);
      const totalWorkMinutes = sessions.reduce((a, s) => a + workSessionMinutes(s), 0);
      const daysWorked = sessions.filter((s) => s.clockedOnAt).length;
      const mph = metresPerHour(totalMetres, totalWorkMinutes) ?? 0;

      const [auditScore] = await db
        .select()
        .from(auditScoresTable)
        .where(
          and(
            eq(auditScoresTable.subcontractorId, sub.id),
            eq(auditScoresTable.periodType, "monthly"),
            eq(auditScoresTable.periodStart, monthStart),
          ),
        )
        .limit(1);

      const scoreAudit = auditScore ? Number(auditScore.adminOverride ? auditScore.adminOverrideScore : auditScore.overallScore) : 100;
      const totalScore = Math.round((totalMetres * 0.3 + mph * 5 + scoreAudit * 0.7) * 100) / 100;

      return {
        subcontractorId: sub.id,
        subcontractorName: sub.name,
        totalScore,
        totalMetres,
        avgMetresPerHour: mph,
        auditScore: scoreAudit,
        daysWorked,
        badge: totalScore > 500 ? "🥇" : totalScore > 300 ? "🥈" : totalScore > 100 ? "🥉" : null,
      };
    }),
  );

  const sorted = entries
    .sort((a, b) => b.totalScore - a.totalScore)
    .map((e, i) => ({ ...e, rank: i + 1 }));

  return res.json(sorted);
});

export default router;

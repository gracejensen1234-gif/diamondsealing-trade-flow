import { Router } from "express";
import { db } from "@workspace/db";
import {
  subcontractorsTable,
  workerSkillsTable,
  jobAssignmentsTable,
  jobsTable,
  workSessionsTable,
  subInventoryTable,
  stockItemsTable,
  builderProfilesTable,
  allocationRecommendationsTable,
  weeklyPlannerProposalsTable,
  supplierOrdersTable,
  supplierOrderItemsTable,
  supplierProfilesTable,
} from "@workspace/db";
import { eq, and, gte, lte } from "drizzle-orm";

const router = Router();

const TIER_QUALITY_MIN: Record<string, number> = {
  premium: 90,
  high_end: 80,
  standard: 60,
  production: 40,
  budget: 0,
  custom: 0,
};

interface SubInfo {
  id: number;
  name: string;
  skills: typeof workerSkillsTable.$inferSelect | null;
  inventory: Map<number, number>;
  assignedDates: string[];
  assignedSuburbs: string[];
}

async function loadSubInfo(date: string): Promise<SubInfo[]> {
  const subs = await db.select().from(subcontractorsTable).where(eq(subcontractorsTable.active, true));
  return Promise.all(
    subs.map(async (sub) => {
      const [skills] = await db.select().from(workerSkillsTable).where(eq(workerSkillsTable.subcontractorId, sub.id)).limit(1);
      const invRows = await db.select().from(subInventoryTable).where(eq(subInventoryTable.subcontractorId, sub.id));
      const inventory = new Map(invRows.map((r) => [r.stockItemId, Number(r.currentQuantity)]));

      // Get existing assignments for proximity calculation
      const assignments = await db
        .select({ date: jobAssignmentsTable.scheduledDate, jobId: jobAssignmentsTable.jobId })
        .from(jobAssignmentsTable)
        .where(
          and(
            eq(jobAssignmentsTable.subcontractorId, sub.id),
            gte(jobAssignmentsTable.scheduledDate, (() => {
              const d = new Date(date);
              d.setDate(d.getDate() - 3);
              return d.toISOString().split("T")[0];
            })()),
            lte(jobAssignmentsTable.scheduledDate, (() => {
              const d = new Date(date);
              d.setDate(d.getDate() + 3);
              return d.toISOString().split("T")[0];
            })()),
          ),
        );

      const assignedDates = assignments.map((a) => a.scheduledDate);
      const jobIds = assignments.map((a) => a.jobId);
      const assignedSuburbs: string[] = [];
      for (const jid of jobIds) {
        const [j] = await db.select({ suburb: jobsTable.suburb }).from(jobsTable).where(eq(jobsTable.id, jid)).limit(1);
        if (j?.suburb) assignedSuburbs.push(j.suburb);
      }

      return { id: sub.id, name: sub.name, skills: skills ?? null, inventory, assignedDates, assignedSuburbs };
    }),
  );
}

function checkSkills(
  skills: typeof workerSkillsTable.$inferSelect | null,
  jobType: string,
  productType: string,
  requiredSkills: string[],
): { match: boolean; reasons: string[]; warnings: string[] } {
  const reasons: string[] = [];
  const warnings: string[] = [];
  if (!skills) {
    warnings.push("No skill profile — skills unknown");
    return { match: true, reasons, warnings };
  }

  let match = true;

  // Product check
  const prod = productType?.toLowerCase() ?? "";
  if (prod.includes("sikaflex") && !skills.canSikaflex) {
    match = false;
    warnings.push("Worker cannot apply Sikaflex");
  } else if (prod.includes("sikaflex") && skills.canSikaflex) {
    reasons.push("✓ Sikaflex certified");
  }
  if ((prod.includes("silicone") || prod === "") && skills.canSilicone) {
    reasons.push("✓ Silicone certified");
  }
  if (prod.includes("fire") && !skills.canFireRated) {
    match = false;
    warnings.push("Worker not certified for fire-rated sealing");
  }
  if (prod.includes("waterproof") && !skills.canWaterproofing) {
    match = false;
    warnings.push("Worker not certified for waterproofing");
  }

  // Job type check
  const jt = jobType?.toLowerCase() ?? "";
  if (jt.includes("pool") && !skills.canPools) {
    match = false;
    warnings.push("Worker not certified for pool work");
  } else if (jt.includes("pool") && skills.canPools) {
    reasons.push("✓ Pool certified");
  }
  if (jt.includes("commercial") && !skills.canCommercial) {
    warnings.push("Worker not experienced in commercial work");
  } else if (jt.includes("commercial") && skills.canCommercial) {
    reasons.push("✓ Commercial experience");
  }
  if (jt.includes("car park") && !skills.canCarParks) {
    warnings.push("Worker not experienced in car parks");
  }

  // Custom required skills
  const custom = (skills.customSkills as string[]) ?? [];
  for (const req of requiredSkills ?? []) {
    if (!custom.includes(req)) warnings.push(`Required skill missing: ${req}`);
    else reasons.push(`✓ ${req}`);
  }

  return { match, reasons, warnings };
}

function checkStock(
  inventory: Map<number, number>,
  stockItemId: number | null,
  estimatedMetres: number,
): { match: boolean; shortfall: string[]; reasons: string[] } {
  if (!stockItemId || !estimatedMetres) return { match: true, shortfall: [], reasons: ["No specific stock required"] };
  const current = inventory.get(stockItemId) ?? 0;
  const needed = Math.ceil(estimatedMetres / 20); // ~20m per tube
  if (current < needed) {
    return {
      match: false,
      shortfall: [`Needs ~${needed} tubes, has ${current}`],
      reasons: [],
    };
  }
  return { match: true, shortfall: [], reasons: [`✓ Stock: ${current} tubes (needs ~${needed})`] };
}

function proximityScore(suburb: string, assignedSuburbs: string[]): { score: number; nearbySuburb: string | null } {
  if (!suburb || assignedSuburbs.length === 0) return { score: 50, nearbySuburb: null };
  // Simple string match for same/adjacent suburb
  const exact = assignedSuburbs.find((s) => s?.toLowerCase() === suburb?.toLowerCase());
  if (exact) return { score: 100, nearbySuburb: exact };
  // Partial match (same area prefix, e.g. "South" Brisbane, etc.)
  const partial = assignedSuburbs.find(
    (s) => s && suburb && (s.toLowerCase().includes(suburb.toLowerCase().split(" ")[0]) ||
      suburb.toLowerCase().includes(s.toLowerCase().split(" ")[0])),
  );
  if (partial) return { score: 75, nearbySuburb: partial };
  return { score: 30, nearbySuburb: null };
}

// POST /allocation/recommend
router.post("/allocation/recommend", async (req, res) => {
  const { jobId, date, productType, colour, estimatedMetres, jobType, suburb, builderProfileId, requiredSkills, stockItemId } = req.body;
  if (!jobId || !date) return res.status(400).json({ error: "jobId and date required" });

  let builderTierMinQuality = 0;
  let builderProfile: typeof builderProfilesTable.$inferSelect | null = null;
  if (builderProfileId) {
    const [bp] = await db.select().from(builderProfilesTable).where(eq(builderProfilesTable.id, Number(builderProfileId)));
    builderProfile = bp ?? null;
    if (bp) builderTierMinQuality = TIER_QUALITY_MIN[bp.qualityTier] ?? 0;
  }

  const subs = await loadSubInfo(date);
  const recommendations = subs.map((sub) => {
    const reasons: string[] = [];
    const warnings: string[] = [];
    let score = 100;

    // Availability
    const alreadyBooked = sub.assignedDates.includes(date);
    if (alreadyBooked) {
      warnings.push("Already scheduled on this date");
      score -= 40;
    } else {
      reasons.push("✓ Available on this date");
    }

    // Skill check
    const skillResult = checkSkills(sub.skills, jobType, productType, requiredSkills ?? []);
    if (!skillResult.match) score -= 30;
    reasons.push(...skillResult.reasons);
    warnings.push(...skillResult.warnings);

    // Stock check
    const stockResult = checkStock(sub.inventory, stockItemId ? Number(stockItemId) : null, estimatedMetres ?? 0);
    if (!stockResult.match) score -= 20;
    reasons.push(...stockResult.reasons);
    warnings.push(...stockResult.shortfall.map((s) => `⚠ Stock shortfall: ${s}`));

    // Proximity
    const prox = proximityScore(suburb, sub.assignedSuburbs);
    score = Math.round(score * 0.7 + prox.score * 0.3);
    if (prox.nearbySuburb) reasons.push(`✓ Nearby job in ${prox.nearbySuburb}`);

    // Builder tier match
    const quality = sub.skills ? Number(sub.skills.qualityScore) : 80;
    const tierMatch = quality >= builderTierMinQuality;
    if (!tierMatch) {
      warnings.push(`Quality score ${quality} below builder tier requirement (${builderTierMinQuality})`);
      score -= 15;
    } else if (builderTierMinQuality > 70) {
      reasons.push(`✓ Quality score ${quality} meets ${builderProfile?.qualityTier} standard`);
    }

    // Builder preferences
    const preferred = builderProfile && (builderProfile.preferredWorkerIds as number[])?.includes(sub.id);
    const avoided = builderProfile && (builderProfile.avoidedWorkerIds as number[])?.includes(sub.id);
    if (preferred) { score += 10; reasons.push("✓ Builder's preferred worker"); }
    if (avoided) { score -= 25; warnings.push("⚠ Builder has requested to avoid this worker"); }

    const callbackRate = sub.skills ? Number(sub.skills.callbackRate) : 0;
    if (callbackRate > 15) warnings.push(`High callback rate: ${callbackRate}%`);
    else if (callbackRate < 5) reasons.push(`✓ Low callback rate: ${callbackRate}%`);

    score = Math.max(0, Math.min(100, score));

    const rec =
      score >= 80 ? "recommended" :
      score >= 60 ? "suitable" :
      score >= 40 ? "possible" :
      "not_recommended";

    return {
      subcontractorId: sub.id,
      subcontractorName: sub.name,
      suitabilityScore: score,
      recommendation: rec,
      reasons,
      warnings,
      skillMatch: skillResult.match,
      stockMatch: stockResult.match,
      stockShortfall: stockResult.shortfall,
      proximityScore: prox.score,
      nearbyJobSuburb: prox.nearbySuburb,
      scheduleFit: !alreadyBooked,
      builderTierMatch: tierMatch,
      qualityScore: quality,
      callbackRate,
      availableOnDate: !alreadyBooked,
    };
  });

  const sorted = recommendations
    .sort((a, b) => b.suitabilityScore - a.suitabilityScore)
    .map((r, i) => ({ ...r, rank: i + 1 }));

  const autoSelected = sorted[0] ?? null;
  const globalWarnings: string[] = [];
  if (sorted.every((r) => !r.scheduleFit)) globalWarnings.push("All workers already scheduled on this date");
  if (sorted.every((r) => !r.stockMatch)) globalWarnings.push("No worker has sufficient stock — supplier order may be needed");

  // Save recommendation
  const [saved] = await db.insert(allocationRecommendationsTable).values({
    jobId: Number(jobId),
    requestedDate: date,
    recommendations: sorted,
    warnings: globalWarnings,
  }).returning();

  return res.json({
    jobId: Number(jobId),
    date,
    recommendationId: saved.id,
    recommendations: sorted,
    autoSelected,
    warnings: globalWarnings,
  });
});

// POST /allocation/confirm
router.post("/allocation/confirm", async (req, res) => {
  const { recommendationId, subcontractorId, overrideReason } = req.body;
  if (!recommendationId || !subcontractorId) return res.status(400).json({ error: "recommendationId and subcontractorId required" });

  const [saved] = await db
    .update(allocationRecommendationsTable)
    .set({
      selectedSubcontractorId: Number(subcontractorId),
      selectionMethod: overrideReason ? "manual_override" : "auto",
      overrideReason,
    })
    .where(eq(allocationRecommendationsTable.id, Number(recommendationId)))
    .returning();

  return res.json(saved);
});

// POST /weekly-planner/generate
router.post("/weekly-planner/generate", async (req, res) => {
  const { weekStart } = req.body;
  if (!weekStart) return res.status(400).json({ error: "weekStart required" });

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 4); // Mon-Fri
  const weekEndStr = weekEnd.toISOString().split("T")[0];

  // Get all unassigned jobs for the week
  const allJobs = await db.select().from(jobsTable);
  const weekJobs = allJobs.filter((j) => {
    const d = (j as any).scheduledDate ?? (j as any).dueDate;
    return d >= weekStart && d <= weekEndStr;
  });

  const subs = await loadSubInfo(weekStart);
  const schedule = subs.map((sub) => ({
    subcontractorId: sub.id,
    subcontractorName: sub.name,
    assignments: [] as object[],
  }));

  const notes: string[] = [];
  let stockWarnings = 0;
  const unallocated: number[] = [];

  // Simple grouping: sort jobs by suburb, assign to available workers with proximity match
  for (const job of weekJobs) {
    const suburb = (job as any).suburb ?? "";
    const bestSub = subs.find((s) => !s.assignedDates.includes((job as any).scheduledDate ?? weekStart) && s.assignedSuburbs.includes(suburb));
    const fallback = subs.find((s) => !s.assignedDates.includes((job as any).scheduledDate ?? weekStart));
    const assigned = bestSub ?? fallback;

    if (assigned) {
      const schedEntry = schedule.find((s) => s.subcontractorId === assigned.id);
      schedEntry?.assignments.push({
        date: (job as any).scheduledDate ?? weekStart,
        jobId: job.id,
        jobTitle: job.title,
        suburb,
        routeNote: bestSub ? "Same suburb grouping" : "Best availability",
      });
      assigned.assignedDates.push((job as any).scheduledDate ?? weekStart);
    } else {
      unallocated.push(job.id);
    }
  }

  if (unallocated.length > 0) notes.push(`${unallocated.length} jobs could not be auto-assigned — review needed`);

  const proposal = {
    weekStart,
    status: "draft" as const,
    proposedSchedule: schedule,
    supplierOrders: [],
    optimisationSummary: {
      totalJobs: weekJobs.length,
      totalWorkers: subs.length,
      travelSavings: "Nearby jobs grouped where possible",
      stockWarnings,
      unallocatedJobs: unallocated.length,
      notes,
    },
  };

  const [saved] = await db.insert(weeklyPlannerProposalsTable).values(proposal).returning();
  return res.json({ ...saved, proposedSchedule: schedule });
});

// GET /weekly-planner
router.get("/weekly-planner", async (req, res) => {
  const rows = await db.select().from(weeklyPlannerProposalsTable);
  const weekStart = req.query.weekStart as string;
  const filtered = weekStart ? rows.filter((r) => r.weekStart === weekStart) : rows;
  return res.json(filtered.map((r) => ({
    ...r,
    proposedSchedule: r.proposedSchedule,
    optimisationSummary: r.optimisationSummary,
  })));
});

// PATCH /weekly-planner/:id
router.patch("/weekly-planner/:id", async (req, res) => {
  const { status, adminNotes } = req.body;
  const updates: Record<string, unknown> = {};
  if (status) updates.status = status;
  if (adminNotes !== undefined) updates.adminNotes = adminNotes;
  if (status === "approved") updates.approvedAt = new Date();

  const [row] = await db.update(weeklyPlannerProposalsTable).set(updates).where(eq(weeklyPlannerProposalsTable.id, Number(req.params.id))).returning();
  if (!row) return res.status(404).json({ error: "Not found" });
  return res.json(row);
});

export default router;

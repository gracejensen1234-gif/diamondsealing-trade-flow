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
  customersTable,
  builderProfilesTable,
  allocationRecommendationsTable,
  weeklyPlannerProposalsTable,
  supplierOrdersTable,
  supplierOrderItemsTable,
  supplierProfilesTable,
} from "@workspace/db";
import { eq, and, gte, lte } from "drizzle-orm";
import { companyId } from "../lib/auth.js";
import { createAndSendNotification } from "../lib/notificationService.js";

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

async function loadSubInfo(companyAccountId: number, date: string): Promise<SubInfo[]> {
  const subs = await db
    .select()
    .from(subcontractorsTable)
    .where(and(eq(subcontractorsTable.companyId, companyAccountId), eq(subcontractorsTable.active, true)));
  return Promise.all(
    subs.map(async (sub) => {
      const [skills] = await db
        .select()
        .from(workerSkillsTable)
        .where(and(eq(workerSkillsTable.companyId, companyAccountId), eq(workerSkillsTable.subcontractorId, sub.id)))
        .limit(1);
      const invRows = await db
        .select()
        .from(subInventoryTable)
        .where(and(eq(subInventoryTable.companyId, companyAccountId), eq(subInventoryTable.subcontractorId, sub.id)));
      const inventory = new Map(invRows.map((r) => [r.stockItemId, Number(r.currentQuantity)]));

      // Get existing assignments for proximity calculation
      const assignments = await db
        .select({ date: jobAssignmentsTable.dispatchDate, jobId: jobAssignmentsTable.jobId })
        .from(jobAssignmentsTable)
        .where(
          and(
            eq(jobAssignmentsTable.subcontractorId, sub.id),
            eq(jobAssignmentsTable.companyId, companyAccountId),
            gte(jobAssignmentsTable.dispatchDate, (() => {
              const d = new Date(date);
              d.setDate(d.getDate() - 3);
              return d.toISOString().split("T")[0];
            })()),
            lte(jobAssignmentsTable.dispatchDate, (() => {
              const d = new Date(date);
              d.setDate(d.getDate() + 3);
              return d.toISOString().split("T")[0];
            })()),
          ),
        );

      const assignedDates = assignments.map((a) => a.date);
      const jobIds = assignments.map((a) => a.jobId).filter((jobId): jobId is number => jobId !== null);
      const assignedSuburbs: string[] = [];
      for (const jid of jobIds) {
        const [j] = await db
          .select({ customerId: jobsTable.customerId, address: jobsTable.address })
          .from(jobsTable)
          .where(and(eq(jobsTable.id, jid), eq(jobsTable.companyId, companyAccountId)))
          .limit(1);
        if (j?.customerId) {
          const [customer] = await db
            .select({ suburb: customersTable.suburb })
            .from(customersTable)
            .where(and(eq(customersTable.id, j.customerId), eq(customersTable.companyId, companyAccountId)))
            .limit(1);
          if (customer?.suburb) assignedSuburbs.push(customer.suburb);
        } else if (j?.address) {
          assignedSuburbs.push(j.address);
        }
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
    warnings.push("Employee/subcontractor cannot apply Sikaflex");
  } else if (prod.includes("sikaflex") && skills.canSikaflex) {
    reasons.push("✓ Sikaflex certified");
  }
  if ((prod.includes("silicone") || prod === "") && skills.canSilicone) {
    reasons.push("✓ Silicone certified");
  }
  if (prod.includes("fire") && !skills.canFireRated) {
    match = false;
    warnings.push("Employee/subcontractor not certified for fire-rated sealing");
  }
  if (prod.includes("waterproof") && !skills.canWaterproofing) {
    match = false;
    warnings.push("Employee/subcontractor not certified for waterproofing");
  }

  // Job type check
  const jt = jobType?.toLowerCase() ?? "";
  if (jt.includes("pool") && !skills.canPools) {
    match = false;
    warnings.push("Employee/subcontractor not certified for pool work");
  } else if (jt.includes("pool") && skills.canPools) {
    reasons.push("✓ Pool certified");
  }
  if (jt.includes("commercial") && !skills.canCommercial) {
    warnings.push("Employee/subcontractor not experienced in commercial work");
  } else if (jt.includes("commercial") && skills.canCommercial) {
    reasons.push("✓ Commercial experience");
  }
  if (jt.includes("car park") && !skills.canCarParks) {
    warnings.push("Employee/subcontractor not experienced in car parks");
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
  const tenantId = companyId(req);

  const [job] = await db
    .select()
    .from(jobsTable)
    .where(and(eq(jobsTable.id, Number(jobId)), eq(jobsTable.companyId, tenantId)));
  if (!job) return res.status(400).json({ error: "Job not found for this company" });
  if (stockItemId) {
    const [stockItem] = await db
      .select()
      .from(stockItemsTable)
      .where(and(eq(stockItemsTable.id, Number(stockItemId)), eq(stockItemsTable.companyId, tenantId)));
    if (!stockItem) return res.status(400).json({ error: "Stock item not found for this company" });
  }

  let builderTierMinQuality = 0;
  let builderProfile: typeof builderProfilesTable.$inferSelect | null = null;
  if (builderProfileId) {
    const [bp] = await db
      .select()
      .from(builderProfilesTable)
      .where(and(eq(builderProfilesTable.id, Number(builderProfileId)), eq(builderProfilesTable.companyId, tenantId)));
    builderProfile = bp ?? null;
    if (bp) builderTierMinQuality = TIER_QUALITY_MIN[bp.qualityTier] ?? 0;
  }

  const subs = await loadSubInfo(tenantId, date);
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
    if (preferred) { score += 10; reasons.push("✓ Builder's preferred employee/subcontractor"); }
    if (avoided) { score -= 25; warnings.push("⚠ Builder has requested to avoid this employee/subcontractor"); }

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
  if (sorted.every((r) => !r.scheduleFit)) globalWarnings.push("All employees/subcontractors already scheduled on this date");
  if (sorted.every((r) => !r.stockMatch)) globalWarnings.push("No employee/subcontractor has sufficient stock — supplier order may be needed");

  // Save recommendation
  const [saved] = await db.insert(allocationRecommendationsTable).values({
    companyId: tenantId,
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
  const {
    recommendationId,
    subcontractorId,
    overrideReason,
    workArea,
    timeWindow,
    plannedStartTime,
    plannedEndTime,
    estimatedMetres,
    requiredColours,
    notes,
  } = req.body;
  if (!recommendationId || !subcontractorId) return res.status(400).json({ error: "recommendationId and subcontractorId required" });
  const tenantId = companyId(req);
  const [sub] = await db
    .select()
    .from(subcontractorsTable)
    .where(and(eq(subcontractorsTable.id, Number(subcontractorId)), eq(subcontractorsTable.companyId, tenantId)));
  if (!sub) return res.status(400).json({ error: "Employee/subcontractor not found for this company" });

  const [recommendation] = await db
    .select()
    .from(allocationRecommendationsTable)
    .where(and(eq(allocationRecommendationsTable.id, Number(recommendationId)), eq(allocationRecommendationsTable.companyId, tenantId)));
  if (!recommendation) return res.status(404).json({ error: "Recommendation not found" });

  const [job] = await db
    .select()
    .from(jobsTable)
    .where(and(eq(jobsTable.id, recommendation.jobId), eq(jobsTable.companyId, tenantId)));
  if (!job) return res.status(404).json({ error: "Job not found for this recommendation" });

  const dispatchDate = recommendation.requestedDate;
  const [existingAssignment] = recommendation.jobAssignmentId
    ? await db
      .select()
      .from(jobAssignmentsTable)
      .where(and(eq(jobAssignmentsTable.id, recommendation.jobAssignmentId), eq(jobAssignmentsTable.companyId, tenantId)))
    : [];
  if (existingAssignment && existingAssignment.status !== "pending") {
    return res.status(409).json({ error: "This assignment is already active or completed. Review it from Dispatch before changing it." });
  }

  let scheduledOrder = existingAssignment?.scheduledOrder ?? 1;
  if (!existingAssignment || existingAssignment.subcontractorId !== Number(subcontractorId) || existingAssignment.dispatchDate !== dispatchDate) {
    const existingForSub = await db
      .select({ scheduledOrder: jobAssignmentsTable.scheduledOrder })
      .from(jobAssignmentsTable)
      .where(
        and(
          eq(jobAssignmentsTable.companyId, tenantId),
          eq(jobAssignmentsTable.dispatchDate, dispatchDate),
          eq(jobAssignmentsTable.subcontractorId, Number(subcontractorId)),
        ),
      );
    scheduledOrder = existingForSub.reduce((max, assignment) => Math.max(max, assignment.scheduledOrder), 0) + 1;
  }

  const blockColours = Array.isArray(requiredColours)
    ? requiredColours.filter((colour): colour is string => typeof colour === "string" && colour.trim().length > 0)
    : Array.isArray(job.requiredColours)
      ? job.requiredColours
      : [];
  const assignmentValues = {
    companyId: tenantId,
    dispatchDate,
    scheduledOrder,
    jobId: job.id,
    subcontractorId: Number(subcontractorId),
    workArea: typeof workArea === "string" && workArea.trim() ? workArea.trim() : null,
    timeWindow: typeof timeWindow === "string" && timeWindow.trim() ? timeWindow.trim() : "full_day",
    plannedStartTime: typeof plannedStartTime === "string" && plannedStartTime.trim() ? plannedStartTime.trim() : null,
    plannedEndTime: typeof plannedEndTime === "string" && plannedEndTime.trim() ? plannedEndTime.trim() : null,
    estimatedMetres: estimatedMetres != null && Number.isFinite(Number(estimatedMetres)) ? String(Number(estimatedMetres)) : null,
    builderContactName: job.builderContactName ?? null,
    builderContactPhone: job.builderContactPhone ?? null,
    requiredColours: blockColours,
    notes: typeof notes === "string" && notes.trim() ? notes.trim() : null,
    status: "pending" as const,
  };

  let assignment: typeof jobAssignmentsTable.$inferSelect | undefined;
  if (existingAssignment) {
    [assignment] = await db
      .update(jobAssignmentsTable)
      .set({
        dispatchDate: assignmentValues.dispatchDate,
        scheduledOrder: assignmentValues.scheduledOrder,
        jobId: assignmentValues.jobId,
        subcontractorId: assignmentValues.subcontractorId,
        workArea: assignmentValues.workArea,
        timeWindow: assignmentValues.timeWindow,
        plannedStartTime: assignmentValues.plannedStartTime,
        plannedEndTime: assignmentValues.plannedEndTime,
        estimatedMetres: assignmentValues.estimatedMetres,
        builderContactName: assignmentValues.builderContactName,
        builderContactPhone: assignmentValues.builderContactPhone,
        requiredColours: assignmentValues.requiredColours,
        notes: assignmentValues.notes,
        status: assignmentValues.status,
      })
      .where(and(eq(jobAssignmentsTable.id, existingAssignment.id), eq(jobAssignmentsTable.companyId, tenantId)))
      .returning();
  }
  if (!assignment) {
    [assignment] = await db.insert(jobAssignmentsTable).values(assignmentValues).returning();
  }
  if (!assignment) return res.status(500).json({ error: "Could not create dispatch assignment" });

  const [saved] = await db
    .update(allocationRecommendationsTable)
    .set({
      jobAssignmentId: assignment.id,
      selectedSubcontractorId: Number(subcontractorId),
      selectionMethod: overrideReason ? "manual_override" : "auto",
      overrideReason,
    })
    .where(and(eq(allocationRecommendationsTable.id, Number(recommendationId)), eq(allocationRecommendationsTable.companyId, tenantId)))
    .returning();

  try {
    await createAndSendNotification({
      subcontractorId: Number(subcontractorId),
      type: "new_job",
      title: "New job assigned",
      body: `${job.title}${assignment.workArea ? ` - ${assignment.workArea}` : ""}${job.address ? ` at ${job.address}` : ""}`,
      priority: "high",
      actionUrl: "/field",
      linkedEntityType: "job_assignment",
      linkedEntityId: assignment.id,
    });
  } catch (err) {
    req.log.warn({ err, assignmentId: assignment.id }, "Failed to send allocation confirmation notification");
  }

  return res.json({ ...saved, jobAssignmentId: assignment.id, assignment });
});

// POST /weekly-planner/generate
router.post("/weekly-planner/generate", async (req, res) => {
  const { weekStart } = req.body;
  if (!weekStart) return res.status(400).json({ error: "weekStart required" });
  const tenantId = companyId(req);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 4); // Mon-Fri
  const weekEndStr = weekEnd.toISOString().split("T")[0];

  // Get all unassigned jobs for the week
  const allJobs = await db.select().from(jobsTable).where(eq(jobsTable.companyId, tenantId));
  const weekJobs = allJobs.filter((j) => {
    const d = (j as any).scheduledDate ?? (j as any).dueDate;
    return d >= weekStart && d <= weekEndStr;
  });

  const subs = await loadSubInfo(tenantId, weekStart);
  const schedule = subs.map((sub) => ({
    subcontractorId: sub.id,
    subcontractorName: sub.name,
    assignments: [] as object[],
  }));

  const notes: string[] = [];
  let stockWarnings = 0;
  const unallocated: number[] = [];

  // Simple grouping: sort jobs by suburb, assign to available employees/subcontractors with proximity match
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
    companyId: tenantId,
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
  const tenantId = companyId(req);
  const rows = await db.select().from(weeklyPlannerProposalsTable).where(eq(weeklyPlannerProposalsTable.companyId, tenantId));
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
  const tenantId = companyId(req);
  const [existing] = await db
    .select()
    .from(weeklyPlannerProposalsTable)
    .where(and(eq(weeklyPlannerProposalsTable.id, Number(req.params.id)), eq(weeklyPlannerProposalsTable.companyId, tenantId)));
  if (!existing) return res.status(404).json({ error: "Not found" });

  const updates: Record<string, unknown> = {};
  if (status) updates.status = status;
  if (adminNotes !== undefined) updates.adminNotes = adminNotes;
  if (status === "approved") updates.approvedAt = new Date();

  const [row] = await db
    .update(weeklyPlannerProposalsTable)
    .set(updates)
    .where(and(eq(weeklyPlannerProposalsTable.id, Number(req.params.id)), eq(weeklyPlannerProposalsTable.companyId, tenantId)))
    .returning();

  const createdAssignments: Array<typeof jobAssignmentsTable.$inferSelect> = [];
  if (status === "approved") {
    const proposedSchedule = Array.isArray(existing.proposedSchedule) ? existing.proposedSchedule as Array<{
      subcontractorId?: number;
      subcontractorName?: string;
      assignments?: Array<{
        date?: string;
        jobId?: number;
        routeNote?: string;
        workArea?: string;
        estimatedMetres?: number;
        requiredColours?: string[];
      }>;
    }> : [];

    for (const workerSchedule of proposedSchedule) {
      const subcontractorId = Number(workerSchedule.subcontractorId);
      if (!subcontractorId || !Array.isArray(workerSchedule.assignments)) continue;

      for (const proposed of workerSchedule.assignments) {
        const jobId = Number(proposed.jobId);
        const dispatchDate = proposed.date || existing.weekStart;
        if (!jobId || !dispatchDate) continue;

        const [job] = await db
          .select()
          .from(jobsTable)
          .where(and(eq(jobsTable.id, jobId), eq(jobsTable.companyId, tenantId)));
        if (!job) continue;

        const proposedWorkArea = typeof proposed.workArea === "string" && proposed.workArea.trim() ? proposed.workArea.trim() : null;
        const existingBlocks = await db
          .select({ id: jobAssignmentsTable.id, workArea: jobAssignmentsTable.workArea })
          .from(jobAssignmentsTable)
          .where(
            and(
              eq(jobAssignmentsTable.companyId, tenantId),
              eq(jobAssignmentsTable.jobId, jobId),
              eq(jobAssignmentsTable.dispatchDate, dispatchDate),
              eq(jobAssignmentsTable.subcontractorId, subcontractorId),
            ),
          );
        const alreadyScheduled = existingBlocks.some((block) => (
          proposedWorkArea ? block.workArea === proposedWorkArea : !block.workArea
        ));
        if (alreadyScheduled) continue;

        const existingForSub = await db
          .select({ scheduledOrder: jobAssignmentsTable.scheduledOrder })
          .from(jobAssignmentsTable)
          .where(
            and(
              eq(jobAssignmentsTable.companyId, tenantId),
              eq(jobAssignmentsTable.dispatchDate, dispatchDate),
              eq(jobAssignmentsTable.subcontractorId, subcontractorId),
            ),
          );
        const scheduledOrder = existingForSub.reduce((max, assignment) => Math.max(max, assignment.scheduledOrder), 0) + 1;

        const [assignment] = await db
          .insert(jobAssignmentsTable)
          .values({
            companyId: tenantId,
            dispatchDate,
            scheduledOrder,
            jobId,
            subcontractorId,
            workArea: proposedWorkArea,
            timeWindow: "full_day",
            estimatedMetres: proposed.estimatedMetres != null && Number.isFinite(Number(proposed.estimatedMetres)) ? String(Number(proposed.estimatedMetres)) : null,
            builderContactName: job.builderContactName ?? null,
            builderContactPhone: job.builderContactPhone ?? null,
            requiredColours: Array.isArray(proposed.requiredColours) ? proposed.requiredColours : Array.isArray(job.requiredColours) ? job.requiredColours : [],
            notes: proposed.routeNote ?? "Created from approved weekly planner proposal.",
            status: "pending",
          })
          .returning();
        createdAssignments.push(assignment);

        try {
          await createAndSendNotification({
            subcontractorId,
            type: "new_job",
            title: "New job assigned",
            body: `${job.title}${assignment.workArea ? ` - ${assignment.workArea}` : ""}${job.address ? ` at ${job.address}` : ""}`,
            priority: "high",
            actionUrl: "/field",
            linkedEntityType: "job_assignment",
            linkedEntityId: assignment.id,
          });
        } catch (err) {
          req.log.warn({ err, assignmentId: assignment.id }, "Failed to send weekly planner assignment notification");
        }
      }
    }
  }

  return res.json({ ...row, createdAssignments });
});

export default router;

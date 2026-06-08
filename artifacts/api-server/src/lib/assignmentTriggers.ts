import { db } from "@workspace/db";
import {
  activityTable,
  allocationRecommendationsTable,
  builderProfilesTable,
  customersTable,
  jobAssignmentsTable,
  jobsTable,
  leaveRequestsTable,
  stockItemsTable,
  subInventoryTable,
  subcontractorsTable,
  workSessionsTable,
  workerSkillsTable,
} from "@workspace/db";
import { and, eq, gte, lte } from "drizzle-orm";
import { createAndSendNotification } from "./notificationService.js";
import { logger } from "./logger.js";

const TIER_QUALITY_MIN: Record<string, number> = {
  premium: 90,
  high_end: 80,
  standard: 60,
  production: 40,
  budget: 0,
  custom: 0,
};

const ADMIN_REVIEW_TIERS = new Set(["premium", "high_end"]);
const AUTO_ASSIGN_SCORE = 82;
const AUTO_ASSIGN_MARGIN = 8;
const MAX_JOBS_PER_DAY = 4;
const DEFAULT_FULL_TIME_DAYS = [1, 2, 3, 4, 5];

type JobRow = typeof jobsTable.$inferSelect;
type CustomerRow = typeof customersTable.$inferSelect;
type WorkerSkillsRow = typeof workerSkillsTable.$inferSelect;
type StockRequirements = {
  productKeywords: string[];
  colourKeywords: string[];
  label: string;
};

type TriggerName = "created" | "updated";

type AssignmentTriggerOptions = {
  reassignAssignmentId?: number;
  excludeSubcontractorIds?: number[];
  requireNotClockedOffOnDate?: boolean;
  allowBestAvailable?: boolean;
  reason?: string;
};

type Candidate = {
  subcontractorId: number;
  subcontractorName: string;
  suitabilityScore: number;
  recommendation: "recommended" | "suitable" | "possible" | "not_recommended";
  reasons: string[];
  warnings: string[];
  hardBlocks: string[];
  rank?: number;
  availableOnDate: boolean;
  scheduleFit: boolean;
  skillMatch: boolean;
  stockMatch: boolean;
  stockShortfall: string[];
  builderTierMatch: boolean;
  qualityScore: number;
  callbackRate: number;
  sameDayJobs: number;
  employmentType: string;
  dailyCapacity: number;
  nearbyJobSuburb: string | null;
  triggerDecision: "auto_eligible" | "review_required" | "blocked";
};

export type AssignmentTriggerResult = {
  status:
    | "auto_assigned"
    | "admin_review_required"
    | "existing_assignment_synced"
    | "existing_assignment_kept"
    | "skipped";
  reason: string;
  jobAssignmentId?: number;
  recommendationId?: number;
  selectedSubcontractorId?: number;
  warnings?: string[];
};

function dateOnly(value: string | Date | null | undefined) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().split("T")[0];
  return value.split("T")[0];
}

function jobDispatchDate(job: JobRow) {
  return dateOnly(job.scheduledDate) ?? dateOnly(job.dueDate);
}

function textBag(job: JobRow, customer: CustomerRow | null) {
  return [
    job.title,
    job.description,
    job.notes,
    job.address,
    job.builderContactName,
    customer?.name,
    customer?.company,
    customer?.notes,
    ...(Array.isArray(job.requiredColours) ? job.requiredColours : []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function inferJobType(text: string) {
  if (text.includes("pool")) return "pool";
  if (text.includes("car park") || text.includes("carpark")) return "car_park";
  if (text.includes("commercial")) return "commercial";
  return "residential";
}

function inferProductType(text: string) {
  if (text.includes("sikaflex")) return "sikaflex";
  if (text.includes("sikasil")) return "silicone";
  if (text.includes("sika")) return "sikaflex";
  if (text.includes("fire")) return "fire_rated";
  if (text.includes("waterproof")) return "waterproofing";
  return "silicone";
}

function inferSuburb(job: JobRow, customer: CustomerRow | null) {
  if (customer?.suburb) return customer.suburb.trim();
  const address = job.address?.trim();
  if (!address) return "";
  const parts = address.split(",").map((part) => part.trim()).filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : parts[0] ?? "";
}

function qualityFor(skills: WorkerSkillsRow | null) {
  return skills?.qualityScore ? Number(skills.qualityScore) : 80;
}

function callbackFor(skills: WorkerSkillsRow | null) {
  return skills?.callbackRate ? Number(skills.callbackRate) : 0;
}

function scoreToRecommendation(score: number): Candidate["recommendation"] {
  if (score >= 82) return "recommended";
  if (score >= 65) return "suitable";
  if (score >= 45) return "possible";
  return "not_recommended";
}

function normalizeAvailableDays(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const days = value
    .map((day) => Number(day))
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
  return Array.from(new Set(days)).sort((a, b) => a - b);
}

function dispatchWeekday(date: string) {
  return new Date(`${date}T12:00:00`).getDay();
}

function employmentLabel(value?: string | null) {
  if (value === "full_time") return "Full-time";
  if (value === "part_time") return "Part-time";
  return "Casual";
}

function dailyCapacityForEmployment(value?: string | null) {
  return value === "full_time" ? MAX_JOBS_PER_DAY : 2;
}

function scheduleAvailabilityForSub(
  sub: typeof subcontractorsTable.$inferSelect,
  dispatchDate: string,
) {
  const employmentType = sub.employmentType ?? "casual";
  const configuredDays = normalizeAvailableDays(sub.availableDays);
  const allowedDays =
    configuredDays && configuredDays.length > 0
      ? configuredDays
      : employmentType === "full_time"
        ? DEFAULT_FULL_TIME_DAYS
        : null;
  const weekday = dispatchWeekday(dispatchDate);
  const available = allowedDays ? allowedDays.includes(weekday) : true;

  return {
    available,
    employmentType,
    label: employmentLabel(employmentType),
    dailyCapacity: dailyCapacityForEmployment(employmentType),
    hasConfiguredDays: Boolean(configuredDays && configuredDays.length > 0),
  };
}

function checkSkillRules(
  skills: WorkerSkillsRow | null,
  productType: string,
  jobType: string,
  text: string,
) {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const hardBlocks: string[] = [];

  if (!skills) {
    warnings.push("No internal skill matrix yet");
    return { reasons, warnings, hardBlocks, skillMatch: false, scoreDelta: -8 };
  }

  let scoreDelta = 0;

  if (productType === "sikaflex") {
    if (skills.canSikaflex) {
      reasons.push("Sikaflex qualified");
      scoreDelta += 8;
    } else {
      hardBlocks.push("Sikaflex skill required");
      scoreDelta -= 35;
    }
  }

  if (productType === "fire_rated") {
    if (skills.canFireRated) {
      reasons.push("Fire-rated sealing qualified");
      scoreDelta += 10;
    } else {
      hardBlocks.push("Fire-rated skill required");
      scoreDelta -= 40;
    }
  }

  if (productType === "waterproofing") {
    if (skills.canWaterproofing) {
      reasons.push("Waterproofing qualified");
      scoreDelta += 8;
    } else {
      hardBlocks.push("Waterproofing skill required");
      scoreDelta -= 35;
    }
  }

  if (productType === "silicone") {
    if (skills.canSilicone) {
      reasons.push("Silicone qualified");
      scoreDelta += 6;
    } else {
      warnings.push("Silicone skill not ticked in skill matrix");
      scoreDelta -= 10;
    }
  }

  if (jobType === "pool") {
    if (skills.canPools) {
      reasons.push("Pool work qualified");
      scoreDelta += 8;
    } else {
      hardBlocks.push("Pool skill required");
      scoreDelta -= 30;
    }
  }

  if (jobType === "commercial") {
    if (skills.canCommercial) {
      reasons.push("Commercial experience");
      scoreDelta += 5;
    } else {
      warnings.push("Commercial experience not marked");
      scoreDelta -= 8;
    }
  }

  if (jobType === "car_park") {
    if (skills.canCarParks) {
      reasons.push("Car park experience");
      scoreDelta += 6;
    } else {
      warnings.push("Car park experience not marked");
      scoreDelta -= 8;
    }
  }

  if (text.includes("backer rod")) {
    if (skills.canBackerRod) reasons.push("Backer rod qualified");
    else warnings.push("Backer rod skill not marked");
  }

  const customSkills = Array.isArray(skills.customSkills) ? skills.customSkills.map(String) : [];
  if (text.includes("scissor") && !customSkills.some((skill) => skill.toLowerCase().includes("scissor"))) {
    warnings.push("Scissor lift requirement should be checked in licences");
    scoreDelta -= 4;
  }

  return {
    reasons,
    warnings,
    hardBlocks,
    skillMatch: hardBlocks.length === 0,
    scoreDelta,
  };
}

function productKeywords(productType: string) {
  if (productType === "sikaflex") return ["sikaflex", "sika flex"];
  if (productType === "fire_rated") return ["fire rated", "fire-rated", "fire"];
  if (productType === "waterproofing") return ["waterproofing", "waterproof"];
  return ["silicone", "sikasil", "sika sil"];
}

function stockRequirements(productType: string, colours: unknown): StockRequirements {
  const colourKeywords: string[] = [];
  if (Array.isArray(colours)) {
    for (const colour of colours) {
      if (typeof colour === "string" && colour.trim()) colourKeywords.push(colour.trim().toLowerCase());
    }
  }
  const productLabel = productType.replace("_", " ");
  const label = colourKeywords.length > 0
    ? `${productLabel} in ${colourKeywords.join(", ")}`
    : productLabel;
  return {
    productKeywords: productKeywords(productType),
    colourKeywords,
    label,
  };
}

function stockItemMatches(item: typeof stockItemsTable.$inferSelect, requirements: StockRequirements) {
  const haystack = [item.name, item.colour].filter(Boolean).join(" ").toLowerCase();
  const productMatch = requirements.productKeywords.some((keyword) => haystack.includes(keyword));
  const colourMatch =
    requirements.colourKeywords.length === 0 ||
    requirements.colourKeywords.some((keyword) => haystack.includes(keyword));
  return productMatch && colourMatch;
}

async function loadCustomer(job: JobRow, tenantId: number) {
  if (!job.customerId) return null;
  const [customer] = await db
    .select()
    .from(customersTable)
    .where(and(eq(customersTable.id, job.customerId), eq(customersTable.companyId, tenantId)));
  return customer ?? null;
}

async function loadBuilderProfile(job: JobRow, tenantId: number, customer: CustomerRow | null) {
  const builders = await db
    .select()
    .from(builderProfilesTable)
    .where(and(eq(builderProfilesTable.companyId, tenantId), eq(builderProfilesTable.active, true)));

  const byCustomer = builders.find((builder) => builder.customerId && builder.customerId === job.customerId);
  if (byCustomer) return byCustomer;

  const names = [customer?.company, customer?.name, job.builderContactName]
    .filter(Boolean)
    .map((name) => String(name).toLowerCase());

  return builders.find((builder) => {
    const builderName = builder.name.toLowerCase();
    return names.some((name) => builderName === name || builderName.includes(name) || name.includes(builderName));
  }) ?? null;
}

async function syncExistingAssignment(
  job: JobRow,
  tenantId: number,
  dispatchDate: string,
  existing: typeof jobAssignmentsTable.$inferSelect,
): Promise<AssignmentTriggerResult> {
  if (existing.status !== "pending") {
    return {
      status: "existing_assignment_kept",
      reason: "Job already has an active/completed dispatch assignment; trigger will not override it",
      jobAssignmentId: existing.id,
    };
  }

  const [updated] = await db
    .update(jobAssignmentsTable)
    .set({
      dispatchDate,
      builderContactName: job.builderContactName ?? null,
      builderContactPhone: job.builderContactPhone ?? null,
      requiredColours: Array.isArray(job.requiredColours) ? job.requiredColours : [],
    })
    .where(and(eq(jobAssignmentsTable.id, existing.id), eq(jobAssignmentsTable.companyId, tenantId)))
    .returning();

  if (updated.subcontractorId) {
    try {
      await createAndSendNotification({
        subcontractorId: updated.subcontractorId,
        type: "job_changed",
        title: "Job details updated",
        body: `${job.title} has been updated. Check the field view before attending site.`,
        priority: "normal",
        actionUrl: "/field",
        linkedEntityType: "job_assignment",
        linkedEntityId: updated.id,
      });
    } catch (err) {
      logger.warn({ err, jobId: job.id, assignmentId: updated.id }, "Failed to send trigger sync notification");
    }
  }

  return {
    status: "existing_assignment_synced",
    reason: "Existing pending assignment was synced with the latest job details",
    jobAssignmentId: updated.id,
  };
}

async function saveRecommendation(
  tenantId: number,
  jobId: number,
  date: string,
  candidates: Candidate[],
  warnings: string[],
  selectedSubcontractorId?: number,
  jobAssignmentId?: number,
) {
  const [saved] = await db
    .insert(allocationRecommendationsTable)
    .values({
      companyId: tenantId,
      jobId,
      jobAssignmentId: jobAssignmentId ?? null,
      requestedDate: date,
      requestedById: "trigger",
      recommendations: candidates,
      selectedSubcontractorId: selectedSubcontractorId ?? null,
      selectionMethod: selectedSubcontractorId ? "auto" : "auto",
      warnings,
    })
    .returning();
  return saved;
}

export async function runJobAssignmentTriggers({
  tenantId,
  job,
  trigger,
  options = {},
}: {
  tenantId: number;
  job: JobRow;
  trigger: TriggerName;
  options?: AssignmentTriggerOptions;
}): Promise<AssignmentTriggerResult> {
  if (!["pending", "in_progress"].includes(job.status)) {
    return { status: "skipped", reason: `Job status ${job.status} is not eligible for assignment triggers` };
  }

  const dispatchDate = jobDispatchDate(job);
  if (!dispatchDate) {
    return { status: "skipped", reason: "Job has no scheduled or due date yet" };
  }

  let assignmentToReassign: typeof jobAssignmentsTable.$inferSelect | undefined;
  if (options.reassignAssignmentId) {
    [assignmentToReassign] = await db
      .select()
      .from(jobAssignmentsTable)
      .where(and(eq(jobAssignmentsTable.companyId, tenantId), eq(jobAssignmentsTable.id, options.reassignAssignmentId)))
      .limit(1);

    if (!assignmentToReassign || assignmentToReassign.jobId !== job.id) {
      return { status: "skipped", reason: "Reassignment work block could not be found for this job" };
    }
    if (assignmentToReassign.status !== "pending") {
      return {
        status: "skipped",
        reason: "Only pending work blocks can be automatically reassigned",
        jobAssignmentId: assignmentToReassign.id,
      };
    }
  }

  const existingAssignments = await db
    .select()
    .from(jobAssignmentsTable)
    .where(and(eq(jobAssignmentsTable.companyId, tenantId), eq(jobAssignmentsTable.jobId, job.id)))
    .limit(10);
  const existingAssignment = assignmentToReassign
    ? undefined
    : existingAssignments.find((assignment) => assignment.id !== options.reassignAssignmentId);

  if (existingAssignment) {
    return syncExistingAssignment(job, tenantId, dispatchDate, existingAssignment);
  }

  const customer = await loadCustomer(job, tenantId);
  const builderProfile = await loadBuilderProfile(job, tenantId, customer);
  const bag = textBag(job, customer);
  const productType = inferProductType(bag);
  const jobType = inferJobType(bag);
  const suburb = inferSuburb(job, customer);
  const requiredStock = stockRequirements(productType, job.requiredColours);

  const [subs, allSkills, allLeave, sameDayAssignments, nearbyAssignments, stockItems, inventory, workSessions] = await Promise.all([
    db
      .select()
      .from(subcontractorsTable)
      .where(and(eq(subcontractorsTable.companyId, tenantId), eq(subcontractorsTable.active, true))),
    db.select().from(workerSkillsTable).where(eq(workerSkillsTable.companyId, tenantId)),
    db
      .select()
      .from(leaveRequestsTable)
      .where(
        and(
          eq(leaveRequestsTable.companyId, tenantId),
          eq(leaveRequestsTable.dayOffDate, dispatchDate),
          eq(leaveRequestsTable.status, "approved"),
        ),
      ),
    db
      .select()
      .from(jobAssignmentsTable)
      .where(and(eq(jobAssignmentsTable.companyId, tenantId), eq(jobAssignmentsTable.dispatchDate, dispatchDate))),
    db
      .select({
        assignment: jobAssignmentsTable,
        job: jobsTable,
      })
      .from(jobAssignmentsTable)
      .leftJoin(jobsTable, eq(jobAssignmentsTable.jobId, jobsTable.id))
      .where(
        and(
          eq(jobAssignmentsTable.companyId, tenantId),
          gte(jobAssignmentsTable.dispatchDate, (() => {
            const d = new Date(dispatchDate);
            d.setDate(d.getDate() - 1);
            return d.toISOString().split("T")[0];
          })()),
          lte(jobAssignmentsTable.dispatchDate, (() => {
            const d = new Date(dispatchDate);
            d.setDate(d.getDate() + 1);
            return d.toISOString().split("T")[0];
          })()),
        ),
      ),
    db.select().from(stockItemsTable).where(eq(stockItemsTable.companyId, tenantId)),
    db.select().from(subInventoryTable).where(eq(subInventoryTable.companyId, tenantId)),
    db
      .select()
      .from(workSessionsTable)
      .where(and(eq(workSessionsTable.companyId, tenantId), eq(workSessionsTable.date, dispatchDate))),
  ]);

  if (subs.length === 0) {
    const saved = await saveRecommendation(tenantId, job.id, dispatchDate, [], ["No active employees/subcontractors are available"]);
    return {
      status: "admin_review_required",
      reason: "No active employees/subcontractors found",
      recommendationId: saved.id,
      warnings: ["No active employees/subcontractors are available"],
    };
  }

  const skillBySub = new Map(allSkills.map((row) => [row.subcontractorId, row]));
  const leaveBySub = new Set(allLeave.map((row) => row.subcontractorId));
  const workSessionBySub = new Map(workSessions.map((row) => [row.subcontractorId, row]));
  const excludedSubIds = new Set(options.excludeSubcontractorIds ?? []);
  const availableSameDayAssignments = sameDayAssignments.filter((assignment) => assignment.id !== options.reassignAssignmentId);
  const inventoryBySub = new Map<number, Map<number, number>>();
  for (const row of inventory) {
    const subInventory = inventoryBySub.get(row.subcontractorId) ?? new Map<number, number>();
    subInventory.set(row.stockItemId, Number(row.currentQuantity));
    inventoryBySub.set(row.subcontractorId, subInventory);
  }

  const relevantStockItems = stockItems.filter((item) => stockItemMatches(item, requiredStock));

  const candidates = subs.map((sub): Candidate => {
    const skills = skillBySub.get(sub.id) ?? null;
    const reasons: string[] = [];
    const warnings: string[] = [];
    const hardBlocks: string[] = [];
    let score = 65;
    const schedule = scheduleAvailabilityForSub(sub, dispatchDate);
    reasons.push(`${schedule.label} schedule`);
    if (!schedule.hasConfiguredDays && schedule.employmentType !== "full_time") {
      warnings.push(`${schedule.label} availability days are not set yet`);
      score -= 4;
    }
    if (!schedule.available) {
      hardBlocks.push(`${schedule.label} schedule is not available on this date`);
      score -= 55;
    }

    if (excludedSubIds.has(sub.id)) {
      hardBlocks.push("Employee/subcontractor has been removed from this day's remaining work");
      score -= 60;
    }

    const workerSession = workSessionBySub.get(sub.id);
    if (options.requireNotClockedOffOnDate && workerSession?.status === "clocked_off") {
      hardBlocks.push("Already clocked off today");
      score -= 45;
    }

    const sameDayJobs = availableSameDayAssignments.filter((assignment) => assignment.subcontractorId === sub.id).length;
    if (sameDayJobs === 0) {
      reasons.push("Available with no jobs already assigned that day");
      score += 14;
    } else if (sameDayJobs < schedule.dailyCapacity) {
      reasons.push(`${sameDayJobs} existing job(s) that day - can group route`);
      score += Math.max(0, 8 - sameDayJobs * 2);
    } else {
      hardBlocks.push(`Already has ${sameDayJobs} job(s) on this date for ${schedule.label} capacity`);
      score -= 35;
    }

    if (leaveBySub.has(sub.id)) {
      hardBlocks.push("Approved day off on this date");
      score -= 60;
    }

    const skillResult = checkSkillRules(skills, productType, jobType, bag);
    reasons.push(...skillResult.reasons);
    warnings.push(...skillResult.warnings);
    hardBlocks.push(...skillResult.hardBlocks);
    score += skillResult.scoreDelta;

    const quality = qualityFor(skills);
    const callbackRate = callbackFor(skills);
    const requiredQuality = builderProfile ? TIER_QUALITY_MIN[builderProfile.qualityTier] ?? 0 : 0;
    const builderTierMatch = quality >= requiredQuality;
    if (builderProfile && builderTierMatch) {
      reasons.push(`Quality score ${quality} meets ${builderProfile.qualityTier} builder rule`);
      score += builderProfile.qualityTier === "premium" ? 10 : 5;
    } else if (builderProfile && !builderTierMatch) {
      hardBlocks.push(`Quality score ${quality} below ${builderProfile.qualityTier} builder rule`);
      score -= 25;
    }

    if (callbackRate <= 5) {
      reasons.push(`Low callback rate: ${callbackRate}%`);
      score += 4;
    } else if (callbackRate > 15) {
      warnings.push(`High callback rate: ${callbackRate}%`);
      score -= 8;
    }

    const preferredIds = Array.isArray(builderProfile?.preferredWorkerIds) ? builderProfile.preferredWorkerIds.map(Number) : [];
    const avoidedIds = Array.isArray(builderProfile?.avoidedWorkerIds) ? builderProfile.avoidedWorkerIds.map(Number) : [];
    if (preferredIds.includes(sub.id)) {
      reasons.push("Builder preferred employee/subcontractor");
      score += 16;
    }
    if (avoidedIds.includes(sub.id)) {
      hardBlocks.push("Builder requested to avoid this employee/subcontractor");
      score -= 60;
    }

    let nearbyJobSuburb: string | null = null;
    if (suburb) {
      const nearby = nearbyAssignments.find((row) => {
        if (row.assignment.subcontractorId !== sub.id) return false;
        const otherAddress = row.job?.address?.toLowerCase() ?? "";
        return otherAddress.includes(suburb.toLowerCase());
      });
      if (nearby) {
        nearbyJobSuburb = suburb;
        reasons.push(`Nearby existing job around ${suburb}`);
        score += 10;
      }
    }

    let stockMatch = true;
    const stockShortfall: string[] = [];
    if (relevantStockItems.length > 0) {
      const subStock = inventoryBySub.get(sub.id) ?? new Map<number, number>();
      stockMatch = relevantStockItems.some((item) => (subStock.get(item.id) ?? 0) > 0);
      if (stockMatch) {
        reasons.push("Required product/colour appears to be in subcontractor stock");
        score += 8;
      } else {
        stockShortfall.push(`No matching stock for ${requiredStock.label}`);
        warnings.push("Matching stock is not currently assigned to this employee/subcontractor");
        score -= 15;
      }
    } else {
      warnings.push("No matching stock item is configured yet, so stock could not be verified");
      score -= 3;
    }

    const availableOnDate = schedule.available && !leaveBySub.has(sub.id) && sameDayJobs < schedule.dailyCapacity;
    score = hardBlocks.length > 0 ? Math.min(score, 40) : score;
    score = Math.max(0, Math.min(100, Math.round(score)));

    const reviewRequired =
      hardBlocks.length > 0 ||
      (builderProfile ? ADMIN_REVIEW_TIERS.has(builderProfile.qualityTier) : false) ||
      !skillResult.skillMatch ||
      !stockMatch;

    return {
      subcontractorId: sub.id,
      subcontractorName: sub.name,
      suitabilityScore: score,
      recommendation: scoreToRecommendation(score),
      reasons,
      warnings,
      hardBlocks,
      availableOnDate,
      scheduleFit: availableOnDate,
      skillMatch: skillResult.skillMatch,
      stockMatch,
      stockShortfall,
      builderTierMatch,
      qualityScore: quality,
      callbackRate,
      sameDayJobs,
      employmentType: schedule.employmentType,
      dailyCapacity: schedule.dailyCapacity,
      nearbyJobSuburb,
      triggerDecision: hardBlocks.length > 0 ? "blocked" : reviewRequired ? "review_required" : "auto_eligible",
    };
  });

  const ranked = candidates
    .sort((a, b) => b.suitabilityScore - a.suitabilityScore)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));

  const top = ranked[0];
  const second = ranked[1];
  const warnings: string[] = [];
  if (builderProfile && ADMIN_REVIEW_TIERS.has(builderProfile.qualityTier)) {
    warnings.push(`${builderProfile.qualityTier} builder profile requires admin approval`);
  }
  if (ranked.every((candidate) => candidate.hardBlocks.length > 0)) {
    warnings.push("No employee/subcontractor passed all trigger rules");
  }
  if (ranked.every((candidate) => !candidate.stockMatch)) {
    warnings.push("Stock could not be verified for any employee/subcontractor");
  }

  const clearWinner =
    top &&
    top.triggerDecision === "auto_eligible" &&
    top.suitabilityScore >= AUTO_ASSIGN_SCORE &&
    (!second || top.suitabilityScore - second.suitabilityScore >= AUTO_ASSIGN_MARGIN || top.suitabilityScore >= 92);

  const canUseBestAvailable =
    options.allowBestAvailable &&
    top &&
    top.triggerDecision !== "blocked" &&
    top.availableOnDate;

  if ((!clearWinner && !canUseBestAvailable) || !top) {
    const saved = await saveRecommendation(tenantId, job.id, dispatchDate, ranked, warnings);
    await db.insert(activityTable).values({
      companyId: tenantId,
      type: "job_updated",
      description: `Assignment trigger saved ${job.title} for admin review`,
      entityId: job.id,
      entityType: "job",
    });
    return {
      status: "admin_review_required",
      reason: top ? "No clear auto-assignment match; saved recommendation for admin review" : "No candidates found",
      recommendationId: saved.id,
      warnings,
    };
  }

  const existingForSub = availableSameDayAssignments.filter((assignment) => assignment.subcontractorId === top.subcontractorId);
  const scheduledOrder = existingForSub.reduce((max, assignment) => Math.max(max, assignment.scheduledOrder), 0) + 1;
  let assignment: typeof jobAssignmentsTable.$inferSelect;

  if (assignmentToReassign) {
    const reassignmentNote = `Reassigned by trigger rules${options.reason ? `: ${options.reason}` : ""}. Score ${top.suitabilityScore}/100.`;
    const notes = [assignmentToReassign.notes, reassignmentNote].filter(Boolean).join("\n");
    const [updatedAssignment] = await db
      .update(jobAssignmentsTable)
      .set({
        dispatchDate,
        scheduledOrder,
        subcontractorId: top.subcontractorId,
        builderContactName: job.builderContactName ?? assignmentToReassign.builderContactName,
        builderContactPhone: job.builderContactPhone ?? assignmentToReassign.builderContactPhone,
        requiredColours: Array.isArray(job.requiredColours) ? job.requiredColours : assignmentToReassign.requiredColours,
        notes,
        status: "pending",
      })
      .where(and(eq(jobAssignmentsTable.id, assignmentToReassign.id), eq(jobAssignmentsTable.companyId, tenantId)))
      .returning();
    assignment = updatedAssignment;
  } else {
    const [insertedAssignment] = await db
      .insert(jobAssignmentsTable)
      .values({
        companyId: tenantId,
        dispatchDate,
        scheduledOrder,
        jobId: job.id,
        subcontractorId: top.subcontractorId,
        builderContactName: job.builderContactName ?? null,
        builderContactPhone: job.builderContactPhone ?? null,
        requiredColours: Array.isArray(job.requiredColours) ? job.requiredColours : [],
        notes: `Auto-assigned by trigger rules after job ${trigger}. Score ${top.suitabilityScore}/100.`,
        status: "pending",
      })
      .returning();
    assignment = insertedAssignment;
  }

  const saved = await saveRecommendation(tenantId, job.id, dispatchDate, ranked, warnings, top.subcontractorId, assignment.id);

  try {
    await createAndSendNotification({
      subcontractorId: top.subcontractorId,
      type: "new_job",
      title: "New job assigned",
      body: `${job.title}${suburb ? ` in ${suburb}` : ""}`,
      priority: "high",
      actionUrl: "/field",
      linkedEntityType: "job_assignment",
      linkedEntityId: assignment.id,
    });
  } catch (err) {
    logger.warn({ err, jobId: job.id, assignmentId: assignment.id }, "Failed to send trigger assignment notification");
  }

  await db.insert(activityTable).values({
    companyId: tenantId,
    type: "job_updated",
    description: assignmentToReassign
      ? `Assignment trigger reassigned "${job.title}" to ${top.subcontractorName}`
      : `Assignment trigger auto-assigned "${job.title}" to ${top.subcontractorName}`,
    entityId: job.id,
    entityType: "job",
  });

  return {
    status: "auto_assigned",
    reason: clearWinner
      ? `Clear trigger match: ${top.subcontractorName} scored ${top.suitabilityScore}/100`
      : `Best available reassignment: ${top.subcontractorName} scored ${top.suitabilityScore}/100`,
    jobAssignmentId: assignment.id,
    recommendationId: saved.id,
    selectedSubcontractorId: top.subcontractorId,
    warnings,
  };
}

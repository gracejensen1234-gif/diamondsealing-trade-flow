import { Router } from "express";
import { db } from "@workspace/db";
import {
  activityTable,
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
import { companyId, requireAdmin } from "../lib/auth.js";
import { createAndSendNotification } from "../lib/notificationService.js";
import { dateOnly } from "../lib/date-utils.js";
import { getAuditModel, getOpenAIClient } from "../lib/openai-client.js";
import { runJobAssignmentTriggers } from "../lib/assignmentTriggers.js";
import type OpenAI from "openai";

const router = Router();

const TIER_QUALITY_MIN: Record<string, number> = {
  premium: 90,
  high_end: 80,
  standard: 60,
  production: 40,
  budget: 0,
  custom: 0,
};

type IntakeJobDraft = {
  title: string;
  clientName?: string | null;
  builderName?: string | null;
  customerId?: number | null;
  builderProfileId?: number | null;
  address?: string | null;
  suburb?: string | null;
  description?: string | null;
  builderContactName?: string | null;
  builderContactPhone?: string | null;
  requiredColours?: string[];
  scheduledDate?: string | null;
  dueDate?: string | null;
  productType?: string | null;
  jobType?: string | null;
  estimatedMetres?: number | null;
  workArea?: string | null;
  timeWindow?: string | null;
  plannedStartTime?: string | null;
  plannedEndTime?: string | null;
  notes?: string | null;
  confidence?: number;
  needsReview?: boolean;
  sourceSummary?: string | null;
};

function cleanText(value: unknown) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || null;
}

function cleanStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
}

function cleanNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function cleanConfidence(value: unknown) {
  const numeric = cleanNumber(value);
  if (numeric === null) return 0.5;
  const zeroToOne = numeric > 1 ? numeric / 100 : numeric;
  return Math.max(0, Math.min(1, zeroToOne));
}

function normalizeName(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function matchByName<T extends { name: string; company?: string | null }>(
  rows: T[],
  value: unknown,
) {
  const needle = normalizeName(value);
  if (!needle) return null;
  return (
    rows.find((row) => {
      const names = [row.name, row.company].filter(Boolean).map(normalizeName);
      return names.some(
        (name) =>
          name === needle || name.includes(needle) || needle.includes(name),
      );
    }) ?? null
  );
}

function sanitizeIntakeDraft(
  rawDraft: unknown,
  customers: (typeof customersTable.$inferSelect)[],
  builders: (typeof builderProfilesTable.$inferSelect)[],
): IntakeJobDraft | null {
  if (typeof rawDraft !== "object" || rawDraft === null) return null;
  const raw = rawDraft as Record<string, unknown>;
  const builderById = builders.find(
    (builder) => builder.id === Number(raw.builderProfileId),
  );
  const customerById = customers.find(
    (customer) => customer.id === Number(raw.customerId),
  );
  const builderByName =
    builderById ?? matchByName(builders, raw.builderName ?? raw.clientName);
  const customerByName =
    customerById ??
    (builderByName?.customerId
      ? customers.find((customer) => customer.id === builderByName.customerId)
      : null) ??
    matchByName(customers, raw.clientName ?? raw.builderName);
  const clientName =
    cleanText(raw.clientName) ??
    cleanText(raw.builderName) ??
    customerByName?.name ??
    builderByName?.name ??
    null;
  const title =
    (cleanText(raw.title) ??
      [clientName, cleanText(raw.address), cleanText(raw.workArea)]
        .filter(Boolean)
        .join(" - ")) ||
    "Job from intake";
  const scheduledDate = dateOnly(cleanText(raw.scheduledDate));
  const dueDate = dateOnly(cleanText(raw.dueDate));
  const estimatedMetres = cleanNumber(raw.estimatedMetres);
  const confidence = cleanConfidence(raw.confidence);

  return {
    title,
    clientName,
    builderName: cleanText(raw.builderName) ?? builderByName?.name ?? null,
    customerId: customerByName?.id ?? null,
    builderProfileId: builderByName?.id ?? null,
    address: cleanText(raw.address),
    suburb: cleanText(raw.suburb) ?? customerByName?.suburb ?? null,
    description: cleanText(raw.description),
    builderContactName:
      cleanText(raw.builderContactName) ??
      cleanText(raw.contactName) ??
      builderByName?.contactName ??
      null,
    builderContactPhone:
      cleanText(raw.builderContactPhone) ??
      cleanText(raw.contactPhone) ??
      builderByName?.contactPhone ??
      null,
    requiredColours: cleanStringArray(raw.requiredColours),
    scheduledDate,
    dueDate,
    productType: cleanText(raw.productType) ?? "silicone",
    jobType: cleanText(raw.jobType) ?? "residential",
    estimatedMetres,
    workArea: cleanText(raw.workArea),
    timeWindow: cleanText(raw.timeWindow) ?? "full_day",
    plannedStartTime: cleanText(raw.plannedStartTime),
    plannedEndTime: cleanText(raw.plannedEndTime),
    notes: cleanText(raw.notes),
    confidence,
    needsReview:
      Boolean(raw.needsReview) ||
      confidence < 0.7 ||
      !scheduledDate ||
      !cleanText(raw.address),
    sourceSummary: cleanText(raw.sourceSummary),
  };
}

function jobNotesFromDraft(draft: IntakeJobDraft) {
  return [
    draft.notes,
    draft.sourceSummary ? `Source: ${draft.sourceSummary}` : null,
    draft.productType ? `Product type: ${draft.productType}` : null,
    draft.jobType ? `Job type: ${draft.jobType}` : null,
    draft.workArea ? `Work block: ${draft.workArea}` : null,
    draft.estimatedMetres ? `Estimated metres: ${draft.estimatedMetres}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

interface SubInfo {
  id: number;
  name: string;
  skills: typeof workerSkillsTable.$inferSelect | null;
  inventory: Map<number, number>;
  assignedDates: string[];
  assignedSuburbs: string[];
}

async function loadSubInfo(
  companyAccountId: number,
  date: string,
): Promise<SubInfo[]> {
  const subs = await db
    .select()
    .from(subcontractorsTable)
    .where(
      and(
        eq(subcontractorsTable.companyId, companyAccountId),
        eq(subcontractorsTable.active, true),
      ),
    );
  return Promise.all(
    subs.map(async (sub) => {
      const [skills] = await db
        .select()
        .from(workerSkillsTable)
        .where(
          and(
            eq(workerSkillsTable.companyId, companyAccountId),
            eq(workerSkillsTable.subcontractorId, sub.id),
          ),
        )
        .limit(1);
      const invRows = await db
        .select()
        .from(subInventoryTable)
        .where(
          and(
            eq(subInventoryTable.companyId, companyAccountId),
            eq(subInventoryTable.subcontractorId, sub.id),
          ),
        );
      const inventory = new Map(
        invRows.map((r) => [r.stockItemId, Number(r.currentQuantity)]),
      );

      // Get existing assignments for proximity calculation
      const assignments = await db
        .select({
          date: jobAssignmentsTable.dispatchDate,
          jobId: jobAssignmentsTable.jobId,
        })
        .from(jobAssignmentsTable)
        .where(
          and(
            eq(jobAssignmentsTable.subcontractorId, sub.id),
            eq(jobAssignmentsTable.companyId, companyAccountId),
            gte(
              jobAssignmentsTable.dispatchDate,
              (() => {
                const d = new Date(date);
                d.setDate(d.getDate() - 3);
                return d.toISOString().split("T")[0];
              })(),
            ),
            lte(
              jobAssignmentsTable.dispatchDate,
              (() => {
                const d = new Date(date);
                d.setDate(d.getDate() + 3);
                return d.toISOString().split("T")[0];
              })(),
            ),
          ),
        );

      const assignedDates = assignments.map((a) => a.date);
      const jobIds = assignments
        .map((a) => a.jobId)
        .filter((jobId): jobId is number => jobId !== null);
      const assignedSuburbs: string[] = [];
      for (const jid of jobIds) {
        const [j] = await db
          .select({
            customerId: jobsTable.customerId,
            address: jobsTable.address,
          })
          .from(jobsTable)
          .where(
            and(
              eq(jobsTable.id, jid),
              eq(jobsTable.companyId, companyAccountId),
            ),
          )
          .limit(1);
        if (j?.customerId) {
          const [customer] = await db
            .select({ suburb: customersTable.suburb })
            .from(customersTable)
            .where(
              and(
                eq(customersTable.id, j.customerId),
                eq(customersTable.companyId, companyAccountId),
              ),
            )
            .limit(1);
          if (customer?.suburb) assignedSuburbs.push(customer.suburb);
        } else if (j?.address) {
          assignedSuburbs.push(j.address);
        }
      }

      return {
        id: sub.id,
        name: sub.name,
        skills: skills ?? null,
        inventory,
        assignedDates,
        assignedSuburbs,
      };
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
    warnings.push(
      "Employee/subcontractor not certified for fire-rated sealing",
    );
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
  if (!stockItemId || !estimatedMetres)
    return {
      match: true,
      shortfall: [],
      reasons: ["No specific stock required"],
    };
  const current = inventory.get(stockItemId) ?? 0;
  const needed = Math.ceil(estimatedMetres / 20); // ~20m per tube
  if (current < needed) {
    return {
      match: false,
      shortfall: [`Needs ~${needed} tubes, has ${current}`],
      reasons: [],
    };
  }
  return {
    match: true,
    shortfall: [],
    reasons: [`✓ Stock: ${current} tubes (needs ~${needed})`],
  };
}

function proximityScore(
  suburb: string,
  assignedSuburbs: string[],
): { score: number; nearbySuburb: string | null } {
  if (!suburb || assignedSuburbs.length === 0)
    return { score: 50, nearbySuburb: null };
  // Simple string match for same/adjacent suburb
  const exact = assignedSuburbs.find(
    (s) => s?.toLowerCase() === suburb?.toLowerCase(),
  );
  if (exact) return { score: 100, nearbySuburb: exact };
  // Partial match (same area prefix, e.g. "South" Brisbane, etc.)
  const partial = assignedSuburbs.find(
    (s) =>
      s &&
      suburb &&
      (s.toLowerCase().includes(suburb.toLowerCase().split(" ")[0]) ||
        suburb.toLowerCase().includes(s.toLowerCase().split(" ")[0])),
  );
  if (partial) return { score: 75, nearbySuburb: partial };
  return { score: 30, nearbySuburb: null };
}

// POST /allocation/job-intake/analyse
router.post(
  "/allocation/job-intake/analyse",
  requireAdmin,
  async (req, res) => {
    const sourceText =
      typeof req.body?.sourceText === "string"
        ? req.body.sourceText.trim()
        : "";
    const imageDataList = [
      ...(Array.isArray(req.body?.imageDataList) ? req.body.imageDataList : []),
      ...(Array.isArray(req.body?.images) ? req.body.images : []),
      req.body?.imageData,
    ]
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 8);

    if (!sourceText && imageDataList.length === 0) {
      return res
        .status(400)
        .json({ error: "Paste job details or upload at least one screenshot" });
    }
    if (
      imageDataList.some((imageData) => !imageData.startsWith("data:image/"))
    ) {
      return res.status(400).json({ error: "Screenshots must be images" });
    }

    const openai = getOpenAIClient();
    if (!openai) {
      return res.status(503).json({
        error:
          "OpenAI is not configured. Add OPENAI_API_KEY before using job intake.",
      });
    }

    const tenantId = companyId(req);
    const [customers, builders] = await Promise.all([
      db
        .select()
        .from(customersTable)
        .where(eq(customersTable.companyId, tenantId)),
      db
        .select()
        .from(builderProfilesTable)
        .where(
          and(
            eq(builderProfilesTable.companyId, tenantId),
            eq(builderProfilesTable.active, true),
          ),
        ),
    ]);
    const knownCustomers = customers
      .map(
        (customer) =>
          `Customer ID ${customer.id}: ${customer.name}${customer.company ? ` / ${customer.company}` : ""}${customer.suburb ? `, ${customer.suburb}` : ""}`,
      )
      .join("\n");
    const knownBuilders = builders
      .map(
        (builder) =>
          `Builder ID ${builder.id}: ${builder.name}, tier ${builder.qualityTier}${builder.customerId ? `, customer ID ${builder.customerId}` : ""}`,
      )
      .join("\n");

    const systemPrompt = `You extract joint sealing job details from builder emails, text messages, screenshots, and short notes.
Return JSON only with key "jobs" containing an array of job/work-block drafts.

Rules:
- Create one draft per distinct job, day, or work block if the message separates units/apartments/areas.
- If multiple screenshots/images are provided, read them together as one job intake packet.
- Use ISO dates YYYY-MM-DD. Infer obvious dates from the message, otherwise leave date fields null and mark needsReview true.
- Keep wording short and practical for dispatch.
- Match existing customerId or builderProfileId when clearly identifiable from the lists.
- requiredColours must be an array of colour names.
- productType should be one of silicone, sikaflex, fire_rated, waterproofing.
- jobType should be residential, commercial, pool, or car_park.
- timeWindow should be full_day, morning, afternoon, or custom.
- Do not invent addresses, dates, phone numbers, colours, or metres. If uncertain, set needsReview true.

Each draft must include:
title, clientName, builderName, customerId, builderProfileId, address, suburb, description, builderContactName, builderContactPhone, requiredColours, scheduledDate, dueDate, productType, jobType, estimatedMetres, workArea, timeWindow, plannedStartTime, plannedEndTime, notes, confidence, needsReview, sourceSummary.`;

    const userContent: OpenAI.ChatCompletionContentPart[] = [
      {
        type: "text",
        text: [
          `Today: ${new Date().toISOString().split("T")[0]}`,
          "Existing clients:",
          knownCustomers || "None",
          "Existing builder profiles:",
          knownBuilders || "None",
          sourceText ? `Source text:\n${sourceText}` : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ];
    for (const imageData of imageDataList) {
      userContent.push({
        type: "image_url",
        image_url: { url: imageData, detail: "high" },
      });
    }

    try {
      const response = await openai.chat.completions.create({
        model: getAuditModel(),
        max_tokens: 2200,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
      });
      const raw = response.choices[0]?.message?.content ?? "{}";
      const parsed = JSON.parse(raw) as { jobs?: unknown[] };
      const drafts = (Array.isArray(parsed.jobs) ? parsed.jobs : [])
        .map((draft) => sanitizeIntakeDraft(draft, customers, builders))
        .filter((draft): draft is IntakeJobDraft => Boolean(draft));

      return res.json({ drafts });
    } catch (error) {
      req.log.error({ err: error }, "AI allocation job intake failed");
      return res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Could not analyse job intake",
      });
    }
  },
);

// POST /allocation/job-intake/create-and-allocate
router.post(
  "/allocation/job-intake/create-and-allocate",
  requireAdmin,
  async (req, res) => {
    const rawDrafts: unknown[] = Array.isArray(req.body?.drafts)
      ? req.body.drafts.slice(0, 25)
      : [];
    if (rawDrafts.length === 0) {
      return res
        .status(400)
        .json({ error: "At least one job draft is required" });
    }

    const tenantId = companyId(req);
    const [customers, builders] = await Promise.all([
      db
        .select()
        .from(customersTable)
        .where(eq(customersTable.companyId, tenantId)),
      db
        .select()
        .from(builderProfilesTable)
        .where(
          and(
            eq(builderProfilesTable.companyId, tenantId),
            eq(builderProfilesTable.active, true),
          ),
        ),
    ]);
    let customerRows = [...customers];
    const drafts = rawDrafts
      .map((draft) => sanitizeIntakeDraft(draft, customerRows, builders))
      .filter((draft): draft is IntakeJobDraft => Boolean(draft));
    if (drafts.length === 0) {
      return res.status(400).json({ error: "No valid job drafts to create" });
    }

    const created: Array<{
      job: typeof jobsTable.$inferSelect;
      assignmentTrigger: Awaited<ReturnType<typeof runJobAssignmentTriggers>>;
      allocationResult: {
        recommendationId?: number;
        recommendations?: unknown;
        warnings?: unknown;
        selectedSubcontractorId?: number | null;
        jobAssignmentId?: number | null;
      } | null;
    }> = [];

    for (const draft of drafts) {
      let customerId = draft.customerId ?? null;
      if (!customerId && draft.clientName) {
        const existing = matchByName(customerRows, draft.clientName);
        if (existing) {
          customerId = existing.id;
        } else {
          const [customer] = await db
            .insert(customersTable)
            .values({
              companyId: tenantId,
              name: draft.clientName,
              company: draft.builderName ?? draft.clientName,
              phone: draft.builderContactPhone ?? null,
              address: draft.address ?? null,
              suburb: draft.suburb ?? null,
              notes: "Created from Smart Allocation job intake.",
            })
            .returning();
          customerRows = [...customerRows, customer];
          customerId = customer.id;
        }
      }

      const notes = jobNotesFromDraft(draft);
      const description = [draft.description, draft.workArea]
        .filter(Boolean)
        .join("\n");
      const [job] = await db
        .insert(jobsTable)
        .values({
          companyId: tenantId,
          title: draft.title,
          description: description || null,
          status: "pending",
          priority: "medium",
          customerId,
          address: draft.address ?? null,
          builderContactName: draft.builderContactName ?? null,
          builderContactPhone: draft.builderContactPhone ?? null,
          requiredColours: draft.requiredColours ?? [],
          scheduledDate: dateOnly(draft.scheduledDate),
          dueDate: dateOnly(draft.dueDate ?? draft.scheduledDate),
          notes: notes || null,
        })
        .returning();

      await db.insert(activityTable).values({
        companyId: tenantId,
        type: "job_created",
        description: `Job "${job.title}" created from Smart Allocation intake`,
        entityId: job.id,
        entityType: "job",
      });

      const assignmentTrigger = await runJobAssignmentTriggers({
        tenantId,
        job,
        trigger: "created",
      });

      if (assignmentTrigger.jobAssignmentId) {
        await db
          .update(jobAssignmentsTable)
          .set({
            workArea: draft.workArea ?? null,
            timeWindow: draft.timeWindow ?? "full_day",
            plannedStartTime: draft.plannedStartTime ?? null,
            plannedEndTime: draft.plannedEndTime ?? null,
            estimatedMetres:
              draft.estimatedMetres != null
                ? String(draft.estimatedMetres)
                : null,
            requiredColours: draft.requiredColours ?? [],
            notes: draft.notes ?? draft.sourceSummary ?? null,
          })
          .where(
            and(
              eq(jobAssignmentsTable.id, assignmentTrigger.jobAssignmentId),
              eq(jobAssignmentsTable.companyId, tenantId),
            ),
          );
      }

      const [recommendation] = assignmentTrigger.recommendationId
        ? await db
            .select()
            .from(allocationRecommendationsTable)
            .where(
              and(
                eq(
                  allocationRecommendationsTable.id,
                  assignmentTrigger.recommendationId,
                ),
                eq(allocationRecommendationsTable.companyId, tenantId),
              ),
            )
        : [];

      created.push({
        job,
        assignmentTrigger,
        allocationResult: recommendation
          ? {
              recommendationId: recommendation.id,
              recommendations: recommendation.recommendations,
              warnings: recommendation.warnings,
              selectedSubcontractorId: recommendation.selectedSubcontractorId,
              jobAssignmentId: recommendation.jobAssignmentId,
            }
          : null,
      });
    }

    return res.status(201).json({ created });
  },
);

// POST /allocation/recommend
router.post("/allocation/recommend", async (req, res) => {
  const {
    jobId,
    date,
    productType,
    colour,
    estimatedMetres,
    jobType,
    suburb,
    builderProfileId,
    requiredSkills,
    stockItemId,
  } = req.body;
  if (!jobId || !date)
    return res.status(400).json({ error: "jobId and date required" });
  const tenantId = companyId(req);

  const [job] = await db
    .select()
    .from(jobsTable)
    .where(
      and(eq(jobsTable.id, Number(jobId)), eq(jobsTable.companyId, tenantId)),
    );
  if (!job)
    return res.status(400).json({ error: "Job not found for this company" });
  if (stockItemId) {
    const [stockItem] = await db
      .select()
      .from(stockItemsTable)
      .where(
        and(
          eq(stockItemsTable.id, Number(stockItemId)),
          eq(stockItemsTable.companyId, tenantId),
        ),
      );
    if (!stockItem)
      return res
        .status(400)
        .json({ error: "Stock item not found for this company" });
  }

  let builderTierMinQuality = 0;
  let builderProfile: typeof builderProfilesTable.$inferSelect | null = null;
  if (builderProfileId) {
    const [bp] = await db
      .select()
      .from(builderProfilesTable)
      .where(
        and(
          eq(builderProfilesTable.id, Number(builderProfileId)),
          eq(builderProfilesTable.companyId, tenantId),
        ),
      );
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
    const skillResult = checkSkills(
      sub.skills,
      jobType,
      productType,
      requiredSkills ?? [],
    );
    if (!skillResult.match) score -= 30;
    reasons.push(...skillResult.reasons);
    warnings.push(...skillResult.warnings);

    // Stock check
    const stockResult = checkStock(
      sub.inventory,
      stockItemId ? Number(stockItemId) : null,
      estimatedMetres ?? 0,
    );
    if (!stockResult.match) score -= 20;
    reasons.push(...stockResult.reasons);
    warnings.push(
      ...stockResult.shortfall.map((s) => `⚠ Stock shortfall: ${s}`),
    );

    // Proximity
    const prox = proximityScore(suburb, sub.assignedSuburbs);
    score = Math.round(score * 0.7 + prox.score * 0.3);
    if (prox.nearbySuburb) reasons.push(`✓ Nearby job in ${prox.nearbySuburb}`);

    // Builder tier match
    const quality = sub.skills ? Number(sub.skills.qualityScore) : 80;
    const tierMatch = quality >= builderTierMinQuality;
    if (!tierMatch) {
      warnings.push(
        `Quality score ${quality} below builder tier requirement (${builderTierMinQuality})`,
      );
      score -= 15;
    } else if (builderTierMinQuality > 70) {
      reasons.push(
        `✓ Quality score ${quality} meets ${builderProfile?.qualityTier} standard`,
      );
    }

    // Builder preferences
    const preferred =
      builderProfile &&
      (builderProfile.preferredWorkerIds as number[])?.includes(sub.id);
    const avoided =
      builderProfile &&
      (builderProfile.avoidedWorkerIds as number[])?.includes(sub.id);
    if (preferred) {
      score += 10;
      reasons.push("✓ Builder's preferred employee/subcontractor");
    }
    if (avoided) {
      score -= 25;
      warnings.push(
        "⚠ Builder has requested to avoid this employee/subcontractor",
      );
    }

    const callbackRate = sub.skills ? Number(sub.skills.callbackRate) : 0;
    if (callbackRate > 15)
      warnings.push(`High callback rate: ${callbackRate}%`);
    else if (callbackRate < 5)
      reasons.push(`✓ Low callback rate: ${callbackRate}%`);

    score = Math.max(0, Math.min(100, score));

    const rec =
      score >= 80
        ? "recommended"
        : score >= 60
          ? "suitable"
          : score >= 40
            ? "possible"
            : "not_recommended";

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
  if (sorted.every((r) => !r.scheduleFit))
    globalWarnings.push(
      "All employees/subcontractors already scheduled on this date",
    );
  if (sorted.every((r) => !r.stockMatch))
    globalWarnings.push(
      "No employee/subcontractor has sufficient stock — supplier order may be needed",
    );

  // Save recommendation
  const [saved] = await db
    .insert(allocationRecommendationsTable)
    .values({
      companyId: tenantId,
      jobId: Number(jobId),
      requestedDate: date,
      recommendations: sorted,
      warnings: globalWarnings,
    })
    .returning();

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
  if (!recommendationId || !subcontractorId)
    return res
      .status(400)
      .json({ error: "recommendationId and subcontractorId required" });
  const tenantId = companyId(req);
  const [sub] = await db
    .select()
    .from(subcontractorsTable)
    .where(
      and(
        eq(subcontractorsTable.id, Number(subcontractorId)),
        eq(subcontractorsTable.companyId, tenantId),
      ),
    );
  if (!sub)
    return res
      .status(400)
      .json({ error: "Employee/subcontractor not found for this company" });

  const [recommendation] = await db
    .select()
    .from(allocationRecommendationsTable)
    .where(
      and(
        eq(allocationRecommendationsTable.id, Number(recommendationId)),
        eq(allocationRecommendationsTable.companyId, tenantId),
      ),
    );
  if (!recommendation)
    return res.status(404).json({ error: "Recommendation not found" });

  const [job] = await db
    .select()
    .from(jobsTable)
    .where(
      and(
        eq(jobsTable.id, recommendation.jobId),
        eq(jobsTable.companyId, tenantId),
      ),
    );
  if (!job)
    return res
      .status(404)
      .json({ error: "Job not found for this recommendation" });

  const dispatchDate = recommendation.requestedDate;
  const [existingAssignment] = recommendation.jobAssignmentId
    ? await db
        .select()
        .from(jobAssignmentsTable)
        .where(
          and(
            eq(jobAssignmentsTable.id, recommendation.jobAssignmentId),
            eq(jobAssignmentsTable.companyId, tenantId),
          ),
        )
    : [];
  if (existingAssignment && existingAssignment.status !== "pending") {
    return res.status(409).json({
      error:
        "This assignment is already active or completed. Review it from Dispatch before changing it.",
    });
  }

  let scheduledOrder = existingAssignment?.scheduledOrder ?? 1;
  if (
    !existingAssignment ||
    existingAssignment.subcontractorId !== Number(subcontractorId) ||
    existingAssignment.dispatchDate !== dispatchDate
  ) {
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
    scheduledOrder =
      existingForSub.reduce(
        (max, assignment) => Math.max(max, assignment.scheduledOrder),
        0,
      ) + 1;
  }

  const blockColours = Array.isArray(requiredColours)
    ? requiredColours.filter(
        (colour): colour is string =>
          typeof colour === "string" && colour.trim().length > 0,
      )
    : Array.isArray(job.requiredColours)
      ? job.requiredColours
      : [];
  const assignmentValues = {
    companyId: tenantId,
    dispatchDate,
    scheduledOrder,
    jobId: job.id,
    subcontractorId: Number(subcontractorId),
    workArea:
      typeof workArea === "string" && workArea.trim() ? workArea.trim() : null,
    timeWindow:
      typeof timeWindow === "string" && timeWindow.trim()
        ? timeWindow.trim()
        : "full_day",
    plannedStartTime:
      typeof plannedStartTime === "string" && plannedStartTime.trim()
        ? plannedStartTime.trim()
        : null,
    plannedEndTime:
      typeof plannedEndTime === "string" && plannedEndTime.trim()
        ? plannedEndTime.trim()
        : null,
    estimatedMetres:
      estimatedMetres != null && Number.isFinite(Number(estimatedMetres))
        ? String(Number(estimatedMetres))
        : null,
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
      .where(
        and(
          eq(jobAssignmentsTable.id, existingAssignment.id),
          eq(jobAssignmentsTable.companyId, tenantId),
        ),
      )
      .returning();
  }
  if (!assignment) {
    [assignment] = await db
      .insert(jobAssignmentsTable)
      .values(assignmentValues)
      .returning();
  }
  if (!assignment)
    return res
      .status(500)
      .json({ error: "Could not create dispatch assignment" });

  const [saved] = await db
    .update(allocationRecommendationsTable)
    .set({
      jobAssignmentId: assignment.id,
      selectedSubcontractorId: Number(subcontractorId),
      selectionMethod: overrideReason ? "manual_override" : "auto",
      overrideReason,
    })
    .where(
      and(
        eq(allocationRecommendationsTable.id, Number(recommendationId)),
        eq(allocationRecommendationsTable.companyId, tenantId),
      ),
    )
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
    req.log.warn(
      { err, assignmentId: assignment.id },
      "Failed to send allocation confirmation notification",
    );
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
  const allJobs = await db
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.companyId, tenantId));
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
    const bestSub = subs.find(
      (s) =>
        !s.assignedDates.includes((job as any).scheduledDate ?? weekStart) &&
        s.assignedSuburbs.includes(suburb),
    );
    const fallback = subs.find(
      (s) => !s.assignedDates.includes((job as any).scheduledDate ?? weekStart),
    );
    const assigned = bestSub ?? fallback;

    if (assigned) {
      const schedEntry = schedule.find(
        (s) => s.subcontractorId === assigned.id,
      );
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

  if (unallocated.length > 0)
    notes.push(
      `${unallocated.length} jobs could not be auto-assigned — review needed`,
    );

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

  const [saved] = await db
    .insert(weeklyPlannerProposalsTable)
    .values(proposal)
    .returning();
  return res.json({ ...saved, proposedSchedule: schedule });
});

// GET /weekly-planner
router.get("/weekly-planner", async (req, res) => {
  const tenantId = companyId(req);
  const rows = await db
    .select()
    .from(weeklyPlannerProposalsTable)
    .where(eq(weeklyPlannerProposalsTable.companyId, tenantId));
  const weekStart = req.query.weekStart as string;
  const filtered = weekStart
    ? rows.filter((r) => r.weekStart === weekStart)
    : rows;
  return res.json(
    filtered.map((r) => ({
      ...r,
      proposedSchedule: r.proposedSchedule,
      optimisationSummary: r.optimisationSummary,
    })),
  );
});

// PATCH /weekly-planner/:id
router.patch("/weekly-planner/:id", async (req, res) => {
  const { status, adminNotes } = req.body;
  const tenantId = companyId(req);
  const [existing] = await db
    .select()
    .from(weeklyPlannerProposalsTable)
    .where(
      and(
        eq(weeklyPlannerProposalsTable.id, Number(req.params.id)),
        eq(weeklyPlannerProposalsTable.companyId, tenantId),
      ),
    );
  if (!existing) return res.status(404).json({ error: "Not found" });

  const updates: Record<string, unknown> = {};
  if (status) updates.status = status;
  if (adminNotes !== undefined) updates.adminNotes = adminNotes;
  if (status === "approved") updates.approvedAt = new Date();

  const [row] = await db
    .update(weeklyPlannerProposalsTable)
    .set(updates)
    .where(
      and(
        eq(weeklyPlannerProposalsTable.id, Number(req.params.id)),
        eq(weeklyPlannerProposalsTable.companyId, tenantId),
      ),
    )
    .returning();

  const createdAssignments: Array<typeof jobAssignmentsTable.$inferSelect> = [];
  if (status === "approved") {
    const proposedSchedule = Array.isArray(existing.proposedSchedule)
      ? (existing.proposedSchedule as Array<{
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
        }>)
      : [];

    for (const workerSchedule of proposedSchedule) {
      const subcontractorId = Number(workerSchedule.subcontractorId);
      if (!subcontractorId || !Array.isArray(workerSchedule.assignments))
        continue;

      for (const proposed of workerSchedule.assignments) {
        const jobId = Number(proposed.jobId);
        const dispatchDate = proposed.date || existing.weekStart;
        if (!jobId || !dispatchDate) continue;

        const [job] = await db
          .select()
          .from(jobsTable)
          .where(
            and(eq(jobsTable.id, jobId), eq(jobsTable.companyId, tenantId)),
          );
        if (!job) continue;

        const proposedWorkArea =
          typeof proposed.workArea === "string" && proposed.workArea.trim()
            ? proposed.workArea.trim()
            : null;
        const existingBlocks = await db
          .select({
            id: jobAssignmentsTable.id,
            workArea: jobAssignmentsTable.workArea,
          })
          .from(jobAssignmentsTable)
          .where(
            and(
              eq(jobAssignmentsTable.companyId, tenantId),
              eq(jobAssignmentsTable.jobId, jobId),
              eq(jobAssignmentsTable.dispatchDate, dispatchDate),
              eq(jobAssignmentsTable.subcontractorId, subcontractorId),
            ),
          );
        const alreadyScheduled = existingBlocks.some((block) =>
          proposedWorkArea
            ? block.workArea === proposedWorkArea
            : !block.workArea,
        );
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
        const scheduledOrder =
          existingForSub.reduce(
            (max, assignment) => Math.max(max, assignment.scheduledOrder),
            0,
          ) + 1;

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
            estimatedMetres:
              proposed.estimatedMetres != null &&
              Number.isFinite(Number(proposed.estimatedMetres))
                ? String(Number(proposed.estimatedMetres))
                : null,
            builderContactName: job.builderContactName ?? null,
            builderContactPhone: job.builderContactPhone ?? null,
            requiredColours: Array.isArray(proposed.requiredColours)
              ? proposed.requiredColours
              : Array.isArray(job.requiredColours)
                ? job.requiredColours
                : [],
            notes:
              proposed.routeNote ??
              "Created from approved weekly planner proposal.",
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
          req.log.warn(
            { err, assignmentId: assignment.id },
            "Failed to send weekly planner assignment notification",
          );
        }
      }
    }
  }

  return res.json({ ...row, createdAssignments });
});

export default router;

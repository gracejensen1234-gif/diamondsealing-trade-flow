import { Router } from "express";
import { db } from "@workspace/db";
import {
  subInventoryTable,
  inventoryTransactionsTable,
  restockRequestsTable,
  subcontractorsTable,
  stockItemsTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import {
  companyId,
  requireAdmin,
  requireSubcontractorAccess,
  workerSubcontractorId,
} from "../lib/auth.js";
import { getAuditModel, getOpenAIClient } from "../lib/openai-client.js";
import type OpenAI from "openai";

const router = Router();
type InventoryTransactionType =
  (typeof inventoryTransactionsTable.$inferSelect)["transactionType"];
type RestockRequestStatus =
  (typeof restockRequestsTable.$inferSelect)["status"];
const inventoryTransactionTypes: InventoryTransactionType[] = [
  "issued",
  "returned",
  "used_on_job",
  "adjustment",
  "restock",
];
const stockUnits = ["tube", "sausage", "box", "roll", "litre", "each"];

type StockIntakeSuggestion = {
  stockItemId: number | null;
  productName: string;
  colour: string | null;
  barcode: string | null;
  unit: string;
  quantity: number;
  confidence: number;
  evidence: string;
  needsReview: boolean;
};

function normalizeStockText(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeBarcode(value: unknown) {
  return String(value ?? "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .trim();
}

function clampConfidence(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0.5;
  const zeroToOne = numeric > 1 ? numeric / 100 : numeric;
  return Math.max(0, Math.min(1, zeroToOne));
}

function cleanStockUnit(value: unknown) {
  const normalized = normalizeStockText(value).replace(/\s/g, "");
  if (normalized === "tubes") return "tube";
  if (normalized === "sausages") return "sausage";
  if (normalized === "boxes") return "box";
  if (normalized === "rolls") return "roll";
  if (normalized === "litres" || normalized === "liters") return "litre";
  if (normalized === "each" || normalized === "ea") return "each";
  return stockUnits.includes(normalized) ? normalized : "tube";
}

function findMatchingStockItem(
  stockItems: (typeof stockItemsTable.$inferSelect)[],
  productName: string,
  colour: string | null,
  unit?: string,
  barcode?: string | null,
) {
  const barcodeText = normalizeBarcode(barcode);
  if (barcodeText) {
    const byBarcode = stockItems.find(
      (item) => normalizeBarcode(item.barcode) === barcodeText,
    );
    if (byBarcode) return byBarcode;
  }

  const nameText = normalizeStockText(productName);
  const colourText = normalizeStockText(colour);
  const unitText = normalizeStockText(unit);

  return (
    stockItems.find((item) => {
      const itemName = normalizeStockText(item.name);
      const itemColour = normalizeStockText(item.colour);
      const itemUnit = normalizeStockText(item.unit);
      const nameMatches =
        itemName === nameText ||
        itemName.includes(nameText) ||
        nameText.includes(itemName);
      const colourMatches =
        !colourText ||
        !itemColour ||
        itemColour === colourText ||
        itemColour.includes(colourText) ||
        colourText.includes(itemColour);
      const unitMatches = !unitText || itemUnit === unitText;
      return nameMatches && colourMatches && unitMatches;
    }) ?? null
  );
}

function sanitizeStockIntakeSuggestion(
  rawLine: unknown,
  stockItems: (typeof stockItemsTable.$inferSelect)[],
): StockIntakeSuggestion | null {
  if (typeof rawLine !== "object" || rawLine === null) return null;
  const raw = rawLine as Record<string, unknown>;
  const productName = String(raw.productName ?? raw.name ?? "").trim();
  const colour = String(raw.colour ?? raw.color ?? "").trim() || null;
  const barcode = normalizeBarcode(raw.barcode);
  const quantity = Number(raw.quantity);
  if (!productName || !Number.isFinite(quantity) || quantity <= 0) return null;

  const requestedStockItemId = Number(raw.stockItemId);
  const validatedStockItem = Number.isFinite(requestedStockItemId)
    ? stockItems.find((item) => item.id === requestedStockItemId)
    : null;
  const matchedStockItem =
    validatedStockItem ??
    findMatchingStockItem(
      stockItems,
      productName,
      colour,
      cleanStockUnit(raw.unit),
      barcode,
    );
  const unit = matchedStockItem?.unit ?? cleanStockUnit(raw.unit);
  const confidence = clampConfidence(raw.confidence);

  return {
    stockItemId: matchedStockItem?.id ?? null,
    productName: matchedStockItem?.name ?? productName,
    colour: matchedStockItem?.colour ?? colour,
    barcode: matchedStockItem?.barcode ?? (barcode || null),
    unit,
    quantity,
    confidence,
    evidence: String(raw.evidence ?? raw.notes ?? "").trim(),
    needsReview:
      Boolean(raw.needsReview) || !matchedStockItem || confidence < 0.7,
  };
}

function stockIntakeReferenceNote(sourceNote: unknown, evidence: unknown) {
  return ["AI stock intake", sourceNote, evidence]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join(" - ");
}

async function buildInventoryItem(row: typeof subInventoryTable.$inferSelect) {
  const tenantId = row.companyId ?? 0;
  const [sub] = await db
    .select({ name: subcontractorsTable.name })
    .from(subcontractorsTable)
    .where(
      and(
        eq(subcontractorsTable.id, row.subcontractorId),
        eq(subcontractorsTable.companyId, tenantId),
      ),
    );
  const [item] = await db
    .select()
    .from(stockItemsTable)
    .where(
      and(
        eq(stockItemsTable.id, row.stockItemId),
        eq(stockItemsTable.companyId, tenantId),
      ),
    );
  return {
    ...row,
    subcontractorName: sub?.name ?? "",
    stockItemName: item?.name ?? "",
    colour: item?.colour ?? null,
    unit: item?.unit ?? "tube",
    currentQuantity: Number(row.currentQuantity),
  };
}

async function buildTransaction(
  row: typeof inventoryTransactionsTable.$inferSelect,
) {
  const tenantId = row.companyId ?? 0;
  const [sub] = await db
    .select({ name: subcontractorsTable.name })
    .from(subcontractorsTable)
    .where(
      and(
        eq(subcontractorsTable.id, row.subcontractorId),
        eq(subcontractorsTable.companyId, tenantId),
      ),
    );
  const [item] = await db
    .select()
    .from(stockItemsTable)
    .where(
      and(
        eq(stockItemsTable.id, row.stockItemId),
        eq(stockItemsTable.companyId, tenantId),
      ),
    );
  return {
    ...row,
    subcontractorName: sub?.name ?? "",
    stockItemName: item?.name ?? "",
    colour: item?.colour ?? null,
    unit: item?.unit ?? "tube",
    quantity: Number(row.quantity),
  };
}

async function buildRestockRequest(
  row: typeof restockRequestsTable.$inferSelect,
) {
  const tenantId = row.companyId ?? 0;
  const [sub] = await db
    .select({ name: subcontractorsTable.name })
    .from(subcontractorsTable)
    .where(
      and(
        eq(subcontractorsTable.id, row.subcontractorId),
        eq(subcontractorsTable.companyId, tenantId),
      ),
    );
  const [item] = await db
    .select()
    .from(stockItemsTable)
    .where(
      and(
        eq(stockItemsTable.id, row.stockItemId),
        eq(stockItemsTable.companyId, tenantId),
      ),
    );
  return {
    ...row,
    subcontractorName: sub?.name ?? "",
    stockItemName: item?.name ?? "",
    colour: item?.colour ?? null,
    unit: item?.unit ?? "tube",
    quantityRequested: Number(row.quantityRequested),
    quantityFulfilled: row.quantityFulfilled
      ? Number(row.quantityFulfilled)
      : null,
  };
}

// GET /sub-inventory
router.get("/sub-inventory", async (req, res) => {
  const subcontractorId =
    workerSubcontractorId(req) ??
    (req.query.subcontractorId ? Number(req.query.subcontractorId) : undefined);
  const conditions = [eq(subInventoryTable.companyId, companyId(req))];
  if (subcontractorId)
    conditions.push(eq(subInventoryTable.subcontractorId, subcontractorId));
  const filtered = await db
    .select()
    .from(subInventoryTable)
    .where(and(...conditions))
    .orderBy(subInventoryTable.subcontractorId);
  return res.json(await Promise.all(filtered.map(buildInventoryItem)));
});

// GET /sub-inventory/:subcontractorId
router.get("/sub-inventory/:subcontractorId", async (req, res) => {
  const subcontractorId = Number(req.params.subcontractorId);
  if (!requireSubcontractorAccess(req, res, subcontractorId)) return;
  const rows = await db
    .select()
    .from(subInventoryTable)
    .where(
      and(
        eq(subInventoryTable.companyId, companyId(req)),
        eq(subInventoryTable.subcontractorId, subcontractorId),
      ),
    );
  return res.json(await Promise.all(rows.map(buildInventoryItem)));
});

// PATCH /sub-inventory/:subcontractorId/:stockItemId
router.patch(
  "/sub-inventory/:subcontractorId/:stockItemId",
  requireAdmin,
  async (req, res) => {
    const subcontractorId = Number(req.params.subcontractorId);
    const stockItemId = Number(req.params.stockItemId);
    const newQuantity = Number(req.body?.currentQuantity);
    const referenceNote =
      typeof req.body?.referenceNote === "string"
        ? req.body.referenceNote.trim()
        : "";
    const tenantId = companyId(req);

    if (!Number.isFinite(subcontractorId) || !Number.isFinite(stockItemId)) {
      return res
        .status(400)
        .json({ error: "Employee/subcontractor and product are required" });
    }
    if (!Number.isFinite(newQuantity) || newQuantity < 0) {
      return res
        .status(400)
        .json({ error: "Stock quantity must be zero or higher" });
    }

    const [sub] = await db
      .select()
      .from(subcontractorsTable)
      .where(
        and(
          eq(subcontractorsTable.id, subcontractorId),
          eq(subcontractorsTable.companyId, tenantId),
        ),
      );
    const [stockItem] = await db
      .select()
      .from(stockItemsTable)
      .where(
        and(
          eq(stockItemsTable.id, stockItemId),
          eq(stockItemsTable.companyId, tenantId),
        ),
      );
    if (!sub || !stockItem)
      return res.status(400).json({
        error:
          "Employee/subcontractor or stock item not found for this company",
      });

    const [existing] = await db
      .select()
      .from(subInventoryTable)
      .where(
        and(
          eq(subInventoryTable.companyId, tenantId),
          eq(subInventoryTable.subcontractorId, subcontractorId),
          eq(subInventoryTable.stockItemId, stockItemId),
        ),
      )
      .limit(1);

    const previousQuantity = Number(existing?.currentQuantity ?? 0);
    const adjustment = newQuantity - previousQuantity;

    const updated = await db.transaction(async (tx) => {
      let inventoryRow: typeof subInventoryTable.$inferSelect;
      if (existing) {
        [inventoryRow] = await tx
          .update(subInventoryTable)
          .set({
            currentQuantity: newQuantity.toString(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(subInventoryTable.id, existing.id),
              eq(subInventoryTable.companyId, tenantId),
            ),
          )
          .returning();
      } else {
        [inventoryRow] = await tx
          .insert(subInventoryTable)
          .values({
            companyId: tenantId,
            subcontractorId,
            stockItemId,
            currentQuantity: newQuantity.toString(),
          })
          .returning();
      }

      if (adjustment !== 0) {
        await tx.insert(inventoryTransactionsTable).values({
          companyId: tenantId,
          subcontractorId,
          stockItemId,
          transactionType: "adjustment",
          quantity: adjustment.toString(),
          referenceNote:
            referenceNote ||
            `Manual stock set from ${previousQuantity} to ${newQuantity}`,
          recordedBy: "admin",
        });
      }

      return inventoryRow;
    });

    return res.json(await buildInventoryItem(updated));
  },
);

// GET /inventory-transactions
router.get("/inventory-transactions", async (req, res) => {
  const conditions = [eq(inventoryTransactionsTable.companyId, companyId(req))];
  const subcontractorId =
    workerSubcontractorId(req) ??
    (req.query.subcontractorId ? Number(req.query.subcontractorId) : undefined);
  if (subcontractorId)
    conditions.push(
      eq(inventoryTransactionsTable.subcontractorId, subcontractorId),
    );
  if (req.query.stockItemId)
    conditions.push(
      eq(inventoryTransactionsTable.stockItemId, Number(req.query.stockItemId)),
    );
  if (req.query.transactionType)
    conditions.push(
      eq(
        inventoryTransactionsTable.transactionType,
        req.query.transactionType as InventoryTransactionType,
      ),
    );
  const filtered = await db
    .select()
    .from(inventoryTransactionsTable)
    .where(and(...conditions))
    .orderBy(desc(inventoryTransactionsTable.createdAt));
  return res.json(await Promise.all(filtered.map(buildTransaction)));
});

// POST /inventory-transactions
router.post("/inventory-transactions", requireAdmin, async (req, res) => {
  const {
    subcontractorId,
    stockItemId,
    transactionType,
    quantity,
    jobAssignmentId,
    referenceNote,
    recordedBy,
  } = req.body;
  if (
    !subcontractorId ||
    !stockItemId ||
    !transactionType ||
    quantity === undefined
  ) {
    return res.status(400).json({
      error: "subcontractorId, stockItemId, transactionType, quantity required",
    });
  }
  const transactionTypeValue = String(
    transactionType,
  ) as InventoryTransactionType;
  if (!inventoryTransactionTypes.includes(transactionTypeValue)) {
    return res
      .status(400)
      .json({ error: "Invalid inventory transaction type" });
  }
  const numericQuantity = Number(quantity);
  if (!Number.isFinite(numericQuantity) || numericQuantity <= 0) {
    return res
      .status(400)
      .json({ error: "Quantity must be greater than zero" });
  }
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
  const [stockItem] = await db
    .select()
    .from(stockItemsTable)
    .where(
      and(
        eq(stockItemsTable.id, Number(stockItemId)),
        eq(stockItemsTable.companyId, tenantId),
      ),
    );
  if (!sub || !stockItem)
    return res.status(400).json({
      error: "Employee/subcontractor or stock item not found for this company",
    });
  if (jobAssignmentId) {
    const { jobAssignmentsTable } = await import("@workspace/db");
    const [assignment] = await db
      .select()
      .from(jobAssignmentsTable)
      .where(
        and(
          eq(jobAssignmentsTable.id, Number(jobAssignmentId)),
          eq(jobAssignmentsTable.companyId, tenantId),
        ),
      );
    if (!assignment)
      return res
        .status(400)
        .json({ error: "Job assignment not found for this company" });
  }

  const existing = await db
    .select()
    .from(subInventoryTable)
    .where(
      and(
        eq(subInventoryTable.companyId, tenantId),
        eq(subInventoryTable.subcontractorId, Number(subcontractorId)),
        eq(subInventoryTable.stockItemId, Number(stockItemId)),
      ),
    )
    .limit(1);

  const direction = ["issued", "restock"].includes(transactionTypeValue)
    ? 1
    : -1;
  const quantityChange = numericQuantity * direction;
  if (!existing.length && quantityChange < 0) {
    return res.status(400).json({
      error: `${stockItem.name} has not been issued to this employee/subcontractor yet`,
    });
  }
  const nextQuantity =
    Number(existing[0]?.currentQuantity ?? 0) + quantityChange;
  if (nextQuantity < 0) {
    return res.status(400).json({
      error: `${stockItem.name}: transaction would reduce held stock below zero`,
    });
  }

  const txn = await db.transaction(async (tx) => {
    const [recorded] = await tx
      .insert(inventoryTransactionsTable)
      .values({
        companyId: tenantId,
        subcontractorId: Number(subcontractorId),
        stockItemId: Number(stockItemId),
        transactionType: transactionTypeValue,
        quantity: numericQuantity.toString(),
        jobAssignmentId: jobAssignmentId ? Number(jobAssignmentId) : null,
        referenceNote,
        recordedBy,
      })
      .returning();

    if (existing.length) {
      await tx
        .update(subInventoryTable)
        .set({
          currentQuantity: nextQuantity.toString(),
          lastIssuedAt:
            transactionTypeValue === "issued"
              ? new Date()
              : existing[0].lastIssuedAt,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(subInventoryTable.id, existing[0].id),
            eq(subInventoryTable.companyId, tenantId),
          ),
        );
    } else {
      await tx.insert(subInventoryTable).values({
        companyId: tenantId,
        subcontractorId: Number(subcontractorId),
        stockItemId: Number(stockItemId),
        currentQuantity: nextQuantity.toString(),
        lastIssuedAt: transactionTypeValue === "issued" ? new Date() : null,
      });
    }

    return recorded;
  });

  return res.status(201).json(await buildTransaction(txn));
});

// POST /inventory-stock-intake/analyse
router.post(
  "/inventory-stock-intake/analyse",
  requireAdmin,
  async (req, res) => {
    const imageDataList = [
      ...(Array.isArray(req.body?.imageDataList)
        ? req.body.imageDataList
        : []),
      req.body?.imageData,
    ]
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 8);
    const notes =
      typeof req.body?.notes === "string" ? req.body.notes.trim() : "";
    if (
      imageDataList.length === 0 ||
      imageDataList.some((imageData) => !imageData.startsWith("data:image/"))
    ) {
      return res
        .status(400)
        .json({ error: "Upload at least one stock or receipt photo image" });
    }

    const openai = getOpenAIClient();
    if (!openai) {
      return res.status(503).json({
        error:
          "OpenAI is not configured. Add OPENAI_API_KEY before using AI stock intake.",
      });
    }

    const tenantId = companyId(req);
    const stockItems = await db
      .select()
      .from(stockItemsTable)
      .where(eq(stockItemsTable.companyId, tenantId))
      .orderBy(stockItemsTable.name);

    const knownProducts = stockItems
      .map(
        (item) =>
          `ID ${item.id}: ${item.name}${item.colour ? `, ${item.colour}` : ""}, unit ${item.unit}${item.barcode ? `, barcode ${item.barcode}` : ""}`,
      )
      .join("\n");

    const systemPrompt = `You are an inventory intake assistant for a joint sealing company.
Read the uploaded stock photo, box label photo, or supplier receipt photo.
Return only stock lines that are visible or strongly supported by the image.
Match lines to known stock item IDs when possible.

Rules:
- Return JSON only with key "items".
- Read all uploaded images together as one stock count.
- Each item must contain: stockItemId (number or null), productName, colour, barcode (string or null), unit, quantity, confidence, evidence, needsReview.
- Use unit values only: tube, sausage, box, roll, litre, each.
- If a box quantity is visible, convert to the actual unit quantity. Example: 4 boxes x 12 tubes = quantity 48, unit tube.
- If a barcode is visible on a product, include it exactly.
- If quantity is unclear, use the visible package count and set needsReview true.
- Do not invent products or quantities.`;

    const userContent: OpenAI.ChatCompletionContentPart[] = [
      {
        type: "text",
        text: [
          "Known stock items:",
          knownProducts || "No stock items are set up yet.",
          notes ? `Admin notes: ${notes}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
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
        max_tokens: 1500,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
      });

      const raw = response.choices[0]?.message?.content ?? "{}";
      const parsed = JSON.parse(raw) as { items?: unknown[] };
      const suggestions = (Array.isArray(parsed.items) ? parsed.items : [])
        .map((item) => sanitizeStockIntakeSuggestion(item, stockItems))
        .filter((item): item is StockIntakeSuggestion => Boolean(item));

      return res.json({ suggestions });
    } catch (error) {
      req.log.error({ err: error }, "AI stock intake failed");
      return res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Could not analyse stock photo",
      });
    }
  },
);

// POST /inventory-stock-intake/apply
router.post("/inventory-stock-intake/apply", requireAdmin, async (req, res) => {
  const subcontractorId = Number(req.body?.subcontractorId);
  const tenantId = companyId(req);
  const sourceNote =
    typeof req.body?.sourceNote === "string" ? req.body.sourceNote.trim() : "";
  const lines: unknown[] = Array.isArray(req.body?.lines) ? req.body.lines : [];

  if (!Number.isFinite(subcontractorId)) {
    return res
      .status(400)
      .json({ error: "Employee/subcontractor is required" });
  }
  if (lines.length === 0) {
    return res
      .status(400)
      .json({ error: "At least one stock line is required" });
  }

  const [sub] = await db
    .select()
    .from(subcontractorsTable)
    .where(
      and(
        eq(subcontractorsTable.id, subcontractorId),
        eq(subcontractorsTable.companyId, tenantId),
      ),
    );
  if (!sub) {
    return res.status(400).json({
      error: "Employee/subcontractor not found for this company",
    });
  }

  let stockItems = await db
    .select()
    .from(stockItemsTable)
    .where(eq(stockItemsTable.companyId, tenantId));
  const sanitizedLines = lines
    .map((line: unknown) => sanitizeStockIntakeSuggestion(line, stockItems))
    .filter((line): line is StockIntakeSuggestion => Boolean(line));

  if (sanitizedLines.length === 0) {
    return res.status(400).json({ error: "No valid stock lines to apply" });
  }

  const applied = await db.transaction(async (tx) => {
    const appliedLines: Array<{
      stockItemId: number;
      productName: string;
      colour: string | null;
      barcode: string | null;
      unit: string;
      quantity: number;
    }> = [];

    for (const line of sanitizedLines) {
      let stockItem =
        (line.stockItemId
          ? stockItems.find((item) => item.id === line.stockItemId)
          : null) ??
        findMatchingStockItem(
          stockItems,
          line.productName,
          line.colour,
          line.unit,
          line.barcode,
        );

      if (!stockItem) {
        [stockItem] = await tx
          .insert(stockItemsTable)
          .values({
            companyId: tenantId,
            name: line.productName,
            unit: line.unit,
            colour: line.colour,
            barcode: line.barcode,
            currentStock: "0",
          })
          .returning();
        stockItems = [...stockItems, stockItem];
      } else if (line.barcode && !stockItem.barcode) {
        const [updatedStockItem] = await tx
          .update(stockItemsTable)
          .set({ barcode: line.barcode })
          .where(
            and(
              eq(stockItemsTable.id, stockItem.id),
              eq(stockItemsTable.companyId, tenantId),
            ),
          )
          .returning();
        if (updatedStockItem) {
          stockItem = updatedStockItem;
          stockItems = stockItems.map((item) =>
            item.id === updatedStockItem.id ? updatedStockItem : item,
          );
        }
      }

      const [existing] = await tx
        .select()
        .from(subInventoryTable)
        .where(
          and(
            eq(subInventoryTable.companyId, tenantId),
            eq(subInventoryTable.subcontractorId, subcontractorId),
            eq(subInventoryTable.stockItemId, stockItem.id),
          ),
        )
        .limit(1);
      const nextQuantity =
        Number(existing?.currentQuantity ?? 0) + Number(line.quantity);

      await tx.insert(inventoryTransactionsTable).values({
        companyId: tenantId,
        subcontractorId,
        stockItemId: stockItem.id,
        transactionType: "issued",
        quantity: Number(line.quantity).toString(),
        referenceNote: stockIntakeReferenceNote(sourceNote, line.evidence),
        recordedBy: "admin-ai-stock-intake",
      });

      if (existing) {
        await tx
          .update(subInventoryTable)
          .set({
            currentQuantity: nextQuantity.toString(),
            lastIssuedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(subInventoryTable.id, existing.id),
              eq(subInventoryTable.companyId, tenantId),
            ),
          );
      } else {
        await tx.insert(subInventoryTable).values({
          companyId: tenantId,
          subcontractorId,
          stockItemId: stockItem.id,
          currentQuantity: nextQuantity.toString(),
          lastIssuedAt: new Date(),
        });
      }

      appliedLines.push({
        stockItemId: stockItem.id,
        productName: stockItem.name,
        colour: stockItem.colour,
        barcode: stockItem.barcode,
        unit: stockItem.unit,
        quantity: line.quantity,
      });
    }

    return appliedLines;
  });

  return res.status(201).json({ applied });
});

// GET /restock-requests
router.get("/restock-requests", async (req, res) => {
  const conditions = [eq(restockRequestsTable.companyId, companyId(req))];
  const subcontractorId =
    workerSubcontractorId(req) ??
    (req.query.subcontractorId ? Number(req.query.subcontractorId) : undefined);
  if (subcontractorId)
    conditions.push(eq(restockRequestsTable.subcontractorId, subcontractorId));
  if (req.query.status)
    conditions.push(
      eq(restockRequestsTable.status, req.query.status as RestockRequestStatus),
    );
  const filtered = await db
    .select()
    .from(restockRequestsTable)
    .where(and(...conditions))
    .orderBy(desc(restockRequestsTable.createdAt));
  return res.json(await Promise.all(filtered.map(buildRestockRequest)));
});

// POST /restock-requests
router.post("/restock-requests", async (req, res) => {
  const { subcontractorId, stockItemId, quantityRequested, subNotes, urgency } =
    req.body;
  if (!subcontractorId || !stockItemId || !quantityRequested) {
    return res.status(400).json({
      error: "subcontractorId, stockItemId, quantityRequested required",
    });
  }
  if (!requireSubcontractorAccess(req, res, Number(subcontractorId))) return;
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
  const [stockItem] = await db
    .select()
    .from(stockItemsTable)
    .where(
      and(
        eq(stockItemsTable.id, Number(stockItemId)),
        eq(stockItemsTable.companyId, tenantId),
      ),
    );
  if (!sub || !stockItem)
    return res.status(400).json({
      error: "Employee/subcontractor or stock item not found for this company",
    });
  const [req_] = await db
    .insert(restockRequestsTable)
    .values({
      companyId: tenantId,
      subcontractorId: Number(subcontractorId),
      stockItemId: Number(stockItemId),
      quantityRequested: quantityRequested.toString(),
      subNotes,
      urgency: urgency ?? "normal",
      status: "pending",
    })
    .returning();
  return res.status(201).json(await buildRestockRequest(req_));
});

// PATCH /restock-requests/:id
router.patch("/restock-requests/:id", requireAdmin, async (req, res) => {
  const { status, quantityFulfilled, adminNotes } = req.body;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (status) updates.status = status;
  if (quantityFulfilled !== undefined)
    updates.quantityFulfilled = quantityFulfilled.toString();
  if (adminNotes !== undefined) updates.adminNotes = adminNotes;

  const [row] = await db
    .update(restockRequestsTable)
    .set(updates)
    .where(
      and(
        eq(restockRequestsTable.id, Number(req.params.id)),
        eq(restockRequestsTable.companyId, companyId(req)),
      ),
    )
    .returning();
  if (!row) return res.status(404).json({ error: "Not found" });

  // If fulfilled, create a restock transaction
  if (status === "fulfilled" && quantityFulfilled) {
    await db.insert(inventoryTransactionsTable).values({
      companyId: companyId(req),
      subcontractorId: row.subcontractorId,
      stockItemId: row.stockItemId,
      transactionType: "restock",
      quantity: quantityFulfilled.toString(),
      referenceNote: `Restock request #${row.id} fulfilled`,
      recordedBy: "admin",
    });
  }

  return res.json(await buildRestockRequest(row));
});

export default router;

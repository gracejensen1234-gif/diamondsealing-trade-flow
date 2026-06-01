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
import { companyId } from "../lib/auth.js";

const router = Router();
type InventoryTransactionType = typeof inventoryTransactionsTable.$inferSelect["transactionType"];
type RestockRequestStatus = typeof restockRequestsTable.$inferSelect["status"];

async function buildInventoryItem(row: typeof subInventoryTable.$inferSelect) {
  const tenantId = row.companyId ?? 0;
  const [sub] = await db
    .select({ name: subcontractorsTable.name })
    .from(subcontractorsTable)
    .where(and(eq(subcontractorsTable.id, row.subcontractorId), eq(subcontractorsTable.companyId, tenantId)));
  const [item] = await db
    .select()
    .from(stockItemsTable)
    .where(and(eq(stockItemsTable.id, row.stockItemId), eq(stockItemsTable.companyId, tenantId)));
  return {
    ...row,
    subcontractorName: sub?.name ?? "",
    stockItemName: item?.name ?? "",
    colour: item?.colour ?? null,
    unit: item?.unit ?? "tube",
    currentQuantity: Number(row.currentQuantity),
  };
}

async function buildTransaction(row: typeof inventoryTransactionsTable.$inferSelect) {
  const tenantId = row.companyId ?? 0;
  const [sub] = await db
    .select({ name: subcontractorsTable.name })
    .from(subcontractorsTable)
    .where(and(eq(subcontractorsTable.id, row.subcontractorId), eq(subcontractorsTable.companyId, tenantId)));
  const [item] = await db
    .select()
    .from(stockItemsTable)
    .where(and(eq(stockItemsTable.id, row.stockItemId), eq(stockItemsTable.companyId, tenantId)));
  return {
    ...row,
    subcontractorName: sub?.name ?? "",
    stockItemName: item?.name ?? "",
    colour: item?.colour ?? null,
    unit: item?.unit ?? "tube",
    quantity: Number(row.quantity),
  };
}

async function buildRestockRequest(row: typeof restockRequestsTable.$inferSelect) {
  const tenantId = row.companyId ?? 0;
  const [sub] = await db
    .select({ name: subcontractorsTable.name })
    .from(subcontractorsTable)
    .where(and(eq(subcontractorsTable.id, row.subcontractorId), eq(subcontractorsTable.companyId, tenantId)));
  const [item] = await db
    .select()
    .from(stockItemsTable)
    .where(and(eq(stockItemsTable.id, row.stockItemId), eq(stockItemsTable.companyId, tenantId)));
  return {
    ...row,
    subcontractorName: sub?.name ?? "",
    stockItemName: item?.name ?? "",
    colour: item?.colour ?? null,
    unit: item?.unit ?? "tube",
    quantityRequested: Number(row.quantityRequested),
    quantityFulfilled: row.quantityFulfilled ? Number(row.quantityFulfilled) : null,
  };
}

// GET /sub-inventory
router.get("/sub-inventory", async (req, res) => {
  const subcontractorId = req.query.subcontractorId ? Number(req.query.subcontractorId) : undefined;
  const conditions = [eq(subInventoryTable.companyId, companyId(req))];
  if (subcontractorId) conditions.push(eq(subInventoryTable.subcontractorId, subcontractorId));
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
  const rows = await db
    .select()
    .from(subInventoryTable)
    .where(and(eq(subInventoryTable.companyId, companyId(req)), eq(subInventoryTable.subcontractorId, subcontractorId)));
  return res.json(await Promise.all(rows.map(buildInventoryItem)));
});

// GET /inventory-transactions
router.get("/inventory-transactions", async (req, res) => {
  const conditions = [eq(inventoryTransactionsTable.companyId, companyId(req))];
  if (req.query.subcontractorId) conditions.push(eq(inventoryTransactionsTable.subcontractorId, Number(req.query.subcontractorId)));
  if (req.query.stockItemId) conditions.push(eq(inventoryTransactionsTable.stockItemId, Number(req.query.stockItemId)));
  if (req.query.transactionType) conditions.push(eq(inventoryTransactionsTable.transactionType, req.query.transactionType as InventoryTransactionType));
  const filtered = await db
    .select()
    .from(inventoryTransactionsTable)
    .where(and(...conditions))
    .orderBy(desc(inventoryTransactionsTable.createdAt));
  return res.json(await Promise.all(filtered.map(buildTransaction)));
});

// POST /inventory-transactions
router.post("/inventory-transactions", async (req, res) => {
  const { subcontractorId, stockItemId, transactionType, quantity, jobAssignmentId, referenceNote, recordedBy } = req.body;
  if (!subcontractorId || !stockItemId || !transactionType || quantity === undefined) {
    return res.status(400).json({ error: "subcontractorId, stockItemId, transactionType, quantity required" });
  }
  const tenantId = companyId(req);
  const [sub] = await db
    .select()
    .from(subcontractorsTable)
    .where(and(eq(subcontractorsTable.id, Number(subcontractorId)), eq(subcontractorsTable.companyId, tenantId)));
  const [stockItem] = await db
    .select()
    .from(stockItemsTable)
    .where(and(eq(stockItemsTable.id, Number(stockItemId)), eq(stockItemsTable.companyId, tenantId)));
  if (!sub || !stockItem) return res.status(400).json({ error: "Worker or stock item not found for this company" });
  if (jobAssignmentId) {
    const { jobAssignmentsTable } = await import("@workspace/db");
    const [assignment] = await db
      .select()
      .from(jobAssignmentsTable)
      .where(and(eq(jobAssignmentsTable.id, Number(jobAssignmentId)), eq(jobAssignmentsTable.companyId, tenantId)));
    if (!assignment) return res.status(400).json({ error: "Job assignment not found for this company" });
  }

  const [txn] = await db.insert(inventoryTransactionsTable).values({
    companyId: tenantId,
    subcontractorId: Number(subcontractorId),
    stockItemId: Number(stockItemId),
    transactionType,
    quantity: quantity.toString(),
    jobAssignmentId: jobAssignmentId ? Number(jobAssignmentId) : null,
    referenceNote,
    recordedBy,
  }).returning();

  // Update sub_inventory running total
  const direction = ["issued", "restock"].includes(transactionType) ? 1 : -1;
  const qty = Number(quantity) * direction;

  const existing = await db
    .select()
    .from(subInventoryTable)
    .where(and(
      eq(subInventoryTable.companyId, tenantId),
      eq(subInventoryTable.subcontractorId, Number(subcontractorId)),
      eq(subInventoryTable.stockItemId, Number(stockItemId)),
    ))
    .limit(1);

  if (existing.length) {
    await db
      .update(subInventoryTable)
      .set({
        currentQuantity: (Number(existing[0].currentQuantity) + qty).toString(),
        lastIssuedAt: transactionType === "issued" ? new Date() : existing[0].lastIssuedAt,
        updatedAt: new Date(),
      })
      .where(and(eq(subInventoryTable.id, existing[0].id), eq(subInventoryTable.companyId, tenantId)));
  } else {
    await db.insert(subInventoryTable).values({
      companyId: tenantId,
      subcontractorId: Number(subcontractorId),
      stockItemId: Number(stockItemId),
      currentQuantity: Math.max(0, qty).toString(),
      lastIssuedAt: transactionType === "issued" ? new Date() : null,
    });
  }

  return res.status(201).json(await buildTransaction(txn));
});

// GET /restock-requests
router.get("/restock-requests", async (req, res) => {
  const conditions = [eq(restockRequestsTable.companyId, companyId(req))];
  if (req.query.subcontractorId) conditions.push(eq(restockRequestsTable.subcontractorId, Number(req.query.subcontractorId)));
  if (req.query.status) conditions.push(eq(restockRequestsTable.status, req.query.status as RestockRequestStatus));
  const filtered = await db
    .select()
    .from(restockRequestsTable)
    .where(and(...conditions))
    .orderBy(desc(restockRequestsTable.createdAt));
  return res.json(await Promise.all(filtered.map(buildRestockRequest)));
});

// POST /restock-requests
router.post("/restock-requests", async (req, res) => {
  const { subcontractorId, stockItemId, quantityRequested, subNotes, urgency } = req.body;
  if (!subcontractorId || !stockItemId || !quantityRequested) {
    return res.status(400).json({ error: "subcontractorId, stockItemId, quantityRequested required" });
  }
  const tenantId = companyId(req);
  const [sub] = await db
    .select()
    .from(subcontractorsTable)
    .where(and(eq(subcontractorsTable.id, Number(subcontractorId)), eq(subcontractorsTable.companyId, tenantId)));
  const [stockItem] = await db
    .select()
    .from(stockItemsTable)
    .where(and(eq(stockItemsTable.id, Number(stockItemId)), eq(stockItemsTable.companyId, tenantId)));
  if (!sub || !stockItem) return res.status(400).json({ error: "Worker or stock item not found for this company" });
  const [req_] = await db.insert(restockRequestsTable).values({
    companyId: tenantId,
    subcontractorId: Number(subcontractorId),
    stockItemId: Number(stockItemId),
    quantityRequested: quantityRequested.toString(),
    subNotes,
    urgency: urgency ?? "normal",
    status: "pending",
  }).returning();
  return res.status(201).json(await buildRestockRequest(req_));
});

// PATCH /restock-requests/:id
router.patch("/restock-requests/:id", async (req, res) => {
  const { status, quantityFulfilled, adminNotes } = req.body;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (status) updates.status = status;
  if (quantityFulfilled !== undefined) updates.quantityFulfilled = quantityFulfilled.toString();
  if (adminNotes !== undefined) updates.adminNotes = adminNotes;

  const [row] = await db
    .update(restockRequestsTable)
    .set(updates)
    .where(and(eq(restockRequestsTable.id, Number(req.params.id)), eq(restockRequestsTable.companyId, companyId(req))))
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

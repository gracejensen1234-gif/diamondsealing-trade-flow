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

const router = Router();

async function buildInventoryItem(row: typeof subInventoryTable.$inferSelect) {
  const [sub] = await db.select({ name: subcontractorsTable.name }).from(subcontractorsTable).where(eq(subcontractorsTable.id, row.subcontractorId));
  const [item] = await db.select().from(stockItemsTable).where(eq(stockItemsTable.id, row.stockItemId));
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
  const [sub] = await db.select({ name: subcontractorsTable.name }).from(subcontractorsTable).where(eq(subcontractorsTable.id, row.subcontractorId));
  const [item] = await db.select().from(stockItemsTable).where(eq(stockItemsTable.id, row.stockItemId));
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
  const [sub] = await db.select({ name: subcontractorsTable.name }).from(subcontractorsTable).where(eq(subcontractorsTable.id, row.subcontractorId));
  const [item] = await db.select().from(stockItemsTable).where(eq(stockItemsTable.id, row.stockItemId));
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
  const rows = await db.select().from(subInventoryTable).orderBy(subInventoryTable.subcontractorId);
  const filtered = subcontractorId ? rows.filter((r) => r.subcontractorId === subcontractorId) : rows;
  return res.json(await Promise.all(filtered.map(buildInventoryItem)));
});

// GET /sub-inventory/:subcontractorId
router.get("/sub-inventory/:subcontractorId", async (req, res) => {
  const subcontractorId = Number(req.params.subcontractorId);
  const rows = await db.select().from(subInventoryTable).where(eq(subInventoryTable.subcontractorId, subcontractorId));
  return res.json(await Promise.all(rows.map(buildInventoryItem)));
});

// GET /inventory-transactions
router.get("/inventory-transactions", async (req, res) => {
  const rows = await db.select().from(inventoryTransactionsTable).orderBy(desc(inventoryTransactionsTable.createdAt));
  let filtered = rows;
  if (req.query.subcontractorId) filtered = filtered.filter((r) => r.subcontractorId === Number(req.query.subcontractorId));
  if (req.query.stockItemId) filtered = filtered.filter((r) => r.stockItemId === Number(req.query.stockItemId));
  if (req.query.transactionType) filtered = filtered.filter((r) => r.transactionType === req.query.transactionType);
  return res.json(await Promise.all(filtered.map(buildTransaction)));
});

// POST /inventory-transactions
router.post("/inventory-transactions", async (req, res) => {
  const { subcontractorId, stockItemId, transactionType, quantity, jobAssignmentId, referenceNote, recordedBy } = req.body;
  if (!subcontractorId || !stockItemId || !transactionType || quantity === undefined) {
    return res.status(400).json({ error: "subcontractorId, stockItemId, transactionType, quantity required" });
  }

  const [txn] = await db.insert(inventoryTransactionsTable).values({
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
    .where(and(eq(subInventoryTable.subcontractorId, Number(subcontractorId)), eq(subInventoryTable.stockItemId, Number(stockItemId))))
    .limit(1);

  if (existing.length) {
    await db
      .update(subInventoryTable)
      .set({
        currentQuantity: (Number(existing[0].currentQuantity) + qty).toString(),
        lastIssuedAt: transactionType === "issued" ? new Date() : existing[0].lastIssuedAt,
        updatedAt: new Date(),
      })
      .where(eq(subInventoryTable.id, existing[0].id));
  } else {
    await db.insert(subInventoryTable).values({
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
  const rows = await db.select().from(restockRequestsTable).orderBy(desc(restockRequestsTable.createdAt));
  let filtered = rows;
  if (req.query.subcontractorId) filtered = filtered.filter((r) => r.subcontractorId === Number(req.query.subcontractorId));
  if (req.query.status) filtered = filtered.filter((r) => r.status === req.query.status);
  return res.json(await Promise.all(filtered.map(buildRestockRequest)));
});

// POST /restock-requests
router.post("/restock-requests", async (req, res) => {
  const { subcontractorId, stockItemId, quantityRequested, subNotes, urgency } = req.body;
  if (!subcontractorId || !stockItemId || !quantityRequested) {
    return res.status(400).json({ error: "subcontractorId, stockItemId, quantityRequested required" });
  }
  const [req_] = await db.insert(restockRequestsTable).values({
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

  const [row] = await db.update(restockRequestsTable).set(updates).where(eq(restockRequestsTable.id, Number(req.params.id))).returning();
  if (!row) return res.status(404).json({ error: "Not found" });

  // If fulfilled, create a restock transaction
  if (status === "fulfilled" && quantityFulfilled) {
    const existing = await db.select().from(restockRequestsTable).where(eq(restockRequestsTable.id, row.id)).limit(1);
    await db.insert(inventoryTransactionsTable).values({
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

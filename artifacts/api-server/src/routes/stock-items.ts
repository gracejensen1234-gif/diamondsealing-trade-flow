import { Router } from "express";
import { db } from "@workspace/db";
import { stockItemsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import {
  CreateStockItemBody,
  UpdateStockItemParams,
  UpdateStockItemBody,
  DeleteStockItemParams,
} from "@workspace/api-zod";
import { companyId, requireAdmin } from "../lib/auth.js";

const router = Router();

function serialize(item: typeof stockItemsTable.$inferSelect) {
  return {
    ...item,
    barcode: item.barcode ?? null,
    currentStock: item.currentStock ? Number(item.currentStock) : null,
  };
}

router.get("/stock-items", async (req, res) => {
  const items = await db
    .select()
    .from(stockItemsTable)
    .where(eq(stockItemsTable.companyId, companyId(req)))
    .orderBy(stockItemsTable.name);
  return res.json(items.map(serialize));
});

router.post("/stock-items", requireAdmin, async (req, res) => {
  const parsed = CreateStockItemBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid body" });
  const [item] = await db.insert(stockItemsTable).values({
    companyId: companyId(req),
    name: parsed.data.name,
    unit: parsed.data.unit,
    colour: parsed.data.colour ?? null,
    barcode: parsed.data.barcode?.trim() || null,
    currentStock: parsed.data.currentStock != null ? String(parsed.data.currentStock) : null,
  }).returning();
  return res.status(201).json(serialize(item));
});

router.patch("/stock-items/:id", requireAdmin, async (req, res) => {
  const params = UpdateStockItemParams.safeParse({ id: Number(req.params.id) });
  const body = UpdateStockItemBody.safeParse(req.body);
  if (!params.success || !body.success) return res.status(400).json({ error: "Invalid request" });
  const updates: Record<string, unknown> = {};
  if (body.data.name !== undefined) updates.name = body.data.name;
  if (body.data.unit !== undefined) updates.unit = body.data.unit;
  if (body.data.colour !== undefined) updates.colour = body.data.colour;
  if (body.data.barcode !== undefined) updates.barcode = body.data.barcode?.trim() || null;
  if (body.data.currentStock !== undefined) updates.currentStock = String(body.data.currentStock);
  const [item] = await db
    .update(stockItemsTable)
    .set(updates)
    .where(and(eq(stockItemsTable.id, params.data.id), eq(stockItemsTable.companyId, companyId(req))))
    .returning();
  if (!item) return res.status(404).json({ error: "Not found" });
  return res.json(serialize(item));
});

router.delete("/stock-items/:id", requireAdmin, async (req, res) => {
  const parsed = DeleteStockItemParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });
  await db
    .delete(stockItemsTable)
    .where(and(eq(stockItemsTable.id, parsed.data.id), eq(stockItemsTable.companyId, companyId(req))));
  return res.status(204).send();
});

export default router;

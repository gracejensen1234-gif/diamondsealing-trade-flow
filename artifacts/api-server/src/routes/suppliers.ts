import { Router } from "express";
import { db } from "@workspace/db";
import {
  supplierProfilesTable,
  supplierOrdersTable,
  supplierOrderItemsTable,
  subcontractorsTable,
  subInventoryTable,
  stockItemsTable,
  stockItemSupplierPrefsTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { companyId } from "../lib/auth.js";

const router = Router();
type SupplierOrderStatus = (typeof supplierOrdersTable.$inferSelect)["status"];

// ── Supplier Profiles ──────────────────────────────────────────────────────

router.get("/supplier-profiles", async (req, res) => {
  const rows = await db
    .select()
    .from(supplierProfilesTable)
    .where(
      and(
        eq(supplierProfilesTable.companyId, companyId(req)),
        eq(supplierProfilesTable.active, true),
      ),
    );
  return res.json(
    rows.map((r) => ({
      ...r,
      preferredProducts: r.preferredProducts ?? [],
      preferredColours: r.preferredColours ?? [],
    })),
  );
});

router.post("/supplier-profiles", async (req, res) => {
  const {
    name,
    contactName,
    contactPhone,
    contactEmail,
    address,
    suburb,
    preferredProducts,
    preferredColours,
    notes,
  } = req.body;
  if (!name) return res.status(400).json({ error: "name required" });
  const [row] = await db
    .insert(supplierProfilesTable)
    .values({
      companyId: companyId(req),
      name,
      contactName,
      contactPhone,
      contactEmail,
      address,
      suburb,
      preferredProducts: preferredProducts ?? [],
      preferredColours: preferredColours ?? [],
      notes,
    })
    .returning();
  return res.status(201).json(row);
});

router.patch("/supplier-profiles/:id", async (req, res) => {
  const fields = [
    "name",
    "contactName",
    "contactPhone",
    "contactEmail",
    "address",
    "suburb",
    "preferredProducts",
    "preferredColours",
    "notes",
    "active",
  ];
  const updates: Record<string, unknown> = {};
  for (const f of fields)
    if (req.body[f] !== undefined) updates[f] = req.body[f];
  const [row] = await db
    .update(supplierProfilesTable)
    .set(updates)
    .where(
      and(
        eq(supplierProfilesTable.id, Number(req.params.id)),
        eq(supplierProfilesTable.companyId, companyId(req)),
      ),
    )
    .returning();
  if (!row) return res.status(404).json({ error: "Not found" });
  return res.json(row);
});

// ── Supplier Orders ────────────────────────────────────────────────────────

async function enrichOrder(order: typeof supplierOrdersTable.$inferSelect) {
  const tenantId = order.companyId ?? 0;
  const [supplier] = await db
    .select({
      name: supplierProfilesTable.name,
      address: supplierProfilesTable.address,
      suburb: supplierProfilesTable.suburb,
    })
    .from(supplierProfilesTable)
    .where(
      and(
        eq(supplierProfilesTable.id, order.supplierId),
        eq(supplierProfilesTable.companyId, tenantId),
      ),
    );
  const [sub] = await db
    .select({ name: subcontractorsTable.name })
    .from(subcontractorsTable)
    .where(
      and(
        eq(subcontractorsTable.id, order.subcontractorId),
        eq(subcontractorsTable.companyId, tenantId),
      ),
    );
  const items = await db
    .select()
    .from(supplierOrderItemsTable)
    .where(
      and(
        eq(supplierOrderItemsTable.orderId, order.id),
        eq(supplierOrderItemsTable.companyId, tenantId),
      ),
    );
  return {
    ...order,
    supplierName: supplier?.name ?? "",
    supplierAddress: supplier?.address ?? "",
    supplierSuburb: supplier?.suburb ?? "",
    subcontractorName: sub?.name ?? "",
    totalCost: order.totalCost ? Number(order.totalCost) : null,
    triggerJobIds: (order.triggerJobIds as number[]) ?? [],
    items: items.map((i) => ({
      ...i,
      quantityOrdered: Number(i.quantityOrdered),
      unitCost: i.unitCost ? Number(i.unitCost) : null,
    })),
  };
}

router.get("/supplier-orders", async (req, res) => {
  const conditions = [eq(supplierOrdersTable.companyId, companyId(req))];
  if (req.query.subcontractorId)
    conditions.push(
      eq(
        supplierOrdersTable.subcontractorId,
        Number(req.query.subcontractorId),
      ),
    );
  if (req.query.status)
    conditions.push(
      eq(supplierOrdersTable.status, req.query.status as SupplierOrderStatus),
    );
  if (req.query.supplierId)
    conditions.push(
      eq(supplierOrdersTable.supplierId, Number(req.query.supplierId)),
    );
  const filtered = await db
    .select()
    .from(supplierOrdersTable)
    .where(and(...conditions))
    .orderBy(desc(supplierOrdersTable.createdAt));
  return res.json(await Promise.all(filtered.map(enrichOrder)));
});

router.post("/supplier-orders", async (req, res) => {
  const {
    supplierId,
    subcontractorId,
    urgency,
    requiredByDate,
    adminNotes,
    triggerJobIds,
    items,
  } = req.body;
  if (!supplierId || !subcontractorId || !items?.length)
    return res
      .status(400)
      .json({ error: "supplierId, subcontractorId, items required" });
  const tenantId = companyId(req);
  const [supplier] = await db
    .select()
    .from(supplierProfilesTable)
    .where(
      and(
        eq(supplierProfilesTable.id, Number(supplierId)),
        eq(supplierProfilesTable.companyId, tenantId),
      ),
    );
  const [sub] = await db
    .select()
    .from(subcontractorsTable)
    .where(
      and(
        eq(subcontractorsTable.id, Number(subcontractorId)),
        eq(subcontractorsTable.companyId, tenantId),
      ),
    );
  if (!supplier || !sub)
    return res
      .status(400)
      .json({
        error: "Supplier or employee/subcontractor not found for this company",
      });

  for (const item of items) {
    if (!item.stockItemId) continue;
    const [stockItem] = await db
      .select()
      .from(stockItemsTable)
      .where(
        and(
          eq(stockItemsTable.id, Number(item.stockItemId)),
          eq(stockItemsTable.companyId, tenantId),
        ),
      );
    if (!stockItem)
      return res
        .status(400)
        .json({
          error: `Stock item ${item.stockItemId} not found for this company`,
        });
  }

  // Generate order number
  const count = await db
    .select()
    .from(supplierOrdersTable)
    .where(eq(supplierOrdersTable.companyId, tenantId));
  const orderNumber = `SO-${String(count.length + 1).padStart(4, "0")}`;

  const totalCost = items.reduce(
    (a: number, i: { quantityOrdered: number; unitCost?: number }) => {
      return a + (i.quantityOrdered ?? 0) * (i.unitCost ?? 0);
    },
    0,
  );

  const [order] = await db
    .insert(supplierOrdersTable)
    .values({
      companyId: tenantId,
      supplierId: Number(supplierId),
      subcontractorId: Number(subcontractorId),
      orderNumber,
      urgency: urgency ?? "normal",
      requiredByDate,
      adminNotes,
      triggerJobIds: triggerJobIds ?? [],
      totalCost: totalCost > 0 ? totalCost.toString() : null,
      status: "draft",
    })
    .returning();

  // Insert line items
  for (const item of items) {
    await db.insert(supplierOrderItemsTable).values({
      companyId: tenantId,
      orderId: order.id,
      stockItemId: item.stockItemId ? Number(item.stockItemId) : null,
      productName: item.productName,
      colour: item.colour,
      unit: item.unit ?? "tube",
      quantityOrdered: item.quantityOrdered.toString(),
      unitCost: item.unitCost?.toString(),
      notes: item.notes,
    });
  }

  return res.status(201).json(await enrichOrder(order));
});

router.patch("/supplier-orders/:id", async (req, res) => {
  const id = Number(req.params.id);
  const tenantId = companyId(req);
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  const fields = [
    "status",
    "urgency",
    "adminNotes",
    "subNotes",
    "requiredByDate",
    "pickupDate",
  ];
  for (const f of fields)
    if (req.body[f] !== undefined) updates[f] = req.body[f];
  if (req.body.status === "approved") updates.approvedAt = new Date();
  if (req.body.status === "sent_to_supplier")
    updates.sentToSupplierAt = new Date();
  if (req.body.status === "picked_up") {
    updates.pickupConfirmedAt = new Date();
    // Create inventory transactions for picked up items
    const items = await db
      .select()
      .from(supplierOrderItemsTable)
      .where(
        and(
          eq(supplierOrderItemsTable.orderId, id),
          eq(supplierOrderItemsTable.companyId, tenantId),
        ),
      );
    const [existingOrder] = await db
      .select()
      .from(supplierOrdersTable)
      .where(
        and(
          eq(supplierOrdersTable.id, id),
          eq(supplierOrdersTable.companyId, tenantId),
        ),
      );
    if (existingOrder) {
      const { inventoryTransactionsTable, subInventoryTable: sit } =
        await import("@workspace/db");
      for (const item of items) {
        if (!item.stockItemId) continue;
        await db.insert(inventoryTransactionsTable).values({
          companyId: tenantId,
          subcontractorId: existingOrder.subcontractorId,
          stockItemId: item.stockItemId,
          transactionType: "restock",
          quantity: item.quantityOrdered,
          referenceNote: `Supplier order ${existingOrder.orderNumber} pickup`,
          recordedBy: "system",
        });
        // Update sub inventory
        const [inv] = await db
          .select()
          .from(sit)
          .where(
            and(
              eq(sit.companyId, tenantId),
              eq(sit.subcontractorId, existingOrder.subcontractorId),
              eq(sit.stockItemId, item.stockItemId),
            ),
          )
          .limit(1);
        if (inv) {
          await db
            .update(sit)
            .set({
              currentQuantity: (
                Number(inv.currentQuantity) + Number(item.quantityOrdered)
              ).toString(),
              updatedAt: new Date(),
            })
            .where(and(eq(sit.id, inv.id), eq(sit.companyId, tenantId)));
        } else {
          await db.insert(sit).values({
            companyId: tenantId,
            subcontractorId: existingOrder.subcontractorId,
            stockItemId: item.stockItemId,
            currentQuantity: item.quantityOrdered,
            lastIssuedAt: new Date(),
          });
        }
      }
    }
  }

  const [row] = await db
    .update(supplierOrdersTable)
    .set(updates)
    .where(
      and(
        eq(supplierOrdersTable.id, id),
        eq(supplierOrdersTable.companyId, tenantId),
      ),
    )
    .returning();
  if (!row) return res.status(404).json({ error: "Not found" });
  return res.json(await enrichOrder(row));
});

// POST /supplier-orders/check-and-create — auto-generate order from low stock
router.post("/supplier-orders/check-and-create", async (req, res) => {
  const { subcontractorId, jobIds } = req.body;
  if (!subcontractorId)
    return res.status(400).json({ error: "subcontractorId required" });
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

  const inventory = await db
    .select()
    .from(subInventoryTable)
    .where(
      and(
        eq(subInventoryTable.companyId, tenantId),
        eq(subInventoryTable.subcontractorId, Number(subcontractorId)),
      ),
    );
  const stockItems = await db
    .select()
    .from(stockItemsTable)
    .where(eq(stockItemsTable.companyId, tenantId));
  const stockMap = new Map(stockItems.map((s) => [s.id, s]));

  const lowItems = inventory.filter((inv) => {
    const item = stockMap.get(inv.stockItemId);
    return item && Number(inv.currentQuantity) <= 5;
  });

  if (lowItems.length === 0)
    return res.json({ message: "No low stock items", orders: [] });

  // Find preferred supplier (use first active supplier as fallback)
  const [supplier] = await db
    .select()
    .from(supplierProfilesTable)
    .where(
      and(
        eq(supplierProfilesTable.companyId, tenantId),
        eq(supplierProfilesTable.active, true),
      ),
    )
    .limit(1);
  if (!supplier)
    return res.status(400).json({ error: "No active supplier configured" });

  const count = await db
    .select()
    .from(supplierOrdersTable)
    .where(eq(supplierOrdersTable.companyId, tenantId));
  const orderNumber = `SO-AUTO-${String(count.length + 1).padStart(4, "0")}`;

  const [order] = await db
    .insert(supplierOrdersTable)
    .values({
      companyId: tenantId,
      supplierId: supplier.id,
      subcontractorId: Number(subcontractorId),
      orderNumber,
      urgency: "normal",
      triggerJobIds: jobIds ?? [],
      status: "draft",
      adminNotes: "Auto-generated from low stock check",
    })
    .returning();

  for (const inv of lowItems) {
    const item = stockMap.get(inv.stockItemId)!;
    const reorderQty = Math.max(20, 5 * 4) - Number(inv.currentQuantity);
    await db.insert(supplierOrderItemsTable).values({
      companyId: tenantId,
      orderId: order.id,
      stockItemId: inv.stockItemId,
      productName: item.name,
      colour: item.colour,
      unit: item.unit,
      quantityOrdered: Math.ceil(reorderQty).toString(),
    });
  }

  return res.json(await enrichOrder(order));
});

export default router;

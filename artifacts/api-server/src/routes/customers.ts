import { Router } from "express";
import { db } from "@workspace/db";
import { customersTable } from "@workspace/db";
import { activityTable } from "@workspace/db";
import { and, eq, ilike, or } from "drizzle-orm";
import {
  ListCustomersQueryParams,
  CreateCustomerBody,
  GetCustomerParams,
  UpdateCustomerParams,
  UpdateCustomerBody,
  DeleteCustomerParams,
} from "@workspace/api-zod";
import { companyId } from "../lib/auth.js";

const router = Router();

router.get("/customers", async (req, res) => {
  const parsed = ListCustomersQueryParams.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Invalid query" });

  const { search } = parsed.data;
  const tenantId = companyId(req);

  if (search) {
    const customers = await db
      .select()
      .from(customersTable)
      .where(
        and(
          eq(customersTable.companyId, tenantId),
          or(
            ilike(customersTable.name, `%${search}%`),
            ilike(customersTable.email, `%${search}%`),
            ilike(customersTable.company, `%${search}%`),
            ilike(customersTable.phone, `%${search}%`),
          )!,
        ),
      )
      .orderBy(customersTable.name);
    return res.json(customers);
  }

  const customers = await db
    .select()
    .from(customersTable)
    .where(eq(customersTable.companyId, tenantId))
    .orderBy(customersTable.name);
  return res.json(customers);
});

router.post("/customers", async (req, res) => {
  const parsed = CreateCustomerBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid body" });

  const [customer] = await db
    .insert(customersTable)
    .values({ ...parsed.data, companyId: companyId(req) })
    .returning();

  await db.insert(activityTable).values({
    companyId: companyId(req),
    type: "customer_created",
    description: `New client ${customer.name} added`,
    entityId: customer.id,
    entityType: "customer",
  });

  return res.status(201).json(customer);
});

router.get("/customers/:id", async (req, res) => {
  const parsed = GetCustomerParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });

  const [customer] = await db
    .select()
    .from(customersTable)
    .where(and(eq(customersTable.id, parsed.data.id), eq(customersTable.companyId, companyId(req))));

  if (!customer) return res.status(404).json({ error: "Not found" });
  return res.json(customer);
});

router.patch("/customers/:id", async (req, res) => {
  const params = UpdateCustomerParams.safeParse({ id: Number(req.params.id) });
  const body = UpdateCustomerBody.safeParse(req.body);
  if (!params.success || !body.success) return res.status(400).json({ error: "Invalid request" });

  const [customer] = await db
    .update(customersTable)
    .set({ ...body.data, updatedAt: new Date() })
    .where(and(eq(customersTable.id, params.data.id), eq(customersTable.companyId, companyId(req))))
    .returning();

  if (!customer) return res.status(404).json({ error: "Not found" });
  return res.json(customer);
});

router.delete("/customers/:id", async (req, res) => {
  const parsed = DeleteCustomerParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });

  await db
    .delete(customersTable)
    .where(and(eq(customersTable.id, parsed.data.id), eq(customersTable.companyId, companyId(req))));
  return res.status(204).send();
});

export default router;

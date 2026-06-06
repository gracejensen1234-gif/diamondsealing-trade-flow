import { Router } from "express";
import { db } from "@workspace/db";
import { jobsTable, invoicesTable, customersTable, activityTable } from "@workspace/db";
import { eq, and, gte, sql } from "drizzle-orm";
import { companyId } from "../lib/auth.js";

const router = Router();

router.get("/dashboard/summary", async (req, res) => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
  const tenantId = companyId(req);

  const [jobs, customers, invoices] = await Promise.all([
    db.select().from(jobsTable).where(eq(jobsTable.companyId, tenantId)),
    db.select({ count: sql<number>`count(*)` }).from(customersTable).where(eq(customersTable.companyId, tenantId)),
    db.select().from(invoicesTable).where(eq(invoicesTable.companyId, tenantId)),
  ]);

  const activeJobs = jobs.filter((j) => j.status === "in_progress").length;
  const unpaidInvoices = invoices.filter((i) => i.status === "sent" || i.status === "overdue");
  const unpaidInvoicesTotal = unpaidInvoices.reduce((sum, i) => sum + Number(i.total), 0);
  const totalCustomers = Number(customers[0]?.count ?? 0);

  const paidThisMonth = invoices
    .filter((i) => i.status === "paid" && i.paidAt && new Date(i.paidAt) >= startOfMonth)
    .reduce((sum, i) => sum + Number(i.total), 0);

  const paidLastMonth = invoices
    .filter(
      (i) =>
        i.status === "paid" &&
        i.paidAt &&
        new Date(i.paidAt) >= startOfLastMonth &&
        new Date(i.paidAt) <= endOfLastMonth,
    )
    .reduce((sum, i) => sum + Number(i.total), 0);

  const jobsByStatus = {
    pending: jobs.filter((j) => j.status === "pending").length,
    in_progress: jobs.filter((j) => j.status === "in_progress").length,
    completed: jobs.filter((j) => j.status === "completed").length,
    invoiced: jobs.filter((j) => j.status === "invoiced").length,
    cancelled: jobs.filter((j) => j.status === "cancelled").length,
  };

  return res.json({
    activeJobs,
    pendingQuotes: 0,
    unpaidInvoicesCount: unpaidInvoices.length,
    unpaidInvoicesTotal,
    revenueThisMonth: paidThisMonth,
    revenueLastMonth: paidLastMonth,
    totalCustomers,
    jobsByStatus,
  });
});

router.get("/dashboard/activity", async (req, res) => {
  const activity = await db
    .select()
    .from(activityTable)
    .where(eq(activityTable.companyId, companyId(req)))
    .orderBy(sql`${activityTable.createdAt} desc`)
    .limit(20);
  return res.json(activity);
});

export default router;

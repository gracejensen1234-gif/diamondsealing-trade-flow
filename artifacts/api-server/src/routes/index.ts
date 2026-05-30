import { Router, type IRouter } from "express";
import healthRouter from "./health";
import customersRouter from "./customers";
import jobsRouter from "./jobs";
import quotesRouter from "./quotes";
import invoicesRouter from "./invoices";
import appointmentsRouter from "./appointments";
import dashboardRouter from "./dashboard";
import subcontractorsRouter from "./subcontractors";
import workSessionsRouter from "./work-sessions";
import gpsRouter from "./gps";
import dispatchRouter from "./dispatch";
import jobReportsRouter from "./job-reports";
import stockItemsRouter from "./stock-items";
import xeroRouter from "./xero";
import weeklyInvoicesRouter from "./weekly-invoices";
import adminRouter from "./admin";

const router: IRouter = Router();

router.use(healthRouter);
router.use(dashboardRouter);
router.use(customersRouter);
router.use(jobsRouter);
router.use(quotesRouter);
router.use(invoicesRouter);
router.use(appointmentsRouter);
router.use(subcontractorsRouter);
router.use(workSessionsRouter);
router.use(gpsRouter);
router.use(dispatchRouter);
router.use(jobReportsRouter);
router.use(stockItemsRouter);
router.use(xeroRouter);
router.use(weeklyInvoicesRouter);
router.use(adminRouter);

export default router;

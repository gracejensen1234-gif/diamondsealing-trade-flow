import { Router, type IRouter } from "express";
import healthRouter from "./health";
import customersRouter from "./customers";
import jobsRouter from "./jobs";
import quotesRouter from "./quotes";
import invoicesRouter from "./invoices";
import appointmentsRouter from "./appointments";
import dashboardRouter from "./dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(dashboardRouter);
router.use(customersRouter);
router.use(jobsRouter);
router.use(quotesRouter);
router.use(invoicesRouter);
router.use(appointmentsRouter);

export default router;

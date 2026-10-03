import { Router, type IRouter } from "express";
import healthRouter from "./health";
import ordersRouter from "./orders";
import dashboardRouter from "./dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(ordersRouter);
router.use(dashboardRouter);

export default router;

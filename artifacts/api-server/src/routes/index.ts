import { Router, type IRouter } from "express";
import healthRouter from "./health";
import ordersRouter from "./orders";
import dashboardRouter from "./dashboard";
import authRouter from "./auth";
import { requireSession, requireSameOrigin, requireCsrf } from "../modules/auth/session";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(requireSession);
router.use((req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) { next(); return; }
  requireSameOrigin(req, res, () => { requireCsrf(req, res, next); });
});
router.use(ordersRouter);
router.use(dashboardRouter);
router.all(["/orders", "/orders/:orderId"], (_req, res) => {
  res.set("Allow", "GET").status(405).json({ error: "Perubahan pesanan tidak tersedia." });
});

export default router;

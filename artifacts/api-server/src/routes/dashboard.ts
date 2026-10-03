import { Router, type IRouter } from "express";
import { GetDashboardSummaryResponse } from "@workspace/api-zod";
import { getOrderSummary, listOrders } from "../modules/orders/orders.repository";

const router: IRouter = Router();

router.get("/dashboard/summary", async (_req, res): Promise<void> => {
  const [summary, recentOrders] = await Promise.all([getOrderSummary(), listOrders(5)]);
  res.json(GetDashboardSummaryResponse.parse({ ...summary, recentOrders }));
});

export default router;
import { Router, type IRouter } from "express";
import { GetOrderParams, GetOrderResponse, ListOrdersResponse } from "@workspace/api-zod";
import { findOrder, listOrders } from "../modules/orders/orders.repository";

const router: IRouter = Router();

router.get("/orders", async (_req, res): Promise<void> => {
  res.json(ListOrdersResponse.parse(await listOrders()));
});

router.get("/orders/:orderId", async (req, res): Promise<void> => {
  const parsed = GetOrderParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "ID pesanan tidak valid." });
    return;
  }
  const order = await findOrder(parsed.data.orderId);
  if (!order) {
    res.status(404).json({ error: "Pesanan tidak ditemukan." });
    return;
  }
  res.json(GetOrderResponse.parse(order));
});

export default router;
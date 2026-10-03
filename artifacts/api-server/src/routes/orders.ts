import { Router, type IRouter } from "express";
import { GetOrderParams, GetOrderResponse, ListOrdersQueryParams, ListOrdersResponse } from "@workspace/api-zod";
import { findOrder, listOrders } from "../modules/orders/orders.repository";

const router: IRouter = Router();

router.get("/orders", async (req, res): Promise<void> => {
  const parsed = ListOrdersQueryParams.safeParse(req.query);
  if (!parsed.success || (req.query.search !== undefined && typeof req.query.search !== "string")) {
    res.status(400).json({ error: "Pencarian atau status tidak valid." });
    return;
  }
  res.json(ListOrdersResponse.parse(await listOrders(parsed.data)));
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
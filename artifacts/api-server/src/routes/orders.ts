import { Router, type IRouter } from "express";
import {
  DeliverDigitalOrderParams,
  DeliverDigitalOrderResponse,
  GetOrderParams,
  GetOrderResponse,
  ListOrdersQueryParams,
  ListOrdersResponse,
} from "@workspace/api-zod";
import { findOrder, listOrders } from "../modules/orders/orders.repository";
import { deliverDigitalOrder } from "../modules/lazada/manual-delivery";
import { LazadaError } from "../modules/lazada/client";

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

router.post("/orders/:orderId/deliver-digital", async (req, res): Promise<void> => {
  const parsed = DeliverDigitalOrderParams.safeParse(req.params);
  if (!parsed.success || !req.secure) {
    res.status(400).json({ error: "ID pesanan tidak valid atau koneksi bukan HTTPS." });
    return;
  }
  try {
    const result = await deliverDigitalOrder(res.locals.auth.user.id, res.locals.auth.tokenHash, parsed.data.orderId);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json(DeliverDigitalOrderResponse.parse(result.order));
  } catch (error) {
    const reason = error instanceof LazadaError ? error.reason : "unexpected";
    req.log.warn({ reason }, "Manual Lazada digital delivery request could not be completed");
    const status = reason === "authorization_failed" ? 409 : 502;
    const message = reason === "authorization_failed"
      ? "Koneksi Lazada tidak valid atau kedaluwarsa. Hubungkan ulang di Pengaturan."
      : "Hasil pengiriman tidak dapat diverifikasi. Periksa pesanan di Lazada sebelum mencoba lagi.";
    res.status(status).json({ error: message });
  }
});

export default router;
import { Router } from "express";
import { GetLazadaOrderPushStatusResponse } from "@workspace/api-zod";
import { pushStatus } from "../modules/lazada/automation-state";

const router = Router();
router.get("/lazada/orders/push-status", async (_req, res) => {
  res.json(GetLazadaOrderPushStatusResponse.parse(await pushStatus(res.locals.auth.user.id)));
});
export default router;
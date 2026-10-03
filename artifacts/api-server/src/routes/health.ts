import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";

const router: IRouter = Router();

router.get("/healthz", async (_req, res): Promise<void> => {
  await pool.query("SELECT 1");
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

export default router;

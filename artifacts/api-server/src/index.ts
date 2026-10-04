import app from "./app";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";
import { removeExpiredAuthData } from "./modules/auth/session";
import { startOrderPushWorker } from "./modules/lazada/order-push-worker";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);
pool.on("error", () => logger.error("Database connection unavailable"));

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, "0.0.0.0", () => {
  logger.info({ port }, "Server listening");
});

server.on("error", (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
});
const maintenance = setInterval(() => {
  void removeExpiredAuthData().catch(() => logger.warn("Auth maintenance unavailable"));
}, 10 * 60 * 1000);
maintenance.unref();
const stopOrderPushWorker = startOrderPushWorker();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    clearInterval(maintenance);
    stopOrderPushWorker();
    logger.info({ signal }, "Shutting down");
    const timeout = setTimeout(() => process.exit(1), 10_000);
    timeout.unref();
    server.close(() => {
      void pool.end().then(() => process.exit(0));
    });
  });
}

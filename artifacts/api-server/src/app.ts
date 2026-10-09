import express, { type Express, type ErrorRequestHandler } from "express";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { lazadaPushRouter } from "./routes/lazada-push";
import { lazadaImPushRouter } from "./routes/lazada-im-push";
import { trustedProxyAddresses } from "./lib/trusted-proxy";

const app: Express = express();
app.set("trust proxy", trustedProxyAddresses());
app.use((_req, res, next) => {
  (res.locals as { requestStartedAt?: number }).requestStartedAt = performance.now();
  next();
});
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false, strictTransportSecurity: process.env.NODE_ENV === "production" ? { maxAge: 31536000 } : false }));

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.disable("x-powered-by");
app.use(cookieParser());
app.use("/api", (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
// Outside cookie/CSRF auth, but protected by LPM signature over exact raw bytes.
app.use("/api/lazada/orders/push", lazadaPushRouter);
// Separate public receiver; its IM-specific signature verifier fails closed until verified.
app.use("/api/lazada/im/push", lazadaImPushRouter);
app.use(express.json({ limit: "16kb" }));

app.use("/api", router);
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Endpoint tidak ditemukan." });
});

const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const status = err?.type === "entity.too.large" ? 413 : err?.type === "entity.parse.failed" ? 400 : err?.type === "encoding.unsupported" ? 415 : 500;
  // Raw exceptions can contain passwords, SQL parameters, tokens, and database URLs.
  req.log.error({ status }, "API request failed");
  res.status(status).json({ error: status === 500 ? "Terjadi kesalahan pada server." : "Permintaan tidak valid." });
};
app.use(errorHandler);

export default app;

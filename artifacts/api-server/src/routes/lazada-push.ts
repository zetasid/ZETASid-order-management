import express, { Router } from "express";
import { logger } from "../lib/logger";
import { configuration } from "../modules/lazada/security";
import { validPushSignature, parsePush, PushPayloadError } from "../modules/lazada/push-security";
import { pushQuota, receivePush } from "../modules/lazada/push-receiver";

export const lazadaPushRouter = Router();
lazadaPushRouter.post("/", express.raw({ type: "application/json", limit: "16kb", inflate: false }), async (req, res) => {
  if (!req.secure) { res.status(400).json({ error: "HTTPS wajib." }); return; }
  const config = configuration();
  if (!config) { res.status(503).json({ error: "Konfigurasi tidak tersedia." }); return; }
  try {
    if (!await pushQuota(req.ip ?? "unknown")) {
      res.set("Retry-After", "60").status(429).json({ error: "Batas webhook tercapai." }); return;
    }
    if (!Buffer.isBuffer(req.body) || !validPushSignature(req.body, req.headers.authorization, config)) {
      res.status(401).json({ error: "Signature webhook tidak valid." }); return;
    }
    let push;
    try {
      push = parsePush(req.body, config, fields => {
        // TEMPORARY: base logger deliberately excludes request bindings (URL,
        // headers, etc.); only the request ID and allowlisted scalar fields.
        logger.warn({ requestId: req.id, ...fields }, "Lazada push diagnostic");
      });
    }
    catch (error) {
      // Fixed reason codes and allowlisted field names only: no values, raw body,
      // signature or exception message may be logged.
      req.log.warn({ reason: error instanceof PushPayloadError ? error.reason : "invalid_schema",
        fields: error instanceof PushPayloadError ? error.fields : [] }, "Lazada push rejected");
      res.status(400).json({ error: "Payload order push tidak valid." }); return;
    }
    if (!await receivePush(push, config)) {
      req.log.warn({ reason: "timestamp_out_of_window" }, "Lazada push rejected");
      res.status(400).json({ error: "Timestamp push kedaluwarsa atau tidak valid." }); return;
    }
    // Durable ACK, no provider API calls on the request path (LPM's 500ms deadline).
    res.status(200).json({ accepted: true });
  } catch {
    req.log.warn("Lazada push reception unavailable");
    res.status(503).json({ error: "Push belum tersimpan. Silakan retry." });
  }
});
lazadaPushRouter.all("/", (_req, res) => { res.set("Allow", "POST").status(405).end(); });
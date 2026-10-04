import express, { Router } from "express";
import { configuration } from "../modules/lazada/security";
import { validPushSignature, parsePush } from "../modules/lazada/push-security";
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
    try { push = parsePush(req.body, config); }
    catch { res.status(400).json({ error: "Payload order push tidak valid." }); return; }
    if (!await receivePush(push, config)) {
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
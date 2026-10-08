import express, { Router } from "express";
import { imConfiguration, type LazadaConfig } from "../modules/lazada/security";
import {
  enqueueImSessionUpdate,
  parseImSessionUpdate,
  scheduleImSessionSyncDrain,
  verifyImPushSignature,
  type ImPushAuthenticationResult,
  type ImPushSignatureVerifier,
  type ImSessionUpdateEvent,
  type ImSessionUpdateQueueResult,
} from "../modules/lazada/im-push";

const MAX_BODY_BYTES = 16 * 1024;

export type LazadaImPushRouterDependencies = {
  getConfig?: () => LazadaConfig | null;
  verifySignature?: ImPushSignatureVerifier;
  enqueueSessionUpdate?: (
    config: LazadaConfig,
    event: ImSessionUpdateEvent,
  ) => Promise<ImSessionUpdateQueueResult>;
  scheduleProcessing?: () => void;
};

export function createLazadaImPushRouter(dependencies: LazadaImPushRouterDependencies = {}) {
  const getConfig = dependencies.getConfig ?? imConfiguration;
  const verifySignature = dependencies.verifySignature ?? verifyImPushSignature;
  const enqueueSessionUpdate = dependencies.enqueueSessionUpdate ?? enqueueImSessionUpdate;
  const scheduleProcessing = dependencies.scheduleProcessing ?? scheduleImSessionSyncDrain;
  const router = Router();

  router.post("/", express.raw({
    type: "application/json",
    limit: MAX_BODY_BYTES,
    inflate: false,
  }), async (req, res) => {
    if (!req.secure) {
      res.status(400).json({ error: "HTTPS wajib." });
      return;
    }
    const config = getConfig();
    if (!config) {
      res.status(503).json({ error: "Penerima IM belum dikonfigurasi." });
      return;
    }
    if (!Buffer.isBuffer(req.body)) {
      res.status(400).json({ error: "Payload IM tidak valid." });
      return;
    }

    let authentication: ImPushAuthenticationResult;
    try {
      authentication = await verifySignature(req.body, req.headers, config);
    } catch {
      authentication = "unavailable";
    }
    if (authentication === "unavailable") {
      res.status(503).json({ error: "Verifikasi IM belum tersedia." });
      return;
    }
    if (authentication !== "valid") {
      res.status(401).json({ error: "Autentikasi IM tidak valid." });
      return;
    }

    const parsed = parseImSessionUpdate(req.body);
    if (parsed.kind === "invalid") {
      res.status(400).json({ error: "Payload IM tidak valid." });
      return;
    }
    if (parsed.kind === "unsupported") {
      res.status(200).end();
      return;
    }

    try {
      for (const event of parsed.events) {
        const result = await enqueueSessionUpdate(config, event);
        if (result.kind === "unmapped") {
          res.status(404).json({ error: "Event IM tidak dapat diproses." });
          return;
        }
      }
      scheduleProcessing();
      res.status(200).end();
    } catch {
      res.status(503).json({ error: "Event IM belum dapat diproses." });
    }
  });

  router.all("/", (_req, res) => {
    res.set("Allow", "POST").status(405).end();
  });
  return router;
}

export const lazadaImPushRouter = createLazadaImPushRouter();

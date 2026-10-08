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
const ACK_QUEUE_WAIT_MS = 350;

type EnqueueBatchResult = {
  kind: "queued" | "unmapped" | "failed";
  durableCount: number;
};

export type LazadaImPushRouterDependencies = {
  getConfig?: () => LazadaConfig | null;
  verifySignature?: ImPushSignatureVerifier;
  enqueueSessionUpdate?: (
    config: LazadaConfig,
    event: ImSessionUpdateEvent,
  ) => Promise<ImSessionUpdateQueueResult>;
  scheduleProcessing?: () => void;
  /** Test seam; production uses the fixed ACK_QUEUE_WAIT_MS budget. */
  ackDeadlineMs?: number;
};

export function createLazadaImPushRouter(dependencies: LazadaImPushRouterDependencies = {}) {
  const getConfig = dependencies.getConfig ?? imConfiguration;
  const verifySignature = dependencies.verifySignature ?? verifyImPushSignature;
  const enqueueSessionUpdate = dependencies.enqueueSessionUpdate ?? enqueueImSessionUpdate;
  const scheduleProcessing = dependencies.scheduleProcessing ?? scheduleImSessionSyncDrain;
  const ackDeadlineMs = dependencies.ackDeadlineMs ?? ACK_QUEUE_WAIT_MS;
  if (!Number.isSafeInteger(ackDeadlineMs) || ackDeadlineMs < 1 || ackDeadlineMs > ACK_QUEUE_WAIT_MS)
    throw new Error("Invalid IM webhook ACK queue budget");
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
      const enqueueBatch = async (): Promise<EnqueueBatchResult> => {
        let durableCount = 0;
        for (const event of parsed.events) {
          try {
            const result = await enqueueSessionUpdate(config, event);
            if (result.kind === "unmapped") return { kind: "unmapped", durableCount };
            durableCount += 1;
          } catch {
            return { kind: "failed", durableCount };
          }
        }
        return { kind: "queued", durableCount };
      };
      const enqueuePromise = enqueueBatch();
      let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
      const deadlinePromise = new Promise<{ kind: "timeout" }>(resolve => {
        deadlineTimer = setTimeout(() => resolve({ kind: "timeout" }), ackDeadlineMs);
      });
      const outcome = await Promise.race([
        enqueuePromise.then(result => ({ kind: "completed" as const, result })),
        deadlinePromise,
      ]);
      if (deadlineTimer) clearTimeout(deadlineTimer);

      if (outcome.kind === "timeout") {
        // Do not ACK work that has not reached the durable session queue.
        // If the write completes late, schedule its already-durable work; Lazada
        // receives 503 and may safely retry because queue/message writes are idempotent.
        void enqueuePromise.then(result => {
          if (result.durableCount > 0) scheduleProcessing();
        }).catch(() => {
          req.log.warn("Lazada IM session sync scheduling failed after ACK deadline");
        });
        res.status(503).json({ error: "Event IM belum dapat diproses." });
        return;
      }

      if (outcome.result.durableCount > 0) scheduleProcessing();
      if (outcome.result.kind === "unmapped") {
        res.status(404).json({ error: "Event IM tidak dapat diproses." });
        return;
      }
      if (outcome.result.kind === "failed") {
        res.status(503).json({ error: "Event IM belum dapat diproses." });
        return;
      }
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

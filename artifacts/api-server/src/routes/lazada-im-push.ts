import express, { Router } from "express";
import { logger } from "../lib/logger";
import { imPushConfiguration, type LazadaConfig } from "../modules/lazada/security";
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
const ACK_END_TO_END_BUDGET_MS = 450;

type EnqueueBatchResult = {
  kind: "queued" | "duplicate" | "unmapped" | "failed";
  durableCount: number;
  newJobCount: number;
};

export type LazadaImPushRouterDependencies = {
  getConfig?: () => LazadaConfig | null;
  verifySignature?: ImPushSignatureVerifier;
  enqueueSessionUpdate?: (
    config: LazadaConfig,
    event: ImSessionUpdateEvent,
  ) => Promise<ImSessionUpdateQueueResult>;
  scheduleProcessing?: () => void;
  /** Test seam; production caps the complete server-side request at 450 ms. */
  ackDeadlineMs?: number;
  onAckComplete?: (durationMs: number, statusCode: number) => void;
};

export function createLazadaImPushRouter(dependencies: LazadaImPushRouterDependencies = {}) {
  const getConfig = dependencies.getConfig ?? imPushConfiguration;
  const verifySignature = dependencies.verifySignature ?? verifyImPushSignature;
  const enqueueSessionUpdate = dependencies.enqueueSessionUpdate ?? enqueueImSessionUpdate;
  const scheduleProcessing = dependencies.scheduleProcessing ?? scheduleImSessionSyncDrain;
  const ackDeadlineMs = dependencies.ackDeadlineMs ?? ACK_END_TO_END_BUDGET_MS;
  if (!Number.isSafeInteger(ackDeadlineMs) || ackDeadlineMs < 1
    || ackDeadlineMs > ACK_END_TO_END_BUDGET_MS)
    throw new Error("Invalid IM webhook ACK deadline");
  const router = Router();
  const requestStart = new WeakMap<object, number>();
  const deadlineExpired = new WeakSet<object>();

  router.use((req, res, next) => {
    if (req.method !== "POST") { next(); return; }
    const suppliedStart = (res.locals as { requestStartedAt?: number }).requestStartedAt;
    const startedAt = typeof suppliedStart === "number" && Number.isFinite(suppliedStart)
      ? suppliedStart : performance.now();
    requestStart.set(req, startedAt);
    const timerDelay = Math.max(1, ackDeadlineMs - (performance.now() - startedAt));
    const deadline = setTimeout(() => {
      if (res.writableEnded || res.headersSent) return;
      deadlineExpired.add(req);
      res.status(503).json({ error: "Event IM belum dapat diproses." });
      req.resume();
    }, timerDelay);
    deadline.unref?.();
    const finish = () => {
      clearTimeout(deadline);
      const durationMs = Math.max(0, performance.now() - startedAt);
      try { dependencies.onAckComplete?.(durationMs, res.statusCode); } catch { /* test/metrics hook */ }
      logger.info({ durationMs: Math.round(durationMs), statusCode: res.statusCode },
        "Lazada IM webhook request completed");
    };
    res.once("finish", finish);
    res.once("close", () => clearTimeout(deadline));
    next();
  });

  const expired = (req: object) => deadlineExpired.has(req);
  const remainingBudgetMs = (req: object) => {
    const startedAt = requestStart.get(req);
    return startedAt === undefined ? 0 : ackDeadlineMs - (performance.now() - startedAt);
  };

  router.post("/", express.raw({
    type: "application/json",
    limit: MAX_BODY_BYTES,
    inflate: false,
  }), async (req, res) => {
    if (expired(req)) return;
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
    if (expired(req)) return;
    if (authentication === "unavailable") {
      res.status(503).json({ error: "Verifikasi IM belum tersedia." });
      return;
    }
    if (authentication !== "valid") {
      res.status(401).json({ error: "Autentikasi IM tidak valid." });
      return;
    }

    const parsed = parseImSessionUpdate(req.body);
    if (expired(req)) return;
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
        let newJobCount = 0;
        for (const event of parsed.events) {
          try {
            const result = await enqueueSessionUpdate(config, event);
            if (result.kind === "unmapped")
              return { kind: "unmapped", durableCount, newJobCount };
            durableCount += 1;
            if (result.kind === "queued") newJobCount += 1;
          } catch {
            return { kind: "failed", durableCount, newJobCount };
          }
        }
        return { kind: newJobCount > 0 ? "queued" : "duplicate", durableCount, newJobCount };
      };
      const remainingMs = remainingBudgetMs(req);
      if (remainingMs <= 0) {
        res.status(503).json({ error: "Event IM belum dapat diproses." });
        return;
      }
      const enqueuePromise = enqueueBatch();
      let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
      const deadlinePromise = new Promise<{ kind: "timeout" }>(resolve => {
        deadlineTimer = setTimeout(() => resolve({ kind: "timeout" }), remainingMs);
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
          if (result.newJobCount > 0) scheduleProcessing();
        }).catch(() => logger.warn("Lazada IM session sync scheduling failed after ACK deadline"));
        if (!res.writableEnded)
          res.status(503).json({ error: "Event IM belum dapat diproses." });
        return;
      }

      if (expired(req) || remainingBudgetMs(req) <= 0) {
        if (outcome.result.newJobCount > 0) scheduleProcessing();
        if (!res.writableEnded) res.status(503).json({ error: "Event IM belum dapat diproses." });
        return;
      }
      if (outcome.result.newJobCount > 0) scheduleProcessing();
      if (expired(req) || remainingBudgetMs(req) <= 0) {
        if (!res.writableEnded) res.status(503).json({ error: "Event IM belum dapat diproses." });
        return;
      }
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

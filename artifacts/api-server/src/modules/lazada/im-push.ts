import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { and, asc, eq, inArray, isNotNull, isNull, lte, lt, or, sql } from "drizzle-orm";
import {
  db,
  lazadaImMessagesTable,
  lazadaImPushEventReceiptsTable,
  lazadaImSessionsTable,
} from "@workspace/db";
import { logger } from "../../lib/logger";
import { LazadaError } from "./client";
import { getImMessages } from "./im-chat";
import { resolveImSessionUpdateUserId } from "./im-connection";
import type { ImMessage, ImPageInput } from "./im-client";
import { imConfiguration, sealImMessageContent, type LazadaConfig } from "./security";

const MAX_BODY_BYTES = 16 * 1024;
const IM_PAGE_SIZE = 20;
const MAX_PAGES_PER_SYNC = 1_000;
const JOB_LEASE_MS = 2 * 60 * 1000;
const QUEUE_RECOVERY_INTERVAL_MS = 5_000;
const MAX_SYNC_ATTEMPTS = 5;
const BASE_SYNC_RETRY_DELAY_MS = 5_000;
const MAX_SYNC_RETRY_DELAY_MS = 30 * 60 * 1000;
const EVENT_RECEIPT_RETENTION_MS = 24 * 60 * 60 * 1000;
const EVENT_RECEIPT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const MESSAGE_RETENTION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const MESSAGE_RETENTION_BATCH_SIZE = 500;
const MESSAGE_RETENTION_MAX_BATCHES_PER_RUN = 10;
const sessionIdPattern = /^[A-Za-z0-9._:-]{1,256}$/;

class ImPaginationCursorError extends Error {}

export type ImSessionUpdateEvent = {
  message_type: 19;
  sync_type: "SESSION_UPDATE";
  seller_id: string;
  session_id: string;
  unread_count?: number;
  site_id?: string;
  // Internal input for ZETAS receipt deduplication; neither field is a Lazada event ID.
  rawBodySha256: string;
  dataItemIndex: number;
};

export type ImPushAuthenticationResult = "valid" | "invalid" | "unavailable";
export type ImPushSignatureVerifier = (
  rawBody: Buffer,
  headers: import("node:http").IncomingHttpHeaders,
  config: LazadaConfig,
) => Promise<ImPushAuthenticationResult>;

export type ImPushPayloadResult =
  | { kind: "invalid" }
  | { kind: "unsupported" }
  | { kind: "session_updates"; events: ImSessionUpdateEvent[] };

export type ImMessagePageFetcher = (
  userId: string,
  sessionId: string,
  input: ImPageInput,
) => Promise<Awaited<ReturnType<typeof getImMessages>>>;

export type ImSessionUpdateQueueResult =
  | { kind: "unmapped" }
  | { kind: "queued" | "duplicate"; userId: string; sessionId: string };

export type ImSessionSyncRequeueResult = "queued" | "not_found" | "not_blocked";

export type ImSessionSyncJobResult =
  | { kind: "empty" }
  | { kind: "failed" }
  | { kind: "processed"; userId: string; sessionId: string; insertedMessageCount: number };

export type ImSessionSyncOptions = {
  leaseMs?: number;
  heartbeatIntervalMs?: number;
  sealContent?: (userId: string, content: string) => string;
};

type ClaimedJob = {
  id: string;
  userId: string;
  lazadaSessionId: string;
  syncRequestedAt: Date;
  syncStartAt: Date;
  syncRequestVersion: number;
  syncCursorStartTime: string | null;
  syncCursorMessageId: string | null;
  syncCursorRequestVersion: number | null;
  syncCursorHistory: string[];
  syncAttempts: number;
  leaseToken: string;
};

function syncRetryDelayMs(attempt: number): number {
  const exponent = Math.max(0, Math.min(attempt - 1, MAX_SYNC_ATTEMPTS - 1));
  return Math.min(BASE_SYNC_RETRY_DELAY_MS * 2 ** exponent, MAX_SYNC_RETRY_DELAY_MS);
}

function permanentSyncFailure(error: unknown): boolean {
  if (error instanceof ImPaginationCursorError) return true;
  if (!(error instanceof LazadaError)) return false;
  return error.reason !== "api_unavailable" && error.reason !== "sync_busy";
}

function configuredImMessageRetentionDays(env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = env.LAZADA_IM_MESSAGE_RETENTION_DAYS;
  if (raw === undefined) return null;
  if (!/^\d{1,4}$/.test(raw)) return null;
  const days = Number(raw);
  return Number.isSafeInteger(days) && days >= 1 && days <= 3650 ? days : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * ZETAS-only receipt deduplication key, not a Lazada event ID.
 * rawBodySha256 is computed from the exact received bytes; the scope prevents
 * reuse across IM apps, API countries, sellers, or items in one data[] batch.
 */
export function createInternalImPushDeduplicationKey(
  config: LazadaConfig,
  event: ImSessionUpdateEvent,
): string {
  return createHmac("sha256", config.appSecret)
    .update("zetas-internal-lazada-im-session-update-receipt-v2\u0000", "utf8")
    .update(config.fingerprint, "utf8")
    .update("\u0000", "utf8")
    .update(config.country, "utf8")
    .update("\u0000", "utf8")
    .update(event.seller_id, "utf8")
    .update("\u0000", "utf8")
    .update(event.rawBodySha256, "utf8")
    .update("\u0000", "utf8")
    .update(String(event.dataItemIndex), "utf8")
    .digest("hex");
}

function normalizeSellerId(value: unknown): string | null {
  if (typeof value === "number")
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  if (typeof value !== "string") return null;
  const sellerId = value.trim();
  return sellerId.length > 0 && sellerId.length <= 128 && !/[\u0000-\u001f\u007f]/.test(sellerId)
    ? sellerId : null;
}

export function parseImSessionUpdate(rawBody: Buffer): ImPushPayloadResult {
  if (!Buffer.isBuffer(rawBody) || rawBody.byteLength === 0 || rawBody.byteLength > MAX_BODY_BYTES)
    return { kind: "invalid" };
  // Hash the exact bytes received from HTTP; never serialize parsed JSON for this key.
  const rawBodySha256 = createHash("sha256").update(rawBody).digest("hex");
  let value: unknown;
  try { value = JSON.parse(rawBody.toString("utf8")); }
  catch { return { kind: "invalid" }; }
  if (!isRecord(value)) return { kind: "invalid" };
  if (value.message_type !== 19) return { kind: "unsupported" };
  const sellerId = normalizeSellerId(value.seller_id);
  if (!sellerId || !Array.isArray(value.data) || value.data.length === 0)
    return { kind: "invalid" };
  const events: ImSessionUpdateEvent[] = [];
  for (let dataItemIndex = 0; dataItemIndex < value.data.length; dataItemIndex += 1) {
    const item = value.data[dataItemIndex];
    if (!isRecord(item) || typeof item.sync_type !== "string" || item.sync_type.length === 0)
      return { kind: "invalid" };
    if (item.sync_type !== "SESSION_UPDATE") continue;
    const sessionId = item.session_id;
    const unreadCount = item.unread_count;
    const siteId = item.site_id;
    if (typeof sessionId !== "string" || !sessionIdPattern.test(sessionId))
      return { kind: "invalid" };
    if (unreadCount !== undefined && (!Number.isSafeInteger(unreadCount) || (unreadCount as number) < 0))
      return { kind: "invalid" };
    if (siteId !== undefined && siteId !== null
      && (typeof siteId !== "string" || siteId.length > 128 || /[\u0000-\u001f\u007f]/.test(siteId)))
      return { kind: "invalid" };
    events.push({
      message_type: 19,
      sync_type: "SESSION_UPDATE",
      seller_id: sellerId,
      session_id: sessionId,
      rawBodySha256,
      dataItemIndex,
      ...(unreadCount === undefined ? {} : { unread_count: unreadCount as number }),
      ...(typeof siteId === "string" ? { site_id: siteId } : {}),
    });
  }
  if (events.length === 0) return { kind: "unsupported" };
  return {
    kind: "session_updates",
    events,
  };
}

export const verifyImPushSignature: ImPushSignatureVerifier = async (rawBody, headers, config) => {
  if (!Buffer.isBuffer(rawBody) || rawBody.byteLength === 0 || rawBody.byteLength > MAX_BODY_BYTES)
    return "invalid";
  const authorization = headers.authorization;
  if (typeof authorization !== "string" || !/^[0-9a-f]{64}$/.test(authorization))
    return "invalid";

  const expected = createHmac("sha256", config.appSecret)
    .update(config.appKey, "utf8")
    .update(rawBody)
    .digest();
  const provided = Buffer.from(authorization, "hex");
  return timingSafeEqual(expected, provided) ? "valid" : "invalid";
};

export async function enqueueImSessionUpdate(
  config: LazadaConfig,
  event: ImSessionUpdateEvent,
): Promise<ImSessionUpdateQueueResult> {
  if (event.message_type !== 19 || event.sync_type !== "SESSION_UPDATE"
    || !sessionIdPattern.test(event.session_id) || !normalizeSellerId(event.seller_id)
    || !/^[0-9a-f]{64}$/.test(event.rawBodySha256)
    || !Number.isSafeInteger(event.dataItemIndex) || event.dataItemIndex < 0)
    return { kind: "unmapped" };

  const userId = await resolveImSessionUpdateUserId(config, event);
  if (!userId) return { kind: "unmapped" };

  const now = new Date();
  const result = await db.transaction(async (tx) => {
    const [receipt] = await tx.insert(lazadaImPushEventReceiptsTable).values({
      userId,
      eventKey: createInternalImPushDeduplicationKey(config, event),
    }).onConflictDoNothing().returning({ eventKey: lazadaImPushEventReceiptsTable.eventKey });
    if (!receipt) return { kind: "duplicate" as const, userId, sessionId: event.session_id };

    await tx.insert(lazadaImSessionsTable).values({
      userId,
      lazadaSessionId: event.session_id,
      unreadCount: event.unread_count ?? 0,
      syncRequestedAt: now,
      syncStartAt: now,
      syncNextAttemptAt: now,
      syncAttempts: 0,
      syncRequestVersion: 1,
      ...(event.site_id === undefined ? {} : { siteId: event.site_id }),
    }).onConflictDoUpdate({
      target: [lazadaImSessionsTable.userId, lazadaImSessionsTable.lazadaSessionId],
      set: {
        updatedAt: now,
        syncRequestedAt: now,
        syncStartAt: sql`CASE
          WHEN ${lazadaImSessionsTable.syncBlockedAt} IS NOT NULL
            THEN ${lazadaImSessionsTable.syncStartAt}
          WHEN ${lazadaImSessionsTable.syncRequestedAt} IS NULL THEN ${now}
          ELSE COALESCE(${lazadaImSessionsTable.syncStartAt}, ${now})
        END`,
        syncNextAttemptAt: sql`CASE
          WHEN ${lazadaImSessionsTable.syncBlockedAt} IS NOT NULL
            THEN ${lazadaImSessionsTable.syncNextAttemptAt}
          ELSE ${now}
        END`,
        syncAttempts: sql`CASE
          WHEN ${lazadaImSessionsTable.syncBlockedAt} IS NOT NULL
            THEN ${lazadaImSessionsTable.syncAttempts}
          ELSE 0
        END`,
        syncRequestVersion: sql`${lazadaImSessionsTable.syncRequestVersion} + 1`,
        ...(event.unread_count === undefined ? {} : { unreadCount: event.unread_count }),
        ...(event.site_id === undefined ? {} : { siteId: event.site_id }),
      },
    });
    return { kind: "queued" as const, userId, sessionId: event.session_id };
  });
  return result;
}

export async function requeueImSessionSync(userId: string, sessionId: string): Promise<ImSessionSyncRequeueResult> {
  if (!sessionIdPattern.test(sessionId)) return "not_found";
  const now = new Date();
  return db.transaction(async tx => {
    const [session] = await tx.select({
      id: lazadaImSessionsTable.id,
      syncRequestedAt: lazadaImSessionsTable.syncRequestedAt,
      syncBlockedAt: lazadaImSessionsTable.syncBlockedAt,
      syncLeaseUntil: lazadaImSessionsTable.syncLeaseUntil,
    }).from(lazadaImSessionsTable).where(and(
      eq(lazadaImSessionsTable.userId, userId),
      eq(lazadaImSessionsTable.lazadaSessionId, sessionId),
    )).for("update");
    if (!session) return "not_found";
    if (!session.syncRequestedAt || !session.syncBlockedAt
      || (session.syncLeaseUntil && session.syncLeaseUntil > now)) return "not_blocked";
    await tx.update(lazadaImSessionsTable).set({
      syncBlockedAt: null,
      syncAttempts: 0,
      syncNextAttemptAt: now,
      syncStartAt: now,
      syncCursorStartTime: null,
      syncCursorMessageId: null,
      syncCursorRequestVersion: null,
      syncCursorHistory: [],
      syncRequestVersion: sql`${lazadaImSessionsTable.syncRequestVersion} + 1`,
      syncLeaseUntil: null,
      syncLeaseToken: null,
      updatedAt: now,
    }).where(eq(lazadaImSessionsTable.id, session.id));
    return "queued";
  });
}

async function claimNextJob(leaseMs = JOB_LEASE_MS): Promise<ClaimedJob | null> {
  const now = new Date();
  const leaseToken = randomUUID();
  const leaseUntil = new Date(now.getTime() + leaseMs);
  return db.transaction(async tx => {
    const [candidate] = await tx.select().from(lazadaImSessionsTable)
      .where(and(
        isNotNull(lazadaImSessionsTable.syncRequestedAt),
        lte(lazadaImSessionsTable.syncNextAttemptAt, now),
        isNull(lazadaImSessionsTable.syncBlockedAt),
        or(isNull(lazadaImSessionsTable.syncLeaseUntil), lt(lazadaImSessionsTable.syncLeaseUntil, now)),
      ))
      .orderBy(asc(lazadaImSessionsTable.syncNextAttemptAt), asc(lazadaImSessionsTable.syncRequestedAt))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!candidate?.syncRequestedAt) return null;
    const [claimed] = await tx.update(lazadaImSessionsTable)
      .set({ syncLeaseUntil: leaseUntil, syncLeaseToken: leaseToken })
      .where(eq(lazadaImSessionsTable.id, candidate.id))
      .returning({
        id: lazadaImSessionsTable.id,
        userId: lazadaImSessionsTable.userId,
        lazadaSessionId: lazadaImSessionsTable.lazadaSessionId,
        syncRequestedAt: lazadaImSessionsTable.syncRequestedAt,
        syncStartAt: lazadaImSessionsTable.syncStartAt,
        syncRequestVersion: lazadaImSessionsTable.syncRequestVersion,
        syncCursorStartTime: lazadaImSessionsTable.syncCursorStartTime,
        syncCursorMessageId: lazadaImSessionsTable.syncCursorMessageId,
        syncCursorRequestVersion: lazadaImSessionsTable.syncCursorRequestVersion,
        syncCursorHistory: lazadaImSessionsTable.syncCursorHistory,
        syncAttempts: lazadaImSessionsTable.syncAttempts,
      });
    const syncRequestedAt = claimed?.syncRequestedAt;
    if (!claimed || !syncRequestedAt) return null;
    return {
      id: claimed.id,
      userId: claimed.userId,
      lazadaSessionId: claimed.lazadaSessionId,
      syncRequestedAt,
      syncStartAt: claimed.syncStartAt ?? syncRequestedAt,
      syncRequestVersion: claimed.syncRequestVersion,
      syncCursorStartTime: claimed.syncCursorStartTime,
      syncCursorMessageId: claimed.syncCursorMessageId,
      syncCursorRequestVersion: claimed.syncCursorRequestVersion,
      syncCursorHistory: claimed.syncCursorHistory ?? [],
      syncAttempts: claimed.syncAttempts,
      leaseToken,
    };
  });
}

async function renewJobLease(job: ClaimedJob, leaseMs: number): Promise<boolean> {
  const now = new Date();
  const [renewed] = await db.update(lazadaImSessionsTable)
    .set({ syncLeaseUntil: new Date(now.getTime() + leaseMs) })
    .where(and(
      eq(lazadaImSessionsTable.id, job.id),
      eq(lazadaImSessionsTable.syncLeaseToken, job.leaseToken),
      isNotNull(lazadaImSessionsTable.syncLeaseUntil),
      sql`${lazadaImSessionsTable.syncLeaseUntil} > ${now}`,
    ))
    .returning({ id: lazadaImSessionsTable.id });
  return !!renewed;
}

type FetchedImMessagePage = {
  messages: ImMessage[];
  checkpoint: string | null;
  hasMore: boolean;
  nextStartTime: string | null;
  nextMessageId: string | null;
  cursorHistory: string[];
  cursorRequestVersion: number;
};

function cursorFingerprint(startTime: string, cursor?: string): string {
  return createHash("sha256")
    .update(JSON.stringify([startTime, cursor ?? null]), "utf8")
    .digest("hex");
}

async function fetchMessagePage(
  job: ClaimedJob,
  fetchMessages: ImMessagePageFetcher,
): Promise<FetchedImMessagePage> {
  const hasCursor = job.syncCursorStartTime !== null
    || job.syncCursorMessageId !== null
    || job.syncCursorRequestVersion !== null;
  if (hasCursor && (
    !job.syncCursorStartTime
    || !job.syncCursorMessageId
    || job.syncCursorRequestVersion === null
  )) throw new ImPaginationCursorError("IM pagination checkpoint is inconsistent");

  const startTime = hasCursor
    ? job.syncCursorStartTime!
    : String(job.syncStartAt.getTime());
  const cursor = hasCursor ? job.syncCursorMessageId! : undefined;
  const cursorRequestVersion = job.syncCursorRequestVersion ?? job.syncRequestVersion;
  const page = await fetchMessages(job.userId, job.lazadaSessionId, {
    startTime,
    pageSize: IM_PAGE_SIZE,
    ...(cursor === undefined ? {} : { cursor }),
  });
  if (!Array.isArray(page.message_list) || typeof page.has_more !== "boolean")
    throw new Error("IM message page is invalid");

  const checkpoint = page.last_message_id
    ?? page.message_list.at(-1)?.message_id
    ?? null;
  if (!page.has_more) {
    return {
      messages: page.message_list,
      checkpoint,
      hasMore: false,
      nextStartTime: null,
      nextMessageId: null,
      cursorHistory: [],
      cursorRequestVersion,
    };
  }

  const nextStartTime = page.next_start_time;
  const nextMessageId = page.last_message_id;
  if (typeof nextStartTime !== "string" || nextStartTime.length === 0
    || typeof nextMessageId !== "string" || nextMessageId.length === 0)
    throw new ImPaginationCursorError("IM pagination cursor is missing");

  const pageKey = cursorFingerprint(startTime, cursor);
  const nextKey = cursorFingerprint(nextStartTime, nextMessageId);
  if (nextKey === pageKey || job.syncCursorHistory.includes(nextKey))
    throw new ImPaginationCursorError("IM pagination cursor repeated");
  if (job.syncCursorHistory.length >= MAX_PAGES_PER_SYNC)
    throw new ImPaginationCursorError("IM pagination page limit reached");

  return {
    messages: page.message_list,
    checkpoint,
    hasMore: true,
    nextStartTime,
    nextMessageId,
    cursorHistory: [...job.syncCursorHistory, pageKey],
    cursorRequestVersion,
  };
}

async function persistMessages(
  job: ClaimedJob,
  page: FetchedImMessagePage,
): Promise<ImSessionSyncJobResult> {
  return db.transaction(async tx => {
    const [session] = await tx.select().from(lazadaImSessionsTable)
      .where(and(
        eq(lazadaImSessionsTable.id, job.id),
        eq(lazadaImSessionsTable.syncLeaseToken, job.leaseToken),
        sql`${lazadaImSessionsTable.syncLeaseUntil} > ${new Date()}`,
      ))
      .for("update");
    if (!session) return { kind: "failed" };

    let insertedMessageCount = 0;
    if (page.messages.length > 0) {
      const rows = page.messages.map(message => ({
        sessionId: session.id,
        lazadaMessageId: message.message_id,
        fromAccountType: message.from_account_type ?? null,
        toAccountType: message.to_account_type ?? null,
        content: message.content ?? null,
        templateId: message.template_id ?? null,
        messageType: message.type ?? null,
        providerStatus: message.status === undefined ? null : String(message.status),
        autoReply: message.auto_reply ?? null,
        // send_time units and provider-specific read semantics are not established here.
        sentAt: null,
        isRead: null,
      }));
      const inserted = await tx.insert(lazadaImMessagesTable).values(rows)
        .onConflictDoNothing({
          target: [lazadaImMessagesTable.sessionId, lazadaImMessagesTable.lazadaMessageId],
        })
        .returning({ id: lazadaImMessagesTable.id });
      insertedMessageCount = inserted.length;
    }

    const hasNewerRequest = session.syncRequestVersion !== page.cursorRequestVersion;
    const now = new Date();
    await tx.update(lazadaImSessionsTable).set({
      ...(page.checkpoint === null ? {} : { lastMessageId: page.checkpoint }),
      updatedAt: now,
      syncRequestedAt: page.hasMore || hasNewerRequest ? session.syncRequestedAt : null,
      syncStartAt: page.hasMore
        ? (session.syncStartAt ?? job.syncStartAt)
        : hasNewerRequest
          ? session.syncRequestedAt
          : null,
      syncCursorStartTime: page.hasMore ? page.nextStartTime : null,
      syncCursorMessageId: page.hasMore ? page.nextMessageId : null,
      syncCursorRequestVersion: page.hasMore ? page.cursorRequestVersion : null,
      syncCursorHistory: page.hasMore ? page.cursorHistory : [],
      syncNextAttemptAt: now,
      syncAttempts: 0,
      syncLeaseUntil: null,
      syncLeaseToken: null,
    }).where(eq(lazadaImSessionsTable.id, session.id));
    return {
      kind: "processed",
      userId: session.userId,
      sessionId: session.lazadaSessionId,
      insertedMessageCount,
    };
  });
}

async function recordSyncFailure(job: ClaimedJob, permanent: boolean): Promise<void> {
  await db.transaction(async tx => {
    const [session] = await tx.select().from(lazadaImSessionsTable)
      .where(and(
        eq(lazadaImSessionsTable.id, job.id),
        eq(lazadaImSessionsTable.syncLeaseToken, job.leaseToken),
      ))
      .for("update");
    if (!session) return;
    const activeRequestVersion = job.syncCursorRequestVersion ?? job.syncRequestVersion;
    const sameRequest = session.syncRequestVersion === activeRequestVersion;
    const nextAttempt = sameRequest ? session.syncAttempts + 1 : 0;
    const blocked = sameRequest && (permanent || nextAttempt >= MAX_SYNC_ATTEMPTS);
    const retryAt = new Date(Date.now() + (sameRequest && !blocked ? syncRetryDelayMs(nextAttempt) : 0));
    const restartForNewerRequest = permanent && !sameRequest;
    await tx.update(lazadaImSessionsTable).set({
      syncAttempts: nextAttempt,
      syncNextAttemptAt: retryAt,
      syncBlockedAt: blocked ? new Date() : null,
      ...(restartForNewerRequest ? {
        syncStartAt: session.syncStartAt ?? session.syncRequestedAt,
        syncCursorStartTime: null,
        syncCursorMessageId: null,
        syncCursorRequestVersion: null,
        syncCursorHistory: [],
      } : {}),
      syncLeaseUntil: null,
      syncLeaseToken: null,
    }).where(eq(lazadaImSessionsTable.id, session.id));
  });
}

export async function processNextImSessionSync(
  fetchMessages: ImMessagePageFetcher = getImMessages,
  options: ImSessionSyncOptions = {},
): Promise<ImSessionSyncJobResult> {
  const leaseMs = options.leaseMs ?? JOB_LEASE_MS;
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? Math.max(1, Math.floor(leaseMs / 3));
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 30 || leaseMs > JOB_LEASE_MS
    || !Number.isSafeInteger(heartbeatIntervalMs) || heartbeatIntervalMs < 1
    || heartbeatIntervalMs >= leaseMs)
    throw new Error("Invalid IM session sync lease settings");
  const job = await claimNextJob(leaseMs);
  if (!job) return { kind: "empty" };
  let leaseLost = false;
  let heartbeatWork: Promise<void> | null = null;
  const heartbeat = setInterval(() => {
    if (heartbeatWork) return;
    heartbeatWork = renewJobLease(job, leaseMs)
      .then(renewed => { if (!renewed) leaseLost = true; })
      .catch(() => { leaseLost = true; })
      .finally(() => { heartbeatWork = null; });
  }, heartbeatIntervalMs);
  heartbeat.unref?.();
  try {
    const page = await fetchMessagePage(job, fetchMessages);
    if (heartbeatWork) await heartbeatWork;
    if (leaseLost) return { kind: "failed" };
    clearInterval(heartbeat);
    if (heartbeatWork) await heartbeatWork;
    if (leaseLost) return { kind: "failed" };
    const sealContent = options.sealContent ?? ((userId: string, content: string) => {
      const config = imConfiguration();
      if (!config) throw new Error("IM message encryption is unavailable");
      return sealImMessageContent(content, config, userId);
    });
    const protectedPage: FetchedImMessagePage = {
      ...page,
      messages: page.messages.map(message => ({
        ...message,
        ...(message.content === undefined || message.content === null
          ? {} : { content: sealContent(job.userId, message.content) }),
      })),
    };
    return await persistMessages(job, protectedPage);
  } catch (error) {
    try { await recordSyncFailure(job, permanentSyncFailure(error)); } catch { /* lease expiry recovers it */ }
    logger.warn("Lazada IM session sync failed; durable queue state retained");
    return { kind: "failed" };
  } finally {
    clearInterval(heartbeat);
    if (heartbeatWork) await heartbeatWork;
  }
}

const MAX_JOBS_PER_DRAIN = 3;
let drainingImQueue = false;
let drainRequestedWhileBusy = false;
let queueRecoveryTimer: ReturnType<typeof setInterval> | null = null;
let activeDrainPromise: Promise<void> | null = null;
let stopQueueRecovery: (() => Promise<void>) | null = null;
let lastEventReceiptCleanupAt = 0;

function cleanupExpiredEventReceipts(): void {
  const now = Date.now();
  if (now - lastEventReceiptCleanupAt < EVENT_RECEIPT_CLEANUP_INTERVAL_MS) return;
  lastEventReceiptCleanupAt = now;
  void db.delete(lazadaImPushEventReceiptsTable)
    .where(lt(lazadaImPushEventReceiptsTable.createdAt, new Date(now - EVENT_RECEIPT_RETENTION_MS)))
    .catch(() => logger.warn("Lazada IM webhook receipt cleanup failed"));
}

export async function purgeExpiredImMessages(retentionDays: number, now = new Date()): Promise<number> {
  if (!Number.isSafeInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650
    || !Number.isFinite(now.getTime()))
    throw new Error("Invalid Lazada IM message retention policy");
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  let deletedCount = 0;
  for (let batch = 0; batch < MESSAGE_RETENTION_MAX_BATCHES_PER_RUN; batch += 1) {
    const expired = await db.select({ id: lazadaImMessagesTable.id })
      .from(lazadaImMessagesTable)
      .where(lt(lazadaImMessagesTable.createdAt, cutoff))
      .orderBy(asc(lazadaImMessagesTable.createdAt))
      .limit(MESSAGE_RETENTION_BATCH_SIZE);
    if (expired.length === 0) break;
    const deleted = await db.delete(lazadaImMessagesTable)
      .where(inArray(lazadaImMessagesTable.id, expired.map(({ id }) => id)))
      .returning({ id: lazadaImMessagesTable.id });
    deletedCount += deleted.length;
    if (deleted.length < MESSAGE_RETENTION_BATCH_SIZE) break;
  }
  return deletedCount;
}

export function startImMessageRetentionWorker(): () => void {
  const env = process.env;
  const retentionDays = configuredImMessageRetentionDays(env);
  if (env.NODE_ENV === "production" || env.LAZADA_MODE !== "testing" || retentionDays === null)
    return () => {};
  let running = false;
  const cleanup = async () => {
    if (running) return;
    running = true;
    try { await purgeExpiredImMessages(retentionDays); }
    catch { logger.warn("Lazada IM message retention cleanup failed"); }
    finally { running = false; }
  };
  void cleanup();
  const timer = setInterval(() => { void cleanup(); }, MESSAGE_RETENTION_CLEANUP_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

export function scheduleImSessionSyncDrain(
  fetchMessages: ImMessagePageFetcher = getImMessages,
  options: ImSessionSyncOptions = {},
): void {
  if (drainingImQueue) {
    drainRequestedWhileBusy = true;
    return;
  }
  drainingImQueue = true;
  let resolveDrain!: () => void;
  const drainPromise = new Promise<void>(resolve => { resolveDrain = resolve; });
  activeDrainPromise = drainPromise;
  setImmediate(() => {
    void (async () => {
      let continueDraining = false;
      try {
        for (let count = 0; count < MAX_JOBS_PER_DRAIN; count += 1) {
          const result = await processNextImSessionSync(fetchMessages, options);
          if (result.kind === "empty") break;
          if (count === MAX_JOBS_PER_DRAIN - 1) continueDraining = true;
        }
      } catch {
        logger.warn("Lazada IM session sync queue temporarily unavailable");
      } finally {
        drainingImQueue = false;
        const shouldContinue = continueDraining || drainRequestedWhileBusy;
        drainRequestedWhileBusy = false;
        if (shouldContinue) scheduleImSessionSyncDrain(fetchMessages, options);
      }
    })().catch(() => {
      logger.warn("Lazada IM session sync queue temporarily unavailable");
    }).finally(() => {
      if (activeDrainPromise === drainPromise) activeDrainPromise = null;
      resolveDrain();
    });
  });
}

async function waitForImSessionSyncDrain(): Promise<void> {
  while (activeDrainPromise) {
    await activeDrainPromise;
  }
}

/**
 * Recover queued work on process start and periodically inspect only the local
 * durable queue. Lazada IM is called only when a due queue item is claimed.
 */
export function startImSessionSyncWorker(
  fetchMessages: ImMessagePageFetcher = getImMessages,
  recoveryIntervalMs = QUEUE_RECOVERY_INTERVAL_MS,
  options: ImSessionSyncOptions = {},
): () => Promise<void> {
  if (!Number.isSafeInteger(recoveryIntervalMs) || recoveryIntervalMs < 1 || recoveryIntervalMs > 60_000)
    throw new Error("Invalid IM queue recovery interval");
  if (queueRecoveryTimer && stopQueueRecovery) return stopQueueRecovery;

  cleanupExpiredEventReceipts();
  scheduleImSessionSyncDrain(fetchMessages, options);
  const timer = setInterval(() => {
    cleanupExpiredEventReceipts();
    scheduleImSessionSyncDrain(fetchMessages, options);
  }, recoveryIntervalMs);
  timer.unref?.();
  queueRecoveryTimer = timer;
  const stop = async () => {
    clearInterval(timer);
    if (queueRecoveryTimer === timer) {
      queueRecoveryTimer = null;
      stopQueueRecovery = null;
    }
    await waitForImSessionSyncDrain();
  };
  stopQueueRecovery = stop;
  return stop;
}

// Keep an explicit closed verifier available for environments/tests that have
// not configured the documented IM credentials.
export const unavailableImPushVerifier: ImPushSignatureVerifier =
  async () => "unavailable";

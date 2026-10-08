import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { and, asc, eq, isNotNull, isNull, lte, lt, or, sql } from "drizzle-orm";
import {
  db,
  lazadaImMessagesTable,
  lazadaImSessionsTable,
} from "@workspace/db";
import { logger } from "../../lib/logger";
import { getImMessages } from "./im-chat";
import { resolveImSessionUpdateUserId } from "./im-connection";
import type { ImMessage, ImPageInput } from "./im-client";
import type { LazadaConfig } from "./security";

const MAX_BODY_BYTES = 16 * 1024;
const MAX_PAGES_PER_JOB = 10;
const IM_PAGE_SIZE = 20;
const JOB_LEASE_MS = 2 * 60 * 1000;
const sessionIdPattern = /^[A-Za-z0-9._:-]{1,256}$/;

export type ImSessionUpdateEvent = {
  message_type: 19;
  sync_type: "SESSION_UPDATE";
  seller_id: string;
  session_id: string;
  unread_count?: number;
  site_id?: string;
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
  | { kind: "queued"; userId: string; sessionId: string };

export type ImSessionSyncJobResult =
  | { kind: "empty" }
  | { kind: "failed" }
  | { kind: "processed"; userId: string; sessionId: string; insertedMessageCount: number };

type ClaimedJob = {
  id: string;
  userId: string;
  lazadaSessionId: string;
  syncRequestVersion: number;
  syncAttempts: number;
  leaseToken: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
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
  let value: unknown;
  try { value = JSON.parse(rawBody.toString("utf8")); }
  catch { return { kind: "invalid" }; }
  if (!isRecord(value)) return { kind: "invalid" };
  if (value.message_type !== 19) return { kind: "unsupported" };
  const sellerId = normalizeSellerId(value.seller_id);
  if (!sellerId || !Array.isArray(value.data) || value.data.length === 0)
    return { kind: "invalid" };
  const events: ImSessionUpdateEvent[] = [];
  for (const item of value.data) {
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
    || !sessionIdPattern.test(event.session_id) || !normalizeSellerId(event.seller_id))
    return { kind: "unmapped" };

  const userId = await resolveImSessionUpdateUserId(config, event);
  if (!userId) return { kind: "unmapped" };

  const now = new Date();
  await db.insert(lazadaImSessionsTable).values({
    userId,
    lazadaSessionId: event.session_id,
    unreadCount: event.unread_count ?? 0,
    syncRequestedAt: now,
    syncNextAttemptAt: now,
    syncAttempts: 0,
    syncRequestVersion: 1,
    ...(event.site_id === undefined ? {} : { siteId: event.site_id }),
  }).onConflictDoUpdate({
    target: [lazadaImSessionsTable.userId, lazadaImSessionsTable.lazadaSessionId],
    set: {
      updatedAt: now,
      syncRequestedAt: now,
      syncNextAttemptAt: now,
      syncAttempts: 0,
      syncRequestVersion: sql`${lazadaImSessionsTable.syncRequestVersion} + 1`,
      ...(event.unread_count === undefined ? {} : { unreadCount: event.unread_count }),
      ...(event.site_id === undefined ? {} : { siteId: event.site_id }),
    },
  });
  return { kind: "queued", userId, sessionId: event.session_id };
}

async function claimNextJob(): Promise<ClaimedJob | null> {
  const now = new Date();
  const leaseToken = randomUUID();
  const leaseUntil = new Date(now.getTime() + JOB_LEASE_MS);
  return db.transaction(async tx => {
    const [candidate] = await tx.select().from(lazadaImSessionsTable)
      .where(and(
        isNotNull(lazadaImSessionsTable.syncRequestedAt),
        lte(lazadaImSessionsTable.syncNextAttemptAt, now),
        or(isNull(lazadaImSessionsTable.syncLeaseUntil), lt(lazadaImSessionsTable.syncLeaseUntil, now)),
        eq(lazadaImSessionsTable.syncAttempts, 0),
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
        syncRequestVersion: lazadaImSessionsTable.syncRequestVersion,
        syncAttempts: lazadaImSessionsTable.syncAttempts,
      });
    return claimed ? { ...claimed, leaseToken } : null;
  });
}

async function fetchMessagePages(
  userId: string,
  sessionId: string,
  fetchMessages: ImMessagePageFetcher,
): Promise<{ messages: ImMessage[]; checkpoint: string | null }> {
  const messages: ImMessage[] = [];
  const seenCursors = new Set<string>();
  let input: ImPageInput = { startTime: String(Date.now()), pageSize: IM_PAGE_SIZE };
  let checkpoint: string | null = null;

  for (let pageNumber = 0; pageNumber < MAX_PAGES_PER_JOB; pageNumber += 1) {
    const page = await fetchMessages(userId, sessionId, input);
    messages.push(...page.message_list);
    checkpoint = page.last_message_id ?? checkpoint;
    if (!page.has_more) return { messages, checkpoint };

    const nextStartTime = page.next_start_time;
    const lastMessageId = page.last_message_id;
    if (!nextStartTime || !lastMessageId) throw new Error("IM pagination cursor missing");
    const cursorKey = `${nextStartTime}\u0000${lastMessageId}`;
    if (seenCursors.has(cursorKey)) throw new Error("IM pagination cursor repeated");
    seenCursors.add(cursorKey);
    input = { startTime: nextStartTime, pageSize: IM_PAGE_SIZE, cursor: lastMessageId };
  }
  throw new Error("IM pagination limit reached");
}

async function persistMessages(
  job: ClaimedJob,
  messages: ImMessage[],
  checkpoint: string | null,
): Promise<ImSessionSyncJobResult> {
  return db.transaction(async tx => {
    const [session] = await tx.select().from(lazadaImSessionsTable)
      .where(and(
        eq(lazadaImSessionsTable.id, job.id),
        eq(lazadaImSessionsTable.syncLeaseToken, job.leaseToken),
      ))
      .for("update");
    if (!session) return { kind: "failed" };

    let insertedMessageCount = 0;
    if (messages.length > 0) {
      const rows = messages.map(message => ({
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

    const sameRequest = session.syncRequestVersion === job.syncRequestVersion;
    await tx.update(lazadaImSessionsTable).set({
      ...(checkpoint === null ? {} : { lastMessageId: checkpoint }),
      updatedAt: new Date(),
      syncRequestedAt: sameRequest ? null : session.syncRequestedAt,
      syncNextAttemptAt: new Date(),
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

async function recordSyncFailure(job: ClaimedJob): Promise<void> {
  await db.transaction(async tx => {
    const [session] = await tx.select().from(lazadaImSessionsTable)
      .where(and(
        eq(lazadaImSessionsTable.id, job.id),
        eq(lazadaImSessionsTable.syncLeaseToken, job.leaseToken),
      ))
      .for("update");
    if (!session) return;
    const sameRequest = session.syncRequestVersion === job.syncRequestVersion;
    await tx.update(lazadaImSessionsTable).set({
      syncAttempts: sameRequest ? session.syncAttempts + 1 : 0,
      syncNextAttemptAt: new Date(),
      syncLeaseUntil: null,
      syncLeaseToken: null,
    }).where(eq(lazadaImSessionsTable.id, session.id));
  });
}

export async function processNextImSessionSync(
  fetchMessages: ImMessagePageFetcher = getImMessages,
): Promise<ImSessionSyncJobResult> {
  const job = await claimNextJob();
  if (!job) return { kind: "empty" };
  try {
    const { messages, checkpoint } = await fetchMessagePages(job.userId, job.lazadaSessionId, fetchMessages);
    return await persistMessages(job, messages, checkpoint);
  } catch {
    await recordSyncFailure(job);
    logger.warn("Lazada IM session sync failed; awaiting a new provider event");
    return { kind: "failed" };
  }
}

const MAX_JOBS_PER_DRAIN = 3;
let drainingImQueue = false;
let drainRequestedWhileBusy = false;

export function scheduleImSessionSyncDrain(
  fetchMessages: ImMessagePageFetcher = getImMessages,
): void {
  if (drainingImQueue) {
    drainRequestedWhileBusy = true;
    return;
  }
  drainingImQueue = true;
  setImmediate(() => {
    void (async () => {
      let continueDraining = false;
      try {
        for (let count = 0; count < MAX_JOBS_PER_DRAIN; count += 1) {
          const result = await processNextImSessionSync(fetchMessages);
          if (result.kind === "empty") break;
          if (count === MAX_JOBS_PER_DRAIN - 1) continueDraining = true;
        }
      } catch {
        logger.warn("Lazada IM session sync queue temporarily unavailable");
      } finally {
        drainingImQueue = false;
        const shouldContinue = continueDraining || drainRequestedWhileBusy;
        drainRequestedWhileBusy = false;
        if (shouldContinue) scheduleImSessionSyncDrain(fetchMessages);
      }
    })();
  });
}

// Keep an explicit closed verifier available for environments/tests that have
// not configured the documented IM credentials.
export const unavailableImPushVerifier: ImPushSignatureVerifier =
  async () => "unavailable";

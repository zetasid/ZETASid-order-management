import { eq, sql } from "drizzle-orm";
import { db, authLoginBucketsTable, lazadaOrderPushTable as events } from "@workspace/db";
import { digest } from "../auth/config";
import { automaticConnection } from "./automation-connection";
import { freshPush, type parsePush } from "./push-security";
import type { LazadaConfig } from "./security";

export async function pushQuota(ip: string) {
  const [row] = await db.insert(authLoginBucketsTable).values({
    key: digest("lpm-ip", ip), attempts: 1, resetAt: new Date(Date.now() + 60000),
  }).onConflictDoUpdate({ target: authLoginBucketsTable.key, set: {
    attempts: sql`case when ${authLoginBucketsTable.resetAt} <= now() then 1 else least(${authLoginBucketsTable.attempts} + 1, 1000000) end`,
    resetAt: sql`case when ${authLoginBucketsTable.resetAt} <= now() then now() + interval '1 minute' else ${authLoginBucketsTable.resetAt} end`,
  } }).returning();
  return row.attempts <= 120;
}
export async function receivePush(push: ReturnType<typeof parsePush>, config: LazadaConfig) {
  return db.transaction(async tx => {
    const [duplicate] = await tx.select({ id: events.id }).from(events).where(eq(events.eventHash, push.eventHash));
    if (duplicate) return true; // ACK known duplicates, including legitimate late retries.
    if (!freshPush(push.timestamp)) return false;
    const connection = await automaticConnection(tx, config);
    // Never touch the automation row here: reconciliation can hold its lock while
    // waiting for provider APIs. The durable receipt must not wait for that worker.
    await tx.insert(events).values({ eventHash: push.eventHash, userId: connection.userId,
      appFingerprint: config.fingerprint, orderId: push.orderId }).onConflictDoNothing();
    return true;
  });
}
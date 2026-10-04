import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db, lazadaOrderAutomationTable as states, ordersTable, lazadaOrderPushTable as events } from "@workspace/db";
import type { OrderTx } from "./order-store";
import { configuration } from "./security";
import { connectionStatus } from "./connection";

export const RECONCILE_INTERVAL_MS = 6 * 3600000;
export async function ensureAutomation(tx: OrderTx, userId: string, fingerprint: string) {
  const fresh = { userId, appFingerprint: fingerprint, lastPush: null, lastProcessedPush: null,
    lastSync: null, lastError: null, rangeStart: null, rangeEnd: null, reconciledThrough: null,
    offset: 0, nextReconcileAt: new Date() };
  await tx.insert(states).values(fresh).onConflictDoUpdate({
    target: states.userId, set: fresh, setWhere: sql`${states.appFingerprint} <> ${fingerprint}`,
  });
  const [state] = await tx.select().from(states).where(eq(states.userId, userId)).for("update");
  return state;
}
export async function pushStatus(userId: string) {
  const config = configuration();
  const [state] = config ? await db.select().from(states).where(and(eq(states.userId, userId),
    eq(states.appFingerprint, config.fingerprint))) : [];
  const [lastRead] = await db.select({ date: sql<Date | null>`max(${ordersTable.syncedAt})` }).from(ordersTable);
  const [pending] = config ? await db.select({
    count: sql<number>`(count(*) filter (where ${events.status} = 'pending'))::integer`,
    lastPush: sql<Date | null>`max(${events.receivedAt})`,
  }).from(events).where(and(eq(events.userId, userId), eq(events.appFingerprint, config.fingerprint)))
    : [{ count: 0, lastPush: null }];
  const date = (v: Date | string | null | undefined) => v ? new Date(v).toISOString() : null;
  const [pendingError] = config ? await db.select({ reason: events.lastError }).from(events).where(and(
    eq(events.userId, userId), eq(events.appFingerprint, config.fingerprint), eq(events.status, "pending"),
    isNotNull(events.lastError))).orderBy(desc(events.nextAttemptAt)).limit(1) : [];
  const lastSyncTimes = [state?.lastSync, lastRead?.date].filter(v => v != null).map(v => new Date(v).getTime());
  return {
    // Receipt alone could be a Console self-test, so don't claim real pushes are active until fetched successfully.
    active: !!state?.lastProcessedPush && (await connectionStatus(userId)).connected, lastPush: date(pending.lastPush),
    lastSync: lastSyncTimes.length ? new Date(Math.max(...lastSyncTimes)).toISOString() : null,
    lastError: pendingError?.reason ?? state?.lastError ?? null,
    pending: pending.count, reconciliationHours: 6,
    nextReconciliation: date(state?.nextReconcileAt), lastProcessedPush: date(state?.lastProcessedPush),
    webhookPath: "/api/lazada/orders/push",
  };
}
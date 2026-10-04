import { and, asc, eq, lte, sql } from "drizzle-orm";
import { db, lazadaOrderPushTable as events, lazadaOrderAutomationTable as states, syncLogsTable } from "@workspace/db";
import { logger } from "../../lib/logger";
import { configuration } from "./security";
import { createClient, LazadaError } from "./client";
import { mapOrder, providerId } from "./order-mapping";
import { storeOrder, type OrderTx } from "./order-store";
import { automaticConnection, automaticToken, guardAutomaticConnection } from "./automation-connection";
import { ensureAutomation, RECONCILE_INTERVAL_MS } from "./automation-state";

const safeError = (error: unknown) => error instanceof LazadaError ? error.reason : "api_unavailable";
async function lock(tx: OrderTx, fingerprint: string) {
  const result = await tx.execute<{ locked: boolean }>(sql`select pg_try_advisory_xact_lock(hashtext(${`lazada-orders:${fingerprint}`})) as locked`);
  return !!result.rows[0]?.locked;
}
export async function importNextPush() {
  const config = configuration();
  if (!config) return false;
  return db.transaction(async tx => {
    if (!await lock(tx, config.fingerprint)) return false;
    const [event] = await tx.select().from(events).where(and(eq(events.status, "pending"),
      eq(events.appFingerprint, config.fingerprint), lte(events.nextAttemptAt, new Date())))
      .orderBy(asc(events.receivedAt)).limit(1).for("update", { skipLocked: true });
    if (!event) return false;
    const now = new Date(), attempts = event.attempts + 1;
    try {
      const connection = await automaticConnection(tx, config, event.userId);
      await ensureAutomation(tx, event.userId, config.fingerprint);
      const client = createClient(config, fetch, AbortSignal.timeout(25_000)), token = automaticToken(connection, config);
      const raw = await client.getOrder(token, event.orderId);
      if (providerId(raw.order_id) !== event.orderId) throw new LazadaError("invalid_response");
      const { items } = await client.getOrderItems(token, event.orderId);
      const mapped = mapOrder(raw, items);
      await guardAutomaticConnection(tx, connection);
      // Savepoint lets a write failure roll back ALL items while durably scheduling the retry.
      await tx.transaction(async nested => {
        await storeOrder(nested, mapped, now);
        await nested.update(events).set({ status: "done", attempts, processedAt: now, lastError: null }).where(eq(events.id, event.id));
        await nested.update(states).set({ lastProcessedPush: now, lastSync: now, lastError: null }).where(eq(states.userId, event.userId));
      });
    } catch (error) {
      const reason = safeError(error);
      await tx.update(events).set({ attempts, lastError: reason,
        nextAttemptAt: new Date(Date.now() + Math.min(RECONCILE_INTERVAL_MS, 30000 * 2 ** Math.min(attempts - 1, 10))) })
        .where(eq(events.id, event.id));
      await tx.update(states).set({ lastError: reason }).where(eq(states.userId, event.userId));
    }
    return true;
  });
}

// Update-time windows recover missed status changes on old orders as well as newly created orders.
// Page cursors/windows are persistent and only advance after an atomic successful page.
export async function reconcileOrderPage() {
  const config = configuration();
  if (!config) return false;
  return db.transaction(async tx => {
    if (!await lock(tx, config.fingerprint)) return false;
    let connection;
    try { connection = await automaticConnection(tx, config); }
    catch { return false; }
    const state = await ensureAutomation(tx, connection.userId, config.fingerprint);
    if (state.nextReconcileAt > new Date()) return false;
    const now = new Date();
    const start = state.rangeStart ?? new Date((state.reconciledThrough?.getTime() ?? now.getTime() - 7 * 86400000) - 10 * 60000);
    const end = state.rangeEnd ?? now;
    try {
      const client = createClient(config, fetch, AbortSignal.timeout(55_000)), token = automaticToken(connection, config);
      const page = await client.getUpdatedOrders(token, { after: start.toISOString(), before: end.toISOString(), offset: state.offset, limit: 20 });
      if (page.orders.length > 20) throw new LazadaError("invalid_response");
      const seen = new Set<string>(), fetched: ReturnType<typeof mapOrder>[] = [];
      for (const raw of page.orders) {
        const id = providerId(raw.order_id);
        if (seen.has(id)) throw new LazadaError("invalid_response");
        seen.add(id);
        const { items } = await client.getOrderItems(token, id);
        fetched.push(mapOrder(raw, items));
      }
      await guardAutomaticConnection(tx, connection);
      const next = state.offset + page.orders.length;
      const more = page.orders.length === 20 && (page.countTotal === null || next < page.countTotal);
      await tx.transaction(async nested => {
        for (const order of fetched) await storeOrder(nested, order, now);
        await nested.update(states).set({ lastSync: now, lastError: null, offset: more ? next : 0,
          rangeStart: more ? start : null, rangeEnd: more ? end : null,
          reconciledThrough: more ? state.reconciledThrough : end,
          nextReconcileAt: new Date(Date.now() + (more ? 1000 : RECONCILE_INTERVAL_MS)) }).where(eq(states.userId, connection.userId));
        await nested.insert(syncLogsTable).values({ source: "lazada", status: "completed", recordsCount: page.orders.length,
          startedAt: now, finishedAt: new Date(), message: "READ-ONLY order reconciliation",
          metadata: { offset: state.offset, count: page.orders.length, more, appFingerprint: config.fingerprint } });
      });
    } catch (error) {
      await tx.update(states).set({ lastError: safeError(error), rangeStart: start, rangeEnd: end,
        nextReconcileAt: new Date(Date.now() + 5 * 60000) }).where(eq(states.userId, connection.userId));
    }
    return true;
  });
}

export function startOrderPushWorker() {
  if (process.env.NODE_ENV === "test") return () => {};
  let busy = false, stopped = false;
  const tick = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      for (let n = 0; n < 3 && !stopped; n++) if (!await importNextPush()) break;
      if (!stopped) await reconcileOrderPage();
    } catch { logger.warn("Lazada order import worker temporarily unavailable"); }
    finally { busy = false; }
  };
  const timer = setInterval(() => { void tick(); }, 5000);
  timer.unref();
  return () => { stopped = true; clearInterval(timer); };
}
import { and, eq, gt, sql } from "drizzle-orm";
import { db, ordersTable, orderItemsTable, lazadaConnectionsTable, syncLogsTable } from "@workspace/db";
import { configuration, unseal } from "./security";
import { activeSession } from "./connection";
import { createClient, LazadaError } from "./client";
import { mapOrder, providerId, type ProviderRecord } from "./order-mapping";

export type SyncInput = { createdAfter: string; createdBefore: string; offset: number };
const PAGE_SIZE = 20;
export const observedFields = (records: ProviderRecord[]) => [...new Set(records.flatMap(Object.keys))].sort();

export async function syncOrders(userId: string, sessionHash: string, input: SyncInput) {
  const config = configuration();
  if (!config) throw new LazadaError("authorization_failed");
  const after = new Date(input.createdAfter), before = new Date(input.createdBefore);
  if (!Number.isFinite(after.getTime()) || !Number.isFinite(before.getTime()) || after > before
    || before.getTime() - after.getTime() > 366 * 86400000) throw new LazadaError("invalid_response");
  const deadline = AbortSignal.timeout(60_000);
  return db.transaction(async tx => {
    // Serialize manual pages across operators/processes for this app; no background worker.
    const locked = await tx.execute<{ locked: boolean }>(sql`select pg_try_advisory_xact_lock(hashtext(${`lazada-orders:${config.fingerprint}`})) as locked`);
    if (!locked.rows[0]?.locked) throw new LazadaError("sync_busy");
    const [connection] = await tx.select().from(lazadaConnectionsTable).where(and(
      eq(lazadaConnectionsTable.userId, userId), eq(lazadaConnectionsTable.verified, "yes"),
      eq(lazadaConnectionsTable.appFingerprint, config.fingerprint), eq(lazadaConnectionsTable.country, config.country),
      gt(lazadaConnectionsTable.expiresAt, new Date()),
    ));
    if (!connection) throw new LazadaError("authorization_failed");
    let accessToken: unknown;
    try { accessToken = JSON.parse(unseal(connection.encryptedTokens, config, userId)).accessToken; }
    catch { throw new LazadaError("authorization_failed"); }
    if (typeof accessToken !== "string" || !accessToken) throw new LazadaError("authorization_failed");
    const client = createClient(config, fetch, deadline);
    // The UI's date range is used as an update-time window so older orders
    // whose Lazada status changed are refreshed too; new orders are updated
    // when first created and remain discoverable through this endpoint.
    const page = await client.getUpdatedOrders(accessToken, {
      after: input.createdAfter,
      before: input.createdBefore,
      offset: input.offset,
      limit: PAGE_SIZE,
    });
    if (page.orders.length > PAGE_SIZE) throw new LazadaError("invalid_response");
    const fetched = [];
    const allItems: ProviderRecord[] = [];
    const seenOrders = new Set<string>();
    for (const order of page.orders) {
      const id = providerId(order.order_id);
      if (seenOrders.has(id)) throw new LazadaError("invalid_response");
      seenOrders.add(id);
      const detail = await client.getOrderItems(accessToken, id);
      fetched.push(mapOrder(order, detail.items));
      allItems.push(...detail.items);
    }
    // Revoked sessions or replaced/expired credentials cannot install fetched order data.
    if (!await activeSession(tx, userId, sessionHash)) throw new LazadaError("authorization_failed");
    const [stillValid] = await tx.select({ userId: lazadaConnectionsTable.userId }).from(lazadaConnectionsTable).where(and(
      eq(lazadaConnectionsTable.userId, userId), eq(lazadaConnectionsTable.encryptedTokens, connection.encryptedTokens),
      eq(lazadaConnectionsTable.verified, "yes"), gt(lazadaConnectionsTable.expiresAt, new Date()),
    )).for("update");
    if (!stillValid) throw new LazadaError("authorization_failed");
    const syncedAt = new Date();
    for (const order of fetched) {
      const values = { ...order.header, syncedAt };
      const [saved] = await tx.insert(ordersTable).values(values).onConflictDoUpdate({
        target: ordersTable.lazadaOrderId, set: values,
      }).returning({ id: ordersTable.id });
      for (const item of order.items) {
        const [savedItem] = await tx.insert(orderItemsTable).values({ ...item, orderId: saved.id }).onConflictDoUpdate({
          target: orderItemsTable.lazadaOrderItemId, set: item, setWhere: eq(orderItemsTable.orderId, saved.id),
        }).returning({ id: orderItemsTable.id });
        if (!savedItem) throw new LazadaError("invalid_response");
      }
    }
    const next = input.offset + page.orders.length;
    const result = { ordersRead: page.orders.length, itemsRead: allItems.length, countTotal: page.countTotal,
      nextOffset: page.orders.length === PAGE_SIZE && (page.countTotal === null || next < page.countTotal) ? next : null,
      syncedAt: syncedAt.toISOString(), orderFields: observedFields(page.orders), itemFields: observedFields(allItems),
      digitalDetailPresent: allItems.filter(item => Object.hasOwn(item, "digital_delivery_info")).length,
      digitalDetailNonempty: allItems.filter(item => item.digital_delivery_info !== undefined
        && item.digital_delivery_info !== null && item.digital_delivery_info !== "").length };
    await tx.insert(syncLogsTable).values({ source: "lazada", status: "completed", recordsCount: page.orders.length,
      startedAt: syncedAt, finishedAt: syncedAt, message: "Manual READ-ONLY GetOrders(update_after)/GetOrderItems",
      metadata: { ...result, updatedAfter: input.createdAfter, updatedBefore: input.createdBefore, offset: input.offset } });
    return result;
  });
}
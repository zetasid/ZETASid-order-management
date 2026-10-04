import { eq, sql } from "drizzle-orm";
import { db, ordersTable, orderItemsTable } from "@workspace/db";
import { LazadaError } from "./client";
import { mapOrder } from "./order-mapping";

export type OrderTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Replays with identical provider data do not rewrite rows or provider timestamps.
// All writes, including multiple items and queue completion, share one transaction.
export async function storeOrder(tx: OrderTx, order: ReturnType<typeof mapOrder>, syncedAt = new Date()) {
  const values = { ...order.header, syncedAt };
  let [saved] = await tx.insert(ordersTable).values(values).onConflictDoUpdate({
    target: ordersTable.lazadaOrderId, set: values,
    setWhere: sql`${ordersTable.lazadaData} is distinct from ${JSON.stringify(values.lazadaData)}::jsonb
      or ${ordersTable.status} is distinct from ${values.status}::order_status
      or ${ordersTable.productName} is distinct from ${values.productName}`,
  }).returning({ id: ordersTable.id });
  if (!saved) [saved] = await tx.select({ id: ordersTable.id }).from(ordersTable).where(eq(ordersTable.lazadaOrderId, values.lazadaOrderId));
  if (!saved) throw new LazadaError("invalid_response");
  for (const item of order.items) {
    const [existing] = await tx.select({ orderId: orderItemsTable.orderId }).from(orderItemsTable)
      .where(eq(orderItemsTable.lazadaOrderItemId, item.lazadaOrderItemId));
    if (existing && existing.orderId !== saved.id) throw new LazadaError("invalid_response");
    await tx.insert(orderItemsTable).values({ ...item, orderId: saved.id }).onConflictDoUpdate({
      target: orderItemsTable.lazadaOrderItemId, set: item,
      setWhere: sql`${orderItemsTable.orderId} = ${saved.id}::uuid and
        (${orderItemsTable.lazadaData} is distinct from ${JSON.stringify(item.lazadaData)}::jsonb
        or ${orderItemsTable.status} is distinct from ${item.status}::order_status
        or ${orderItemsTable.productName} is distinct from ${item.productName})`,
    });
  }
}
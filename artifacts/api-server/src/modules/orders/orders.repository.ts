import { desc, eq, sql } from "drizzle-orm";
import { db, ordersTable } from "@workspace/db";

// Preserve the existing read-only API contract while canonical storage uses Lazada IDs.
const orderView = {
  id: ordersTable.id,
  marketplaceOrderId: ordersTable.lazadaOrderId,
  productName: ordersTable.productName,
  buyerName: ordersTable.buyerName,
  amount: ordersTable.amount,
  status: ordersTable.status,
  createdAt: ordersTable.createdAt,
  updatedAt: ordersTable.updatedAt,
};

export function listOrders(limit = 100) {
  return db.select(orderView).from(ordersTable).orderBy(desc(ordersTable.createdAt)).limit(limit);
}

export async function findOrder(id: string) {
  const [order] = await db.select(orderView).from(ordersTable).where(eq(ordersTable.id, id)).limit(1);
  return order;
}

export async function getOrderSummary() {
  const [summary] = await db.select({
    totalOrders: sql<number>`count(*)::integer`,
    pendingOrders: sql<number>`count(*) filter (where status = 'pending')::integer`,
    completedOrders: sql<number>`count(*) filter (where status = 'completed')::integer`,
    cancelledOrders: sql<number>`count(*) filter (where status = 'cancelled')::integer`,
    totalRevenue: sql<number>`coalesce(sum(amount) filter (where status = 'completed'), 0)::float8`,
  }).from(ordersTable);
  return summary;
}
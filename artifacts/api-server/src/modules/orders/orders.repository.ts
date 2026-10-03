import { desc, eq, sql } from "drizzle-orm";
import { db, ordersTable } from "@workspace/db";

export function listOrders(limit = 100) {
  return db.select().from(ordersTable).orderBy(desc(ordersTable.createdAt)).limit(limit);
}

export async function findOrder(id: string) {
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, id)).limit(1);
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
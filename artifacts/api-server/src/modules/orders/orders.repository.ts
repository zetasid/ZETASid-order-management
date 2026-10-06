import { and, asc, desc, eq, inArray, ilike, or, sql, type SQL } from "drizzle-orm";
import { db, orderItemsTable, ordersTable, type Order } from "@workspace/db";
import { presentOrder } from "./orders.presenter";
import { orderReadStatuses } from "./order-status-query";

type OrderFilters = { search?: string; status?: Order["status"] };
const itemOrdering = [asc(orderItemsTable.createdAt), asc(orderItemsTable.id)];

export async function listOrders(filters: OrderFilters = {}, limit = 100) {
  const conditions: SQL[] = [];
  if (filters.status) {
    const read = orderReadStatuses();
    conditions.push(inArray(ordersTable.id, db.select({ id: read.id }).from(read).where(eq(read.status, filters.status))));
  }
  const term = filters.search?.trim();
  if (term) {
    // Treat percent/underscore/backslash as literal user input, not LIKE wildcards.
    const pattern = `%${term.replace(/[\\%_]/g, "\\$&")}%`;
    conditions.push(or(
      ilike(ordersTable.lazadaOrderId, pattern),
      ilike(ordersTable.productName, pattern),
      // Uncorrelated subquery avoids depending on the relational query's table alias.
      inArray(ordersTable.id, db.select({ id: orderItemsTable.orderId }).from(orderItemsTable).where(
        ilike(orderItemsTable.productName, pattern),
      )),
    )!);
  }
  const orders = await db.query.ordersTable.findMany({
    where: and(...conditions),
    orderBy: [desc(ordersTable.createdAt), desc(ordersTable.id)],
    limit,
    with: { items: { orderBy: itemOrdering } },
  });
  return orders.map(presentOrder);
}

export async function findOrder(id: string) {
  const order = await db.query.ordersTable.findFirst({
    where: eq(ordersTable.id, id),
    with: { items: { orderBy: itemOrdering } },
  });
  return order ? presentOrder(order) : undefined;
}

export async function getOrderSummary() {
  const read = orderReadStatuses();
  const [summary] = await db.select({
    totalOrders: sql<number>`count(*)::integer`,
    pendingOrders: sql<number>`count(*) filter (where ${read.status} = 'pending')::integer`,
    processingOrders: sql<number>`count(*) filter (where ${read.status} = 'processing')::integer`,
    completedOrders: sql<number>`count(*) filter (where ${read.status} = 'completed')::integer`,
    cancelledOrders: sql<number>`count(*) filter (where ${read.status} = 'cancelled')::integer`,
    unmappedOrders: sql<number>`count(*) filter (where ${read.status} is null)::integer`,
    totalRevenue: sql<number>`coalesce(sum(${read.amount}) filter (where ${read.paymentConfirmed}
      and ${read.status} in ('processing', 'completed')), 0)::float8`,
  }).from(read);
  return summary;
}
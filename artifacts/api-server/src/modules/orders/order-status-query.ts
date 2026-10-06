import { eq, sql, type SQL } from "drizzle-orm";
import { db, orderItemsTable, ordersTable } from "@workspace/db";
import { LAZADA_STATUS_GROUPS } from "./order-status";

function itemGroup(value: SQL) {
  return sql<string | null>`case ${sql.join(Object.entries(LAZADA_STATUS_GROUPS).map(([group, statuses]) =>
    sql`when ${value} in (${sql.join(statuses.map(status => sql`${status}`), sql`, `)}) then ${group}`), sql` `)} else null end`;
}
function aggregateGroup(value: SQL) {
  return sql<string | null>`case
    when count(*) = 0 or count(*) filter (where ${value} is null) > 0 then null
    when count(*) filter (where ${value} <> 'cancelled') = 0 then 'cancelled'
    when count(*) filter (where ${value} not in ('completed', 'cancelled')) = 0 then 'completed'
    when count(*) filter (where ${value} = 'processing') > 0
      or (count(*) filter (where ${value} = 'completed') > 0 and count(*) filter (where ${value} = 'pending') > 0) then 'processing'
    else 'pending' end`;
}

export function orderReadStatuses() {
  const items = db.select({
    orderId: orderItemsTable.orderId,
    group: aggregateGroup(itemGroup(sql`${orderItemsTable.lazadaData}->>'status'`)).as("item_status_group"),
  }).from(orderItemsTable).groupBy(orderItemsTable.orderId).as("lazada_item_groups");
  const header = sql`(select ${aggregateGroup(itemGroup(sql`s.value`))}
    from jsonb_array_elements_text(case when jsonb_typeof(${ordersTable.lazadaData}->'statuses') = 'array'
      then ${ordersTable.lazadaData}->'statuses' else '[]'::jsonb end) as s(value))`;
  const paymentConfirmed = sql`case when ${ordersTable.lazadaData} is null then false else
    (select count(*) > 0 and count(*) filter (where
      ${itemGroup(sql`s.value`)} is null or ${itemGroup(sql`s.value`)} not in ('processing', 'completed')) = 0
     from jsonb_array_elements_text(case when jsonb_typeof(${ordersTable.lazadaData}->'statuses') = 'array'
       then ${ordersTable.lazadaData}->'statuses' else '[]'::jsonb end) as s(value))
     and not exists (
       select 1 from order_items as payment_item
       where payment_item.order_id = ${ordersTable.id}
         and (${itemGroup(sql`payment_item.lazada_data->>'status'`)} is null
           or ${itemGroup(sql`payment_item.lazada_data->>'status'`)} = 'cancelled'
           or payment_item.lazada_data->>'status' = 'unpaid')
     )
    end`;
  // Standalone joined query avoids Drizzle relational parent-alias substitution issues.
  return db.select({
    id: ordersTable.id,
    amount: ordersTable.amount,
    paymentConfirmed: sql<boolean>`${paymentConfirmed}`.as("payment_confirmed"),
    status: sql<string | null>`case when ${ordersTable.lazadaData} is null then ${ordersTable.status}::text
      when ${items.orderId} is not null then ${items.group} else ${header} end`.as("effective_status"),
  }).from(ordersTable).leftJoin(items, eq(items.orderId, ordersTable.id)).as("order_read_statuses");
}
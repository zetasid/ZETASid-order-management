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
    when count(*) filter (where ${value} = 'cancelled') > 0 then 'cancelled'
    when count(*) filter (where ${value} = 'completed') = count(*) then 'completed'
    when count(*) filter (where ${value} = 'processing') > 0
      or (count(*) filter (where ${value} = 'completed') > 0 and count(*) filter (where ${value} = 'pending') > 0) then 'processing'
    else 'pending' end`;
}

export function orderReadStatuses() {
  const paymentTime = sql`${orderItemsTable.lazadaData}->>'payment_time'`;
  const validPaymentTime = sql`case when ${paymentTime} ~ '^[0-9]{13}$'
    then (${paymentTime})::numeric between 1000000000000 and floor(extract(epoch from now()) * 1000)
    else false end`;
  const stagePayStatus = sql`coalesce(${orderItemsTable.lazadaData}->>'stage_pay_status', '')`;
  const items = db.select({
    orderId: orderItemsTable.orderId,
    group: aggregateGroup(itemGroup(sql`${orderItemsTable.lazadaData}->>'status'`)).as("item_status_group"),
    paymentConfirmed: sql<boolean>`count(*) > 0 and bool_and(${validPaymentTime} and ${stagePayStatus} = '')`
      .as("payment_confirmed"),
  }).from(orderItemsTable).groupBy(orderItemsTable.orderId).as("lazada_item_groups");
  const headerStatuses = sql`case when jsonb_typeof(${ordersTable.lazadaData}->'statuses') = 'array'
    then ${ordersTable.lazadaData}->'statuses' else '[]'::jsonb end`;
  const headers = db.select({
    orderId: ordersTable.id,
    group: sql<string | null>`(select ${aggregateGroup(itemGroup(sql`s.value`))}
      from jsonb_array_elements_text(${headerStatuses}) as s(value))`.as("header_status_group"),
    count: sql<number>`(select count(*) from jsonb_array_elements_text(${headerStatuses}) as s(value))`
      .as("header_status_count"),
  }).from(ordersTable).as("lazada_header_groups");
  const mergedWorkflowGroup = sql`case
    when ${items.group} is null then null
    when ${headers.count} = 0 or ${headers.group} = 'pending' then ${items.group}
    when ${headers.group} is null then null
    when ${items.group} = 'cancelled' or ${headers.group} = 'cancelled' then 'cancelled'
    when ${items.group} = 'processing' or ${headers.group} = 'processing' then 'processing'
    when ${items.group} = ${headers.group} then ${items.group}
    else 'processing' end`;
  // Standalone joined query avoids Drizzle relational parent-alias substitution issues.
  return db.select({
    id: ordersTable.id,
    amount: ordersTable.amount,
    paymentConfirmed: sql<boolean>`${ordersTable.lazadaData} is not null and coalesce(${items.paymentConfirmed}, false)`
      .as("payment_confirmed"),
    status: sql<string | null>`case when ${ordersTable.lazadaData} is null then ${ordersTable.status}::text
      when ${items.orderId} is not null then ${mergedWorkflowGroup} else ${headers.group} end`.as("effective_status"),
  }).from(ordersTable).leftJoin(items, eq(items.orderId, ordersTable.id))
    .leftJoin(headers, eq(headers.orderId, ordersTable.id)).as("order_read_statuses");
}
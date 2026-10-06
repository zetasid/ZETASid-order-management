import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const require = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const { build } = require("esbuild");
const { Pool } = createRequire(new URL("../lib/db/package.json", import.meta.url))("pg");
assert.ok(process.env.DATABASE_URL, "DATABASE_URL must point to a migrated test database");
const setupPool = new Pool({ connectionString: process.env.DATABASE_URL });
const schema = `status_test_${randomUUID().replaceAll("-", "")}`;
assert.match(schema, /^status_test_[a-f0-9]+$/);
const dir = await mkdtemp(`${tmpdir()}/zetas-status-readonly-`);
await build({ stdin: { contents: `
  export { pool } from './lib/db/src/index.ts';
  export { mapOrder } from './artifacts/api-server/src/modules/lazada/order-mapping.ts';
  export { groupStatuses, itemStatusGroup, readOrderPaymentStatus, readOrderStatus } from './artifacts/api-server/src/modules/orders/order-status.ts';
  export { listOrders, findOrder, getOrderSummary } from './artifacts/api-server/src/modules/orders/orders.repository.ts';
  `, resolveDir: process.cwd(), loader: "ts" }, outfile: `${dir}/test.mjs`, bundle: true, platform: "node", format: "esm",
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" }, logLevel: "silent" });
const mod = await import(pathToFileURL(`${dir}/test.mjs`));

test.before(async () => {
  const client = await setupPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA "${schema}"`);
    // Copy migrated structure only, never application/customer rows.
    await client.query(`CREATE TABLE "${schema}".orders (LIKE public.orders INCLUDING ALL)`);
    await client.query(`CREATE TABLE "${schema}".order_items (LIKE public.order_items INCLUDING ALL)`);
    await client.query(`ALTER TABLE "${schema}".order_items ADD FOREIGN KEY (order_id)
      REFERENCES "${schema}".orders(id) ON DELETE RESTRICT`);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  // This bundled test owns this pool; no API server or environment is modified.
  // No public fallback: missing fixture tables must fail instead of reading live rows.
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set("options", `-c search_path=${schema}`);
  mod.pool.options.connectionString = url.toString();
  assert.equal((await mod.pool.query("SELECT current_schema() AS name")).rows[0].name, schema);
});

test.afterEach(async () => {
  await setupPool.query(`TRUNCATE TABLE "${schema}".order_items, "${schema}".orders`);
});

test.after(async () => {
  try {
    await mod.pool.end();
    await setupPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  } finally {
    await setupPool.end();
    await rm(dir, { recursive: true, force: true });
  }
});

// Minimal, synthetic status-only fixtures. No buyer, Digital Detail, credentials,
// real provider IDs or API calls; UUID namespaces only prevent fixture collisions.
async function seedStatuses(statuses, storedStatus = "pending") {
  const namespace = randomUUID();
  const time = "2026-01-01T00:00:00.000Z";
  const client = await mod.pool.connect();
  const fixtures = [];
  try {
    await client.query("BEGIN");
    for (const [index, rawStatus] of statuses.entries()) {
      const externalId = `synthetic-status-${namespace}-${index}`;
      const { rows: [order] } = await client.query(`INSERT INTO orders
        (lazada_order_id, product_name, status, lazada_data, synced_at, created_at, updated_at)
        VALUES ($1, 'SYNTHETIC STATUS FIXTURE', $2, $3, $4, $4, $4) RETURNING id`,
      [externalId, storedStatus, { statuses: ["pending"] }, time]);
      await client.query(`INSERT INTO order_items
        (order_id, lazada_order_item_id, product_name, status, lazada_data, created_at, updated_at)
        VALUES ($1, $2, 'SYNTHETIC STATUS FIXTURE', $3, $4, $5, $5)`,
      [order.id, `${externalId}-item`, storedStatus, { status: rawStatus }, time]);
      fixtures.push({ id: order.id, rawStatus });
    }
    await client.query("COMMIT");
    return fixtures;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function seedPaymentOrders(cases) {
  const namespace = randomUUID();
  const time = "2026-01-01T00:00:00.000Z";
  const client = await mod.pool.connect();
  const fixtures = [];
  try {
    await client.query("BEGIN");
    for (const [index, fixture] of cases.entries()) {
      const externalId = `synthetic-payment-${namespace}-${index}`;
      const data = fixture.statuses === null ? { statuses: null } : { statuses: fixture.statuses };
      const { rows: [order] } = await client.query(`INSERT INTO orders
        (lazada_order_id, product_name, amount, status, lazada_data, synced_at, created_at, updated_at)
        VALUES ($1, 'SYNTHETIC PAYMENT FIXTURE', $2, 'pending', $3, $4, $4, $4) RETURNING id`,
      [externalId, fixture.amount, data, time]);
      await client.query(`INSERT INTO order_items
        (order_id, lazada_order_item_id, product_name, status, lazada_data, created_at, updated_at)
        VALUES ($1, $2, 'SYNTHETIC PAYMENT FIXTURE', 'pending', $3, $4, $4)`,
      [order.id, `${externalId}-item`, { status: fixture.itemStatus === undefined ? "pending" : fixture.itemStatus }, time]);
      fixtures.push({ id: order.id, ...fixture });
    }
    await client.query("COMMIT");
    return fixtures;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

test("Documented raw Lazada status groups; unknown statuses are not guessed", () => {
  for (const [raw, group] of [
    ["confirmed", "completed"], ["delivered", "completed"], ["canceled", "cancelled"], ["cancelled", "cancelled"],
    ["unpaid", "pending"], ["pending", "pending"], ["packed", "processing"], ["repacked", "processing"],
    ["ready_to_ship_pending", "processing"], ["ready_to_ship", "processing"], ["shipped", "processing"],
    ["topack", "processing"], ["to_pack", "processing"], ["toship", "processing"], ["to_ship", "processing"], ["shipping", "processing"],
  ]) assert.equal(mod.itemStatusGroup(raw), group);
  assert.equal(mod.itemStatusGroup("unknown_future_status"), null);
  assert.equal(mod.itemStatusGroup("Confirmed"), null, "No case normalization invents provider values");
  assert.equal(mod.groupStatuses([]), null);
  assert.equal(mod.groupStatuses(["confirmed", "canceled"]), "completed");
  assert.equal(mod.groupStatuses(["confirmed", "pending"]), "processing");
  assert.equal(mod.groupStatuses(["pending", "canceled"]), "pending");
  assert.equal(mod.groupStatuses(["confirmed", "unknown_future_status"]), null);
  assert.equal(mod.readOrderStatus({ status: "pending", lazadaData: { statuses: ["confirmed"] },
    items: [{ lazadaData: { status: "pending" } }] }), "pending", "GetOrderItems overrides inconsistent header");
  const packedWithPendingHeader = { status: "pending", lazadaData: { statuses: ["pending"] },
    items: [{ lazadaData: { status: "packed" } }] };
  assert.equal(mod.readOrderStatus(packedWithPendingHeader), "processing", "A newer item workflow status overrides a stale pending header");
  assert.equal(mod.readOrderPaymentStatus(packedWithPendingHeader), "pending", "Payment remains separately unconfirmed");
  assert.equal(mod.readOrderStatus({ status: "pending", lazadaData: null, items: [] }), "pending", "Legacy data retained");
  for (const [statuses, expected] of [
    [["unpaid"], "unpaid"], [["pending"], "pending"], [["canceled"], "cancelled"],
    [["confirmed"], "confirmed"], [["delivered"], "confirmed"], [["future_status"], "unknown"],
    [[], "unknown"], [null, "unknown"],
  ]) assert.equal(mod.readOrderPaymentStatus({ lazadaData: statuses === null ? { statuses: null } : { statuses } }), expected);
  const time = "2026-09-20 10:00:00 +0700";
  const mapped = mod.mapOrder({ order_id: "123", order_number: "123", statuses: [], items_count: 1,
    price: "0.00", created_at: time, updated_at: time }, [{
    order_id: "123", order_item_id: "456", name: "Unit test only", status: "confirmed", created_at: time, updated_at: time,
  }]);
  assert.equal(mapped.header.status, "completed", "Future manual ingestion also uses the actual item status, not an empty header array");
});

const fingerprintSql = `SELECT
  (SELECT md5(string_agg(to_jsonb(o)::text,'' ORDER BY o.id)) FROM orders o WHERE synced_at IS NOT NULL) AS orders_hash,
  (SELECT md5(string_agg(to_jsonb(i)::text,'' ORDER BY i.id)) FROM order_items i
    JOIN orders o ON o.id=i.order_id WHERE o.synced_at IS NOT NULL) AS items_hash`;

test("28 self-seeded synthetic orders: 11 confirmed -> Selesai, 17 canceled -> Dibatalkan; no stored row changes", async () => {
  await seedStatuses([...Array(11).fill("confirmed"), ...Array(17).fill("canceled")]);
  const before = (await mod.pool.query(fingerprintSql)).rows[0];
  const source = (await mod.pool.query(`SELECT o.id, i.lazada_data->>'status' AS raw_status FROM orders o
    JOIN order_items i ON i.order_id=o.id WHERE o.synced_at IS NOT NULL ORDER BY o.id`)).rows;
  assert.equal(source.length, 28);
  assert.equal(source.filter(row => row.raw_status === "confirmed").length, 11);
  assert.equal(source.filter(row => row.raw_status === "canceled").length, 17);
  const ids = new Set(source.map(row => row.id));
  for (const [group, expected] of [["pending", 0], ["processing", 0], ["completed", 11], ["cancelled", 17]]) {
    const orders = (await mod.listOrders({ status: group })).filter(order => ids.has(order.id));
    assert.equal(orders.length, expected);
    assert.ok(orders.every(order => order.status === group && order.items.every(item => item.status === group)));
  }
  for (const row of source) {
    const detail = await mod.findOrder(row.id);
    assert.equal(detail.status, row.raw_status === "confirmed" ? "completed" : "cancelled");
    assert.equal(detail.items.length, 1);
    assert.equal(detail.items[0].sourceStatus, row.raw_status);
    assert.equal(detail.buyerName, null);
    assert.equal(detail.items[0].digitalDetail, null);
  }
  const summary = await mod.getOrderSummary();
  assert.equal(summary.totalOrders, 28);
  assert.equal(summary.completedOrders, 11);
  assert.equal(summary.cancelledOrders, 17);
  assert.equal(summary.pendingOrders, 0);
  assert.equal(summary.processingOrders, 0);
  assert.equal(summary.unmappedOrders, 0);
  assert.equal(summary.totalOrders, summary.pendingOrders + summary.processingOrders
    + summary.completedOrders + summary.cancelledOrders + summary.unmappedOrders);
  assert.deepEqual((await mod.pool.query(fingerprintSql)).rows[0], before, "All stored business rows, including timestamps, remain unchanged");
});

test("Revenue requires confirmed header payment and an eligible non-pending order status", async () => {
  const before = (await mod.getOrderSummary()).totalRevenue;
  const fixtures = await seedPaymentOrders([
    { statuses: ["unpaid"], expected: "unpaid", amount: 110 },
    { statuses: ["pending"], expected: "pending", amount: 220 },
    { statuses: ["pending"], expected: "pending", itemStatus: "packed", amount: 225 },
    { statuses: ["canceled"], expected: "cancelled", amount: 330 },
    { statuses: ["confirmed"], expected: "confirmed", itemStatus: "packed", amount: 440 },
    { statuses: ["unknown_future_status"], expected: "unknown", itemStatus: "packed", amount: 550 },
    { statuses: null, expected: "unknown", itemStatus: "packed", amount: 660 },
    { statuses: ["confirmed"], expected: "confirmed", itemStatus: "unpaid", amount: 770 },
    { statuses: ["confirmed"], expected: "confirmed", itemStatus: "future_item_status", amount: 880 },
    { statuses: ["confirmed"], expected: "confirmed", itemStatus: null, amount: 990 },
    { statuses: ["confirmed"], expected: "confirmed", itemStatus: "pending", amount: 1010 },
    { statuses: ["confirmed"], expected: "confirmed", itemStatus: "canceled", amount: 1110 },
  ]);
  for (const fixture of fixtures) {
    assert.equal((await mod.findOrder(fixture.id)).paymentStatus, fixture.expected);
  }
  const after = await mod.getOrderSummary();
  const pendingPaid = fixtures.find(fixture => fixture.amount === 1010);
  assert.ok(pendingPaid);
  const pendingPaidOrder = await mod.findOrder(pendingPaid.id);
  assert.equal(pendingPaidOrder.paymentStatus, "confirmed", "Header payment remains separate from item workflow");
  assert.equal(pendingPaidOrder.status, "pending");
  assert.equal(after.totalRevenue, before + 440, "Pending and cancelled order states are excluded from revenue");
});

test("Self-seeded pending/unpaid -> Belum Dibayar and process statuses -> Diproses; no stored row changes", async () => {
  const pending = ["pending", "unpaid"];
  const processing = ["repacked", "packed", "ready_to_ship_pending", "ready_to_ship", "shipped", "topack", "to_pack", "toship", "to_ship", "shipping"];
  // Stored enums/header deliberately disagree with item API statuses, proving
  // the read projection uses original item statuses rather than stale labels.
  const fixtures = await seedStatuses([...pending, ...processing], "cancelled");
  const before = (await mod.pool.query(fingerprintSql)).rows[0];
  for (const [group, rawStatuses] of [["pending", pending], ["processing", processing]]) {
    const orders = await mod.listOrders({ status: group });
    assert.equal(orders.length, rawStatuses.length);
    assert.deepEqual(new Set(orders.map(order => order.id)),
      new Set(fixtures.filter(fixture => rawStatuses.includes(fixture.rawStatus)).map(fixture => fixture.id)));
    assert.ok(orders.every(order => order.status === group && order.items.length === 1
      && order.items[0].status === group));
  }
  for (const fixture of fixtures) {
    const detail = await mod.findOrder(fixture.id);
    const group = pending.includes(fixture.rawStatus) ? "pending" : "processing";
    assert.equal(detail.status, group);
    assert.equal(detail.items[0].status, group);
    assert.equal(detail.items[0].sourceStatus, fixture.rawStatus);
    assert.equal(detail.buyerName, null);
    assert.equal(detail.items[0].digitalDetail, null);
  }
  assert.equal((await mod.listOrders({ status: "completed" })).length, 0);
  assert.equal((await mod.listOrders({ status: "cancelled" })).length, 0);
  const summary = await mod.getOrderSummary();
  assert.equal(summary.totalOrders, fixtures.length);
  assert.equal(summary.pendingOrders, pending.length);
  assert.equal(summary.processingOrders, processing.length);
  assert.equal(summary.completedOrders, 0);
  assert.equal(summary.cancelledOrders, 0);
  assert.equal(summary.unmappedOrders, 0);
  assert.equal(summary.totalOrders, summary.pendingOrders + summary.processingOrders
    + summary.completedOrders + summary.cancelledOrders + summary.unmappedOrders);
  assert.deepEqual((await mod.pool.query(fingerprintSql)).rows[0], before,
    "Read-only list, detail and summary must preserve all stored rows and timestamps");
});
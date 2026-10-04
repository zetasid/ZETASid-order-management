import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const require = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const { build } = require("esbuild");
const dir = await mkdtemp(`${tmpdir()}/zetas-status-readonly-`);
await build({ stdin: { contents: `
  export { pool } from './lib/db/src/index.ts';
  export { mapOrder } from './artifacts/api-server/src/modules/lazada/order-mapping.ts';
  export { groupStatuses, itemStatusGroup, readOrderStatus } from './artifacts/api-server/src/modules/orders/order-status.ts';
  export { listOrders, findOrder, getOrderSummary } from './artifacts/api-server/src/modules/orders/orders.repository.ts';
  `, resolveDir: process.cwd(), loader: "ts" }, outfile: `${dir}/test.mjs`, bundle: true, platform: "node", format: "esm",
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" }, logLevel: "silent" });
const mod = await import(pathToFileURL(`${dir}/test.mjs`));
test.after(async () => { await mod.pool.end(); await rm(dir, { recursive: true, force: true }); });

test("Documented raw Lazada status groups; unknown statuses are not guessed", () => {
  for (const [raw, group] of [
    ["confirmed", "completed"], ["delivered", "completed"], ["canceled", "cancelled"],
    ["unpaid", "pending"], ["pending", "pending"], ["packed", "processing"], ["repacked", "processing"],
    ["ready_to_ship_pending", "processing"], ["ready_to_ship", "processing"], ["shipped", "processing"],
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
  assert.equal(mod.readOrderStatus({ status: "pending", lazadaData: null, items: [] }), "pending", "Legacy data retained");
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

test("28 synchronized real orders: 11 confirmed -> Selesai, 17 canceled -> Dibatalkan; no stored row changes", async () => {
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
  const detail = await mod.findOrder(source.find(row => row.raw_status === "confirmed").id);
  assert.equal(detail.status, "completed");
  assert.equal(detail.items[0].sourceStatus, "confirmed");
  const summary = await mod.getOrderSummary();
  assert.ok(summary.completedOrders >= 11 && summary.cancelledOrders >= 17);
  assert.equal(summary.totalOrders, summary.pendingOrders + summary.processingOrders
    + summary.completedOrders + summary.cancelledOrders + summary.unmappedOrders);
  assert.deepEqual((await mod.pool.query(fingerprintSql)).rows[0], before, "All stored business rows, including timestamps, remain unchanged");
});
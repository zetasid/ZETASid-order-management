import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

const require = createRequire(new URL("../lib/db/package.json", import.meta.url));
const { Pool } = require("pg");
const api = process.env.TEST_API_URL || `${process.env.TEST_BASE_URL || "http://localhost:80"}/api`;

async function get(path, status = 200) {
  const response = await fetch(`${api}${path}`);
  assert.equal(response.status, status, path);
  return response.json();
}

test("Pencarian seluruh PostgreSQL, filter status, dan semua Digital Detail item", async () => {
  assert.ok(process.env.DATABASE_URL);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const ids = [];
  const prefix = `phase3-${randomUUID()}`;
  try {
    const oldId = randomUUID();
    ids.push(oldId);
    await pool.query(
      "INSERT INTO orders (id, lazada_order_id, product_name, created_at) VALUES ($1, $2, $3, $4)",
      [oldId, `older-match-${prefix}`, "Header produk lama", "2020-01-01T00:00:00Z"],
    );
    const expectedJson = { tujuan: "CONTOH-DIGITAL-001", catatan: "Baris satu\nBaris dua ✓" };
    const jsonItemId = randomUUID();
    const stringItemId = randomUUID();
    const emptyItemId = randomUUID();
    for (const [id, name, digital] of [
      [jsonItemId, `ProdukUnik ${prefix}`, expectedJson],
      [stringItemId, `100% _ literal ${prefix}`, "CONTOH-TARGET-002"],
      [emptyItemId, "Produk tanpa detail", null],
    ]) {
      await pool.query(
        "INSERT INTO order_items (id, lazada_order_item_id, order_id, product_name, digital_detail) VALUES ($1, $2, $3, $4, $5)",
        [id, `item-${id}`, oldId, name, digital === null ? null : JSON.stringify(digital)],
      );
    }
    for (const status of ["processing", "completed", "cancelled"]) {
      const id = randomUUID();
      ids.push(id);
      await pool.query(
        "INSERT INTO orders (id, lazada_order_id, status) VALUES ($1, $2, $3)",
        [id, `${status}-${prefix}`, status],
      );
    }
    const newer = await pool.query(
      `INSERT INTO orders (lazada_order_id)
       SELECT $1 || '-' || n::text FROM generate_series(1, 105) AS n RETURNING id`,
      [`distractor-${prefix}`],
    );
    ids.push(...newer.rows.map((row) => row.id));
    const firstPage = await get("/orders");
    assert.equal(firstPage.length, 100);
    assert.ok(!firstPage.some((order) => order.id === oldId));
    const byId = await get(`/orders?search=${encodeURIComponent(`older-match-${prefix}`)}`);
    assert.equal(byId.length, 1, "Search must run before limiting the newest 100 orders");
    assert.equal(byId[0].id, oldId);
    const byProduct = await get(`/orders?search=${encodeURIComponent(`produkunik ${prefix}`)}`);
    assert.equal(byProduct.length, 1);
    assert.equal(byProduct[0].id, oldId);
    const literal = await get(`/orders?search=${encodeURIComponent(`100% _ literal ${prefix}`)}`);
    assert.equal(literal.length, 1, "LIKE wildcard characters must be literal user input");
    for (const status of ["pending", "processing", "completed", "cancelled"]) {
      const search = status === "pending" ? `older-match-${prefix}` : `${status}-${prefix}`;
      const matches = await get(`/orders?search=${encodeURIComponent(search)}&status=${status}`);
      assert.equal(matches.length, 1);
      assert.equal(matches[0].status, status);
    }
    assert.deepEqual(await get(`/orders?search=${encodeURIComponent(`older-match-${prefix}`)}&status=processing`), []);
    assert.deepEqual(await get(`/orders?search=${encodeURIComponent(`not-found-${prefix}`)}`), []);
    const detail = await get(`/orders/${oldId}`);
    assert.equal(detail.lazadaOrderId, `older-match-${prefix}`);
    assert.equal(detail.items.length, 3);
    assert.equal(detail.items.find((item) => item.id === jsonItemId).digitalDetail, JSON.stringify(expectedJson, null, 2));
    assert.equal(detail.items.find((item) => item.id === stringItemId).digitalDetail, "CONTOH-TARGET-002");
    assert.equal(detail.items.find((item) => item.id === emptyItemId).digitalDetail, null);
    assert.ok(detail.productName.includes(`ProdukUnik ${prefix}`));
    assert.ok(!Number.isNaN(Date.parse(detail.updatedAt)));
    assert.equal(typeof (await get("/orders?status=invalid", 400)).error, "string");
    await get(`/orders?search=${"x".repeat(201)}`, 400);
    await get("/orders?search=a&search=b", 400);
    const summary = await get("/dashboard/summary");
    assert.ok(summary.processingOrders >= 1);
    assert.ok(summary.recentOrders.every((order) => Array.isArray(order.items)));
  } finally {
    if (ids.length) {
      await pool.query("DELETE FROM order_items WHERE order_id = ANY($1::uuid[])", [ids]);
      await pool.query("DELETE FROM orders WHERE id = ANY($1::uuid[])", [ids]);
    }
    await pool.end();
  }
});
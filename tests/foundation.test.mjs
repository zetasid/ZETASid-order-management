import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const base = process.env.TEST_BASE_URL || "http://localhost:80";
const api = process.env.TEST_API_URL || `${base}/api`;
const run = promisify(execFile);

async function json(path, status = 200) {
  const response = await fetch(`${api}${path}`);
  assert.equal(response.status, status, path);
  return response.json();
}

test("API PostgreSQL, ringkasan dan daftar pesanan", async () => {
  assert.equal((await json("/healthz")).status, "ok");
  const summary = await json("/dashboard/summary");
  assert.equal(summary.totalOrders, summary.pendingOrders + summary.completedOrders + summary.cancelledOrders);
  assert.ok(Number.isInteger(summary.totalRevenue) && summary.totalRevenue >= 0);
  assert.ok(Array.isArray(summary.recentOrders));
  assert.ok(Array.isArray(await json("/orders")));
});

test("ID tidak valid, pesanan tidak ada, dan endpoint tidak ada", async () => {
  assert.equal(typeof (await json("/orders/not-a-uuid", 400)).error, "string");
  assert.equal(typeof (await json(`/orders/${randomUUID()}`, 404)).error, "string");
  assert.equal(typeof (await json("/unknown", 404)).error, "string");
});

test("Semua halaman dasar dan aset PWA tersedia", async () => {
  for (const path of ["/login", "/dashboard", "/orders", `/orders/${randomUUID()}`, "/settings"]) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /id="root"/);
  }
  const manifest = await (await fetch(`${base}/manifest.webmanifest`)).json();
  assert.equal(manifest.name, "ZETAS.id");
  assert.equal(manifest.display, "standalone");
  for (const icon of manifest.icons) {
    assert.equal((await fetch(`${base}${icon.src}`)).status, 200);
  }
  const worker = await fetch(`${base}/service-worker.js`);
  assert.equal(worker.status, 200);
  assert.match(await worker.text(), /url\.pathname\.startsWith\("\/api"\)/);
});

test("Detail pesanan nyata dan migration ulang mempertahankan data", async () => {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required for the integration test");
  const require = createRequire(new URL("../lib/db/package.json", import.meta.url));
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const id = randomUUID();
  try {
    await pool.query(
      "INSERT INTO orders (id, lazada_order_id, product_name, amount) VALUES ($1, $2, $3, $4)",
      [id, `test-${id}`, "Fixture tes fondasi", 25000],
    );
    const before = await json(`/orders/${id}`);
    assert.equal(before.id, id);
    assert.equal(before.amount, 25000);
    assert.equal(before.status, "pending");
    assert.ok(!Number.isNaN(Date.parse(before.createdAt)));
    assert.ok((await json("/orders")).some((order) => order.id === id));
    await run("pnpm", ["--filter", "@workspace/db", "run", "migrate"], {
      cwd: new URL("..", import.meta.url),
    });
    const after = await json(`/orders/${id}`);
    assert.deepEqual(after, before);
  } finally {
    // Remove only this test's generated fixture, never existing application data.
    await pool.query("DELETE FROM orders WHERE id = $1", [id]);
    await pool.end();
  }
});
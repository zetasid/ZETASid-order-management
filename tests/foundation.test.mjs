import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import { promisify } from "node:util";
import { createAuthorizedFixture } from "./auth-helper.mjs";
const auth = await createAuthorizedFixture();
after(() => auth.cleanup());

const base = process.env.TEST_BASE_URL || "http://localhost:80";
const api = process.env.TEST_API_URL || `${base}/api`;
const run = promisify(execFile);

function requestText(rawUrl, headers = {}) {
  const url = new URL(rawUrl);
  const get = url.protocol === "https:" ? httpsGet : httpGet;
  return new Promise((resolve, reject) => {
    const request = get(url, { agent: false, headers }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.once("error", reject);
      response.once("aborted", () => reject(new Error("HTTP response aborted")));
      response.once("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({
          status: response.statusCode,
          text: async () => text,
          json: async () => JSON.parse(text),
        });
      });
    });
    request.once("error", reject);
  });
}

async function json(path, status = 200) {
  const response = await requestText(`${api}${path}`, { Cookie: auth.cookie });
  assert.equal(response.status, status, path);
  return response.json();
}

test("API PostgreSQL, ringkasan dan daftar pesanan", async () => {
  assert.equal((await json("/healthz")).status, "ok");
  const summary = await json("/dashboard/summary");
  assert.equal(summary.totalOrders, summary.pendingOrders + summary.processingOrders + summary.completedOrders + summary.cancelledOrders);
  assert.ok(Number.isFinite(summary.totalRevenue) && summary.totalRevenue >= 0);
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
    const response = await requestText(`${base}${path}`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /id="root"/);
  }
  const manifest = await (await requestText(`${base}/manifest.webmanifest`)).json();
  assert.equal(manifest.name, "ZETAS.id");
  assert.equal(manifest.display, "standalone");
  for (const icon of manifest.icons) {
    assert.equal((await requestText(`${base}${icon.src}`)).status, 200);
  }
  const worker = await requestText(`${base}/service-worker.js`);
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
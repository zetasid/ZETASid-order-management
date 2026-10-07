import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomBytes, randomInt } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { createAuthorizedFixture } from "./auth-helper.mjs";

const require = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const { build } = require("esbuild");
const dir = await mkdtemp(`${tmpdir()}/zetas-readonly-orders-`);
test.after(async () => { await rm(dir, { recursive: true, force: true }); });
await build({ entryPoints: {
  security: "artifacts/api-server/src/modules/lazada/security.ts",
  "order-mapping": "artifacts/api-server/src/modules/lazada/order-mapping.ts",
  "orders.presenter": "artifacts/api-server/src/modules/orders/orders.presenter.ts",
  "product-image": "artifacts/zetas-id/src/lib/product-image.ts",
},
  outdir: dir, bundle: true, platform: "node", format: "esm", outExtension: { ".js": ".mjs" }, logLevel: "silent" });
const security = await import(pathToFileURL(`${dir}/security.mjs`));
const { mapOrder, providerId, providerMoney, providerDate, httpsProductImageUrl } = await import(pathToFileURL(`${dir}/order-mapping.mjs`));
const { presentOrder } = await import(pathToFileURL(`${dir}/orders.presenter.mjs`));
const { safeProductImageUrl } = await import(pathToFileURL(`${dir}/product-image.mjs`));

const sample = { order_id: "1234", order_number: "1234", statuses: ["pending"], price: "1000.25", items_count: 1,
  created_at: "2026-09-20 10:00:00 +0700", updated_at: "2026-09-20 10:01:00 +0700" };
const sampleItem = { order_id: "1234", order_item_id: "5678", name: "Dummy product", status: "pending",
  variation: "Dummy variation", sku: "dummy", item_price: 1000.25, currency: "IDR",
  payment_time: "1750000000000", stage_pay_status: null,
  product_main_image: "https://images.example.invalid/dummy-product.webp",
  created_at: sample.created_at, updated_at: sample.updated_at, extra_attributes: "{\"destination\":\"not Digital Detail\"}" };

test("Read-only mapping preserves decimals, source status, SKU/variation and does not invent Digital Detail", () => {
  const mapped = mapOrder(sample, [sampleItem]);
  assert.equal(mapped.header.amount, 1000.25);
  assert.equal(mapped.items[0].digitalDetail, null);
  assert.equal(mapped.items[0].lazadaData.extra_attributes, sampleItem.extra_attributes);
  assert.equal(mapped.items[0].lazadaData.variation, sampleItem.variation);
  assert.equal(mapped.items[0].lazadaData.product_main_image, sampleItem.product_main_image);
  assert.equal(mapped.items[0].lazadaData.payment_time, sampleItem.payment_time);
  assert.equal(mapped.items[0].lazadaData.stage_pay_status, null);
  const raw = "{\"account\":\"dummy-only\"}";
  assert.equal(mapOrder(sample, [{ ...sampleItem, digital_delivery_info: raw }]).items[0].digitalDetail, raw);
  assert.equal(mapOrder({ ...sample, price: null }, [sampleItem]).header.amount, null);
  assert.throws(() => providerId(Number.MAX_SAFE_INTEGER + 1));
  assert.throws(() => providerDate("2026-09-20 10:00:00"), "Timezone cannot be guessed");
  assert.equal(providerMoney("0.25"), 0.25);
  assert.throws(() => mapOrder(sample, [{ ...sampleItem, order_id: "999" }]));
  assert.throws(() => mapOrder({ ...sample, items_count: 2 }, [sampleItem]));
});

test("Product image mapping and frontend validation accept HTTPS only", () => {
  const valid = "https://images.example.invalid/product.webp";
  assert.equal(httpsProductImageUrl(valid), valid);
  assert.equal(safeProductImageUrl(valid), valid);
  for (const value of ["http://images.example.invalid/product.webp", "//images.example.invalid/product.webp",
    "javascript:alert(1)", "data:image/png;base64,AA==", "not a URL", "", null, 42,
    "https://user:password@images.example.invalid/product.webp"]) {
    assert.equal(httpsProductImageUrl(value), null, `mapper rejects ${String(value)}`);
    assert.equal(safeProductImageUrl(value), null, `frontend rejects ${String(value)}`);
  }
});

test("Order presenter exposes the mapped image field to the frontend", () => {
  const image = "https://images.example.invalid/dummy-product.webp";
  const date = new Date("2026-09-20T03:00:00.000Z");
  const presented = presentOrder({
    id: "00000000-0000-4000-8000-000000000001",
    lazadaOrderId: "1234",
    marketplaceOrderId: "1234",
    productName: "Dummy product",
    buyerName: null,
    amount: 1000,
    lazadaData: null,
    syncedAt: null,
    status: "pending",
    createdAt: date,
    updatedAt: date,
    items: [{
      id: "00000000-0000-4000-8000-000000000002",
      lazadaOrderItemId: "5678",
      orderId: "00000000-0000-4000-8000-000000000001",
      productName: "Dummy product",
      digitalDetail: null,
      lazadaData: { product_main_image: image },
      status: "pending",
      createdAt: date,
      updatedAt: date,
    }],
  });
  assert.equal(presented.items[0].productMainImage, image);
  assert.equal(presentOrder({
    id: "00000000-0000-4000-8000-000000000001",
    lazadaOrderId: "1234",
    marketplaceOrderId: "1234",
    productName: "Dummy product",
    buyerName: null,
    amount: 1000,
    lazadaData: null,
    syncedAt: null,
    status: "pending",
    createdAt: date,
    updatedAt: date,
    items: [{
      id: "00000000-0000-4000-8000-000000000002",
      lazadaOrderItemId: "5678",
      orderId: "00000000-0000-4000-8000-000000000001",
      productName: "Dummy product",
      digitalDetail: null,
      lazadaData: { product_main_image: "http://images.example.invalid/unsafe.webp" },
      status: "pending",
      createdAt: date,
      updatedAt: date,
    }],
  }).items[0].productMainImage, null);
});

test("Manual READ-ONLY sync — API/CSRF, PostgreSQL, idempotency, atomic failures and no provider writes", async t => {
  const server = http.createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const callsFile = `${dir}/calls`, controlFile = `${dir}/control`, statusFile = `${dir}/status`;
  await writeFile(callsFile, ""); await writeFile(controlFile, "");
  const id = String(9000000000000000 + randomInt(1000000));
  await writeFile(statusFile, JSON.stringify({
    [id]: { headerStatus: "pending", paymentTime: "1750000000000", stagePayStatus: null },
    [String(Number(id) + 1)]: { headerStatus: "pending", paymentTime: "1750000000000", stagePayStatus: null },
  }));
  const env = { LAZADA_MODE: "testing", LAZADA_COUNTRY: "id", LAZADA_APP_KEY: "999000",
    LAZADA_APP_SECRET: "dummy-orders-secret-not-real", LAZADA_IM_APP_KEY: "999001",
    LAZADA_IM_APP_SECRET: "dummy-im-orders-secret-not-real", LAZADA_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    LAZADA_REDIRECT_URI: "https://testing.example.invalid/api/lazada/oauth/callback", APP_ORIGIN: "https://testing.example.invalid" };
  const child = spawn(process.execPath, ["--import", "./tests/fixtures/lazada-provider.mjs", "artifacts/api-server/dist/index.mjs"], {
    env: { ...process.env, ...env, PORT: String(port), NODE_ENV: "test",
      LAZADA_TEST_ORDER_ID: id, LAZADA_TEST_CALLS_FILE: callsFile, LAZADA_TEST_CONTROL_FILE: controlFile,
      LAZADA_TEST_STATUS_FILE: statusFile },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = ""; child.stdout.on("data", data => { logs += data; }); child.stderr.on("data", data => { logs += data; });
  const exit = once(child, "exit");
  const base = `http://127.0.0.1:${port}/api`;
  const f = await createAuthorizedFixture();
  const syncTimes = [];
  const payload = { createdAfter: "2026-09-01T00:00:00.000Z", createdBefore: "2026-10-01T00:00:00.000Z", offset: 0 };
  const request = (path, method = "GET", extra = {}, authorized = true, data = payload) => fetch(`${base}${path}`, {
    method, headers: { "X-Forwarded-Proto": "https", "Content-Type": "application/json",
      ...(authorized ? { Cookie: f.cookie, Origin: env.APP_ORIGIN, "X-CSRF-Token": f.csrfToken } : {}), ...extra },
    ...(method === "POST" ? { body: JSON.stringify(data) } : {}),
  });
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) { try { if ((await request("/healthz")).ok) { ready = true; break; } } catch {} await delay(50); }
    assert.ok(ready);
    const config = security.configuration(env);
    await f.pool.query(`INSERT INTO lazada_connections
      (user_id, encrypted_tokens, app_fingerprint, country, expires_at, refresh_expires_at, verified, checked_at)
      VALUES ($1,$2,$3,'id',now()+interval '1 hour',now()+interval '2 hour','yes',now())`, [
      f.id, security.seal(JSON.stringify({ accessToken: "test-only-orders-token" }), config, f.id), config.fingerprint,
    ]);
    const imConfig = security.imConfiguration(env);
    await f.pool.query(`INSERT INTO lazada_im_connections
      (user_id, encrypted_tokens, app_fingerprint, country, expires_at, refresh_expires_at)
      VALUES ($1,$2,$3,'id',now()+interval '1 hour',now()+interval '2 hour')`, [
      f.id, security.seal(JSON.stringify({ accessToken: "test-only-im-access-token" }), imConfig, f.id), imConfig.fingerprint,
    ]);
    await t.test("Authentication, CSRF and invalid date range reject before provider traffic", async () => {
      assert.equal((await request("/lazada/orders/sync", "POST", {}, false)).status, 401);
      assert.equal((await request("/lazada/orders/sync", "POST", { "X-CSRF-Token": "invalid" })).status, 403);
      assert.equal((await request("/lazada/orders/sync", "POST", {}, true, { ...payload, createdBefore: payload.createdAfter, createdAfter: payload.createdBefore })).status, 400);
      assert.equal(await readFile(callsFile, "utf8"), "");
    });
    await t.test("Actual database persistence, repeat sync, raw fields and absent Digital Detail", async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await request("/lazada/orders/sync", "POST"); assert.equal(response.status, 200);
        const result = await response.json(); assert.equal(result.ordersRead, 2); assert.equal(result.itemsRead, 2);
        syncTimes.push(result.syncedAt);
        assert.equal(result.nextOffset, null); assert.equal(result.digitalDetailPresent, 1);
      }
      const rows = (await f.pool.query("SELECT * FROM orders WHERE lazada_order_id = ANY($1)", [[id, String(Number(id) + 1)]])).rows;
      assert.equal(rows.length, 2); assert.equal(Number(rows[0].amount), 12000.25);
      const order = await (await request(`/orders/${rows.find(row => row.lazada_order_id === id).id}`)).json();
      assert.equal(order.items[0].sku, "test-only-sku"); assert.equal(order.items[0].itemPrice, "12000.25");
      assert.equal(order.items[0].productMainImage, "https://images.example.invalid/dummy-product.webp");
      assert.equal(order.items[0].sourceStatus, "pending"); assert.ok(order.items[0].digitalDetail.includes("test_only_destination"));
      const second = await (await request(`/orders/${rows.find(row => row.lazada_order_id !== id).id}`)).json();
      assert.match(second.sourceCreatedAt, /^2020-01-15/, "An older order is included by its recent Lazada update timestamp");
      assert.equal(second.items[0].digitalDetail, null); assert.equal(second.items[0].digitalDetailSource, null);
      assert.equal((await f.pool.query("SELECT count(*)::int AS n FROM order_items WHERE order_id=ANY($1)", [rows.map(row => row.id)])).rows[0].n, 2);
      await writeFile(controlFile, "orders-progressed");
      const progressResponse = await request("/lazada/orders/sync", "POST"); assert.equal(progressResponse.status, 200);
      const progressResult = await progressResponse.json(); syncTimes.push(progressResult.syncedAt);
      assert.equal(progressResult.ordersRead, 2);
      const progressed = await (await request(`/orders/${rows.find(row => row.lazada_order_id !== id).id}`)).json();
      assert.equal(progressed.status, "processing", "Manual update-time sync refreshes an existing pending order to packed");
      assert.equal(progressed.paymentStatus, "confirmed", "Payment time remains authoritative while workflow status advances");
      assert.equal(progressed.items[0].status, "processing");
      assert.equal(progressed.items[0].sourceStatus, "packed");
    });
    await t.test("Fractional completed amounts remain valid in the existing dashboard contract", async () => {
      const before = await (await request("/dashboard/summary")).json();
      await writeFile(controlFile, "orders-delivered");
      const response = await request("/lazada/orders/sync", "POST"); assert.equal(response.status, 200);
      syncTimes.push((await response.json()).syncedAt);
      const summary = await request("/dashboard/summary"); assert.equal(summary.status, 200);
      assert.equal((await summary.json()).totalRevenue, before.totalRevenue + 12000.25,
        "The already-progressed paid order is in the baseline; delivery completes the remaining order");
    });
    await t.test("Bad items and permission failures leave previous order data unchanged", async () => {
      const before = (await f.pool.query("SELECT lazada_data,synced_at FROM orders WHERE lazada_order_id=$1", [id])).rows[0];
      for (const mode of ["orders-broken", "orders-permission"]) {
        await writeFile(controlFile, mode);
        const response = await request("/lazada/orders/sync", "POST"); assert.equal(response.status, 502);
        assert.ok(!(await response.text()).includes("test-only-orders-token"));
        assert.deepEqual((await f.pool.query("SELECT lazada_data,synced_at FROM orders WHERE lazada_order_id=$1", [id])).rows[0], before);
      }
    });
    const calls = (await readFile(callsFile, "utf8")).trim().split("\n").map(JSON.parse);
    const orderCalls = calls.filter(call => call.path === "/orders/get");
    assert.ok(orderCalls.length > 0);
    assert.ok(calls.filter(call => ["/orders/get", "/order/items/get"].includes(call.path))
      .every(call => call.tokenSource === "seller"), "Order client must not use the separate IM token");
    assert.ok(orderCalls.every(call => call.updateAfter === payload.createdAfter
      && call.updateBefore === payload.createdBefore && call.createdAfter === null),
    "Manual sync uses Lazada's update_after/update_before filters instead of created_after");
    assert.ok(calls.length >= 6);
    assert.ok(calls.every(call => call.method === "GET" && ["/orders/get", "/order/items/get"].includes(call.path)));
    for (const secret of [env.LAZADA_APP_SECRET, env.LAZADA_IM_APP_SECRET, env.LAZADA_TOKEN_ENCRYPTION_KEY,
      "test-only-orders-token", "test-only-im-access-token"])
      assert.ok(!logs.includes(secret), "No credential or token values in logs");
  } finally {
    child.kill("SIGTERM"); await exit;
    await f.pool.query("DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE lazada_order_id=ANY($1))", [[id, String(Number(id) + 1)]]);
    await f.pool.query("DELETE FROM orders WHERE lazada_order_id=ANY($1)", [[id, String(Number(id) + 1)]]);
    await f.pool.query("DELETE FROM sync_logs WHERE source='lazada' AND started_at=ANY($1::timestamptz[])", [syncTimes]);
    await f.cleanup();
  }
});
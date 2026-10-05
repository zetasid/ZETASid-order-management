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
import { createAuthorizedFixture } from "./auth-helper.mjs";

const require = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const { build } = require("esbuild");
const dir = await mkdtemp(`${tmpdir()}/zetas-manual-digital-delivery-`);
const env = {
  LAZADA_MODE: "testing",
  LAZADA_COUNTRY: "id",
  LAZADA_APP_KEY: "999000",
  LAZADA_APP_SECRET: "dummy-delivery-secret-not-real",
  LAZADA_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  LAZADA_REDIRECT_URI: "https://testing.example.invalid/api/lazada/oauth/callback",
  APP_ORIGIN: "https://testing.example.invalid",
};

test.after(async () => { await rm(dir, { recursive: true, force: true }); });

test("Manual DeliverDigital is authenticated, item-checked, retryable on failure and idempotent under concurrency", async t => {
  await build({ entryPoints: ["artifacts/api-server/src/modules/lazada/security.ts"],
    outdir: dir, bundle: true, platform: "node", format: "esm", outExtension: { ".js": ".mjs" }, logLevel: "silent" });
  const security = await import(new URL(`file://${dir}/security.mjs`));
  const server = http.createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));

  const callsFile = `${dir}/calls`, controlFile = `${dir}/control`;
  await writeFile(callsFile, "");
  await writeFile(controlFile, "");
  const child = spawn(process.execPath, ["--import", "./tests/fixtures/lazada-provider.mjs", "artifacts/api-server/dist/index.mjs"], {
    env: { ...process.env, ...env, PORT: String(port), NODE_ENV: "test",
      LAZADA_TEST_CALLS_FILE: callsFile, LAZADA_TEST_CONTROL_FILE: controlFile },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", data => { logs += data; });
  child.stderr.on("data", data => { logs += data; });
  const exit = once(child, "exit");
  const base = `http://127.0.0.1:${port}/api`;
  const f = await createAuthorizedFixture();
  const orderIds = [];
  const providerOrderIds = [];
  const request = (path, method = "GET", authorized = true, csrf = f.csrfToken) => fetch(`${base}${path}`, {
    method,
    headers: {
      "X-Forwarded-Proto": "https",
      "Content-Type": "application/json",
      ...(authorized ? { Cookie: f.cookie, Origin: env.APP_ORIGIN, "X-CSRF-Token": csrf } : {}),
    },
    ...(method === "POST" ? { body: "{}" } : {}),
  });
  const deliveryCalls = async () => (await readFile(callsFile, "utf8")).trim().split("\n")
    .filter(Boolean).map(JSON.parse).filter(call => call.path === "/order/digital/delivered");
  const deliver = id => request(`/orders/${id}/deliver-digital`, "POST");

  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { if ((await request("/healthz")).ok) { ready = true; break; } } catch {}
      await delay(50);
    }
    assert.ok(ready, "API server starts for the integration test");

    const config = security.configuration(env);
    await f.pool.query(`INSERT INTO lazada_connections
      (user_id, encrypted_tokens, app_fingerprint, country, expires_at, refresh_expires_at, verified, checked_at)
      VALUES ($1,$2,$3,'id',now()+interval '1 hour',now()+interval '2 hour','yes',now())`, [
      f.id, security.seal(JSON.stringify({ accessToken: "test-only-delivery-token" }), config, f.id), config.fingerprint,
    ]);

    const baseOrderNumber = 9_000_000_000_000_000n + BigInt(randomInt(100_000));
    const ids = {};
    for (const name of ["success", "nonpending", "concurrent", "failed", "retry", "lost-response"]) {
      const externalId = String(baseOrderNumber + BigInt(providerOrderIds.length * 10));
      const itemExternalId = String(BigInt(externalId) + 100n);
      const rawStatus = name === "nonpending" ? "delivered" : "pending";
      const storedStatus = rawStatus === "delivered" ? "completed" : "pending";
      const { rows: [order] } = await f.pool.query(`INSERT INTO orders
        (lazada_order_id, product_name, status, lazada_data, synced_at)
        VALUES ($1, 'SYNTHETIC DIGITAL FIXTURE', $2, $3, now()) RETURNING id`,
      [externalId, storedStatus, { order_number: externalId, statuses: [rawStatus], items_count: 1, price: "12000.25" }]);
      await f.pool.query(`INSERT INTO order_items
        (order_id, lazada_order_item_id, product_name, status, lazada_data)
        VALUES ($1, $2, 'SYNTHETIC DIGITAL ITEM', $3, $4)`,
      [order.id, itemExternalId, storedStatus, { order_id: externalId, order_item_id: itemExternalId,
        name: "SYNTHETIC DIGITAL ITEM", status: rawStatus }]);
      ids[name] = order.id;
      orderIds.push(order.id);
      providerOrderIds.push(externalId);
    }

    await t.test("Unauthenticated and invalid-CSRF requests cannot call DeliverDigital", async () => {
      assert.equal((await request(`/orders/${ids.success}/deliver-digital`, "POST", false)).status, 401);
      assert.equal((await request(`/orders/${ids.success}/deliver-digital`, "POST", true, "invalid")).status, 403);
      assert.equal((await deliveryCalls()).length, 0);
    });

    await t.test("Only a pending order can be delivered", async () => {
      const before = (await deliveryCalls()).length;
      const response = await deliver(ids.nonpending);
      assert.equal(response.status, 409);
      assert.equal((await response.json()).error, "Hanya pesanan berstatus Menunggu yang dapat dikirim.");
      assert.equal((await deliveryCalls()).length, before);
      const order = await (await request(`/orders/${ids.nonpending}`)).json();
      assert.equal(order.status, "completed");
    });

    await t.test("Confirmed manual success updates status and is not sent again", async () => {
      const response = await deliver(ids.success);
      assert.equal(response.status, 200);
      const order = await response.json();
      assert.equal(order.status, "completed");
      assert.deepEqual(order.lazadaStatuses, ["delivered"]);
      assert.equal(order.items[0].status, "completed");
      assert.equal(order.items[0].sourceStatus, "delivered");
      assert.equal((await deliveryCalls()).length, 1);
      assert.equal((await deliver(ids.success)).status, 409);
      assert.equal((await deliveryCalls()).length, 1);
    });

    await t.test("Concurrent submits make only one provider call", async () => {
      await writeFile(controlFile, "delivery-slow");
      const before = (await deliveryCalls()).length;
      const responses = await Promise.all([deliver(ids.concurrent), deliver(ids.concurrent)]);
      assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
      assert.equal((await deliveryCalls()).length - before, 1);
      const order = await (await request(`/orders/${ids.concurrent}`)).json();
      assert.equal(order.status, "completed");
      await writeFile(controlFile, "");
    });

    await t.test("A lost provider response is reconciled from Lazada without a duplicate send", async () => {
      await writeFile(controlFile, "delivery-response-lost");
      const before = (await deliveryCalls()).length;
      const response = await deliver(ids["lost-response"]);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).status, "completed");
      assert.equal((await deliveryCalls()).length - before, 1);
      await writeFile(controlFile, "");
    });

    await t.test("An item-level API failure leaves the order pending and exposes no provider message", async () => {
      await writeFile(controlFile, "delivery-failure");
      const response = await deliver(ids.failed);
      const body = await response.text();
      assert.equal(response.status, 502);
      assert.ok(!body.includes("test-only-private-provider-detail"));
      const order = await (await request(`/orders/${ids.failed}`)).json();
      assert.equal(order.status, "pending");
      assert.equal(order.items[0].sourceStatus, "pending");
      await writeFile(controlFile, "");
    });

    await t.test("A failed delivery can be retried and then completed", async () => {
      await writeFile(controlFile, "delivery-failure");
      const before = (await deliveryCalls()).length;
      assert.equal((await deliver(ids.retry)).status, 502);
      await writeFile(controlFile, "");
      const response = await deliver(ids.retry);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).status, "completed");
      assert.equal((await deliveryCalls()).length - before, 2);
      const audit = await f.pool.query(`SELECT status, message, metadata::text AS metadata
        FROM sync_logs WHERE source='lazada-manual-delivery'
          AND metadata->>'orderRecordId'=$1 ORDER BY started_at`, [ids.retry]);
      assert.deepEqual(audit.rows.map(row => row.status), ["failed", "completed"]);
      assert.ok(audit.rows.every(row => !row.message.includes("private") && !row.metadata.includes("private")));
    });

    const calls = await deliveryCalls();
    assert.ok(calls.every(call => call.method === "POST"));
    const allLogs = await f.pool.query(`SELECT message, metadata::text AS metadata
      FROM sync_logs WHERE source='lazada-manual-delivery'`);
    for (const value of [env.LAZADA_APP_SECRET, env.LAZADA_TOKEN_ENCRYPTION_KEY, "test-only-delivery-token",
      "test-only-private-provider-detail"]) {
      assert.ok(!logs.includes(value), "No credentials or provider error details in process logs");
      assert.ok(!JSON.stringify(allLogs.rows).includes(value), "No credentials or provider error details in audit logs");
    }
  } finally {
    child.kill("SIGTERM");
    await exit;
    await f.pool.query(`DELETE FROM sync_logs WHERE source='lazada-manual-delivery'
      AND metadata->>'orderRecordId'=ANY($1::text[])`, [orderIds]);
    await f.pool.query("DELETE FROM order_items WHERE order_id=ANY($1::uuid[])", [orderIds]);
    await f.pool.query("DELETE FROM orders WHERE id=ANY($1::uuid[])", [orderIds]);
    await f.cleanup();
  }
});

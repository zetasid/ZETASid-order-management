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

  const callsFile = `${dir}/calls`, controlFile = `${dir}/control`, statusFile = `${dir}/statuses`;
  await writeFile(callsFile, "");
  await writeFile(controlFile, "");
  await writeFile(statusFile, "{}");
  const child = spawn(process.execPath, ["--import", "./tests/fixtures/lazada-provider.mjs", "artifacts/api-server/dist/index.mjs"], {
    env: { ...process.env, ...env, PORT: String(port), NODE_ENV: "test",
      LAZADA_TEST_CALLS_FILE: callsFile, LAZADA_TEST_CONTROL_FILE: controlFile,
      LAZADA_TEST_STATUS_FILE: statusFile },
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
  const providerStatuses = {};
  const setProviderStatus = async (id, headerStatus, itemStatus, isDigital = true, includeIsDigital = true,
    paymentEvidence = {}) => {
    providerStatuses[id] = { headerStatus, itemStatus, includeIsDigital,
      ...(includeIsDigital ? { isDigital } : {}),
      ...(Object.hasOwn(paymentEvidence, "paymentTime") ? { paymentTime: paymentEvidence.paymentTime } : {}),
      ...(Object.hasOwn(paymentEvidence, "stagePayStatus") ? { stagePayStatus: paymentEvidence.stagePayStatus } : {}) };
    await writeFile(statusFile, JSON.stringify(providerStatuses));
  };

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
    const seedOrder = async (name, headerStatus, itemStatus, liveHeaderStatus = headerStatus, liveItemStatus = itemStatus,
      digitalOptions = {}) => {
      const externalId = String(baseOrderNumber + BigInt(providerOrderIds.length * 10));
      const itemExternalId = String(BigInt(externalId) + 100n);
      const { isDigital = true, includeIsDigital = true, liveIsDigital = isDigital,
        includeLiveIsDigital = includeIsDigital, paymentTime, stagePayStatus, livePaymentTime = paymentTime,
        liveStagePayStatus = stagePayStatus } = digitalOptions;
      await setProviderStatus(externalId, liveHeaderStatus, liveItemStatus, liveIsDigital, includeLiveIsDigital,
        { paymentTime: livePaymentTime, stagePayStatus: liveStagePayStatus });
      const storedStatus = itemStatus === "delivered" ? "completed" : "pending";
      const { rows: [order] } = await f.pool.query(`INSERT INTO orders
        (lazada_order_id, product_name, status, lazada_data, synced_at)
        VALUES ($1, 'SYNTHETIC DIGITAL FIXTURE', $2, $3, now()) RETURNING id`,
      [externalId, storedStatus, { order_number: externalId,
        statuses: headerStatus === null ? null : [headerStatus], items_count: 1, price: "12000.25" }]);
      await f.pool.query(`INSERT INTO order_items
        (order_id, lazada_order_item_id, product_name, status, lazada_data)
        VALUES ($1, $2, 'SYNTHETIC DIGITAL ITEM', $3, $4)`,
      [order.id, itemExternalId, storedStatus, { order_id: externalId, order_item_id: itemExternalId,
        name: "SYNTHETIC DIGITAL ITEM", status: itemStatus,
        ...(paymentTime === undefined ? {} : { payment_time: paymentTime }),
        ...(stagePayStatus === undefined ? {} : { stage_pay_status: stagePayStatus }),
        ...(includeIsDigital ? { is_digital: isDigital } : {}) }]);
      ids[name] = order.id;
      orderIds.push(order.id);
      providerOrderIds.push(externalId);
      return externalId;
    };
    const paidTime = "1750000000000";
    for (const name of ["success", "nonpending", "concurrent", "failed", "retry", "lost-response"]) {
      await seedOrder(name, "pending", name === "nonpending" ? "delivered" : "pending",
        undefined, undefined, { paymentTime: paidTime });
    }
    for (const status of ["to_pack", "to_ship", "shipped"])
      await seedOrder(`header-${status}`, status, "pending");
    await seedOrder("header-progress-paid", "to_ship", "pending", undefined, undefined, { paymentTime: paidTime });
    await seedOrder("unpaid", "pending", "pending", undefined, undefined,
      { paymentTime: paidTime, stagePayStatus: "unpaid" });
    await seedOrder("pending-payment", "pending", "pending", undefined, undefined,
      { paymentTime: paidTime, stagePayStatus: "unpaid final payment" });
    await seedOrder("cancelled-payment", "canceled", "pending", undefined, undefined, { paymentTime: paidTime });
    await seedOrder("unknown-payment", "pending", "pending", undefined, undefined,
      { paymentTime: paidTime, stagePayStatus: "future_payment_status" });
    await seedOrder("null-payment", "pending", "pending");
    await seedOrder("item-unpaid", "pending", "unpaid", undefined, undefined, { paymentTime: paidTime });
    await seedOrder("item-unknown", "pending", "future_item_status", undefined, undefined, { paymentTime: paidTime });
    await seedOrder("item-null", "pending", null, undefined, undefined, { paymentTime: paidTime });
    await seedOrder("item-cancelled", "pending", "canceled", undefined, undefined, { paymentTime: paidTime });
    await seedOrder("item-processing", "pending", "packed", undefined, undefined, { paymentTime: paidTime });
    await seedOrder("digital-false", "pending", "pending", undefined, undefined, { paymentTime: paidTime, isDigital: false });
    await seedOrder("digital-null", "pending", "pending", undefined, undefined, { paymentTime: paidTime, isDigital: null });
    await seedOrder("digital-missing", "pending", "pending", undefined, undefined,
      { paymentTime: paidTime, includeIsDigital: false });
    await seedOrder("digital-invalid", "pending", "pending", undefined, undefined, { paymentTime: paidTime, isDigital: "true" });
    await seedOrder("live-digital-false", "pending", "pending", undefined, undefined,
      { paymentTime: paidTime, liveIsDigital: false });
    await seedOrder("live-digital-null", "pending", "pending", undefined, undefined,
      { paymentTime: paidTime, liveIsDigital: null });
    await seedOrder("live-digital-missing", "pending", "pending", undefined, undefined,
      { paymentTime: paidTime, includeLiveIsDigital: false });
    await seedOrder("stored-digital-false-live-true", "pending", "pending", undefined, undefined,
      { paymentTime: paidTime, isDigital: false, liveIsDigital: true });
    const staleUnpaidProviderId = await seedOrder("stale-unpaid", "pending", "pending", "pending", "pending",
      { paymentTime: paidTime, livePaymentTime: null, liveStagePayStatus: "unpaid" });

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

    await t.test("Unpaid, pending-payment, cancelled, unknown/null and unsafe item statuses cannot be delivered", async () => {
      const before = (await deliveryCalls()).length;
      for (const name of ["unpaid", "pending-payment", "cancelled-payment", "unknown-payment", "null-payment",
        "header-to_pack", "header-to_ship", "header-shipped", "item-unpaid", "item-unknown", "item-null",
        "item-cancelled", "item-processing"]) {
        const response = await deliver(ids[name]);
        assert.equal(response.status, 409, `${name} must be rejected`);
      }
      assert.equal((await deliveryCalls()).length, before, "No rejected payment state may call DeliverDigital");
    });

    await t.test("Workflow progress cannot be hidden by pending items or substitute for payment evidence", async () => {
      const before = (await deliveryCalls()).length;
      for (const status of ["to_pack", "to_ship", "shipped"]) {
        const unpaid = await (await request(`/orders/${ids[`header-${status}`]}`)).json();
        assert.equal(unpaid.paymentStatus, "unknown", `${status} is not payment evidence`);
        assert.equal(unpaid.status, "processing", `${status} remains an order-workflow state`);
        assert.equal((await deliver(ids[`header-${status}`])).status, 409);
      }
      const paidButProgressed = await (await request(`/orders/${ids["header-progress-paid"]}`)).json();
      assert.equal(paidButProgressed.paymentStatus, "confirmed", "The item payment time is the payment evidence");
      assert.equal(paidButProgressed.status, "processing", "Provider workflow progress is a separate order gate");
      assert.equal((await deliver(ids["header-progress-paid"])).status, 409,
        "A progressed Lazada order cannot be delivered even when payment is confirmed");
      assert.equal((await deliveryCalls()).length, before);
    });

    await t.test("Every item must be explicitly marked digital in stored and fresh Lazada data", async () => {
      const before = (await deliveryCalls()).length;
      for (const name of ["digital-false", "digital-null", "digital-missing", "digital-invalid",
        "live-digital-false", "live-digital-null", "live-digital-missing", "stored-digital-false-live-true"]) {
        const response = await deliver(ids[name]);
        assert.equal(response.status, 409, `${name} must be rejected`);
        assert.match((await response.json()).error, /dikonfirmasi sebagai digital/);
      }
      assert.equal((await deliveryCalls()).length, before,
        "No item with false, null, missing, invalid, or stale non-digital eligibility may reach DeliverDigital");
    });

    await t.test("A stale locally confirmed snapshot is rejected when Lazada currently reports unpaid", async () => {
      await setProviderStatus(staleUnpaidProviderId, "pending", "pending", true, true,
        { paymentTime: null, stagePayStatus: "unpaid" });
      const before = (await deliveryCalls()).length;
      const response = await deliver(ids["stale-unpaid"]);
      assert.equal(response.status, 409);
      assert.match((await response.json()).error, /belum selesai/);
      assert.equal((await deliveryCalls()).length, before, "Fresh Lazada status must be checked before DeliverDigital");
      const refreshed = await (await request(`/orders/${ids["stale-unpaid"]}`)).json();
      assert.equal(refreshed.paymentStatus, "unpaid");
      assert.equal(refreshed.status, "pending", "Payment state does not overwrite item workflow state");
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

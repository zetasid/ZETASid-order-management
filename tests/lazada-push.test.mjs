import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomBytes, createHmac, randomInt } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { createAuthorizedFixture, digest } from "./auth-helper.mjs";
const require = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const { build } = require("esbuild");

test("LPM HTTPS signature -> durable queue -> real API-shaped atomic ingestion, retries and reconciliation", async t => {
  const dir = await mkdtemp(`${tmpdir()}/zetas-push-`);
  const f = await createAuthorizedFixture();
  const workerFile = `${dir}/worker.mjs`, pureFile = `${dir}/pure.mjs`;
  const buildOpts = { bundle: true, platform: "node", format: "esm", logLevel: "silent",
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } };
  await build({ ...buildOpts, stdin: { contents: `export { importNextPush, reconcileOrderPage } from './artifacts/api-server/src/modules/lazada/order-push-worker.ts';`,
    resolveDir: process.cwd(), loader: "ts" }, outfile: workerFile, define: { "process.env.NODE_ENV": '"production"' } });
  await build({ ...buildOpts, stdin: { contents: `export * from './artifacts/api-server/src/modules/lazada/security.ts';
    export * from './artifacts/api-server/src/modules/lazada/push-security.ts';
    export { groupStatuses } from './artifacts/api-server/src/modules/orders/order-status.ts';`,
    resolveDir: process.cwd(), loader: "ts" }, outfile: pureFile });
  const pure = await import(pathToFileURL(pureFile));
  const listener = http.createServer();
  await new Promise(resolve => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const id = `9876${Date.now()}${randomInt(100)}`, secondId = String(BigInt(id) + 1n);
  const callsFile = `${dir}/calls`, controlFile = `${dir}/control`;
  await writeFile(callsFile, ""); await writeFile(controlFile, "");
  const env = { LAZADA_MODE: "testing", LAZADA_COUNTRY: "id", LAZADA_SITE: "lazada_sg", LAZADA_APP_KEY: "999901",
    LAZADA_APP_SECRET: "dummy-lpm-secret-not-real", LAZADA_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    LAZADA_REDIRECT_URI: "https://testing.example.invalid/api/lazada/oauth/callback", APP_ORIGIN: "https://testing.example.invalid" };
  const config = pure.configuration(env);
  await f.pool.query(`INSERT INTO lazada_connections
    (user_id,encrypted_tokens,app_fingerprint,country,expires_at,refresh_expires_at,verified,checked_at)
    VALUES($1,$2,$3,'id',now()+interval '1 hour',now()+interval '2 hours','yes',now())`, [
    f.id, pure.seal(JSON.stringify({ accessToken: "dummy-push-token-not-real" }), config, f.id), config.fingerprint,
  ]);
  const originalHashSql = `SELECT
    (SELECT md5(string_agg(to_jsonb(o)::text,'' ORDER BY o.id)) FROM orders o WHERE lazada_order_id NOT IN($1,$2)) AS orders_hash,
    (SELECT md5(string_agg(to_jsonb(i)::text,'' ORDER BY i.id)) FROM order_items i
      JOIN orders o ON o.id=i.order_id WHERE o.lazada_order_id NOT IN($1,$2)) AS items_hash`;
  const before = (await f.pool.query(originalHashSql, [id, secondId])).rows[0];
  const ip = `192.0.2.${randomInt(1, 250)}`;
  const child = spawn(process.execPath, ["--import", "./tests/fixtures/lazada-push-provider.mjs", "artifacts/api-server/dist/index.mjs"], {
    env: { ...process.env, ...env, PORT: String(port), NODE_ENV: "test", LOG_LEVEL: "warn", TRUST_PROXY: "127.0.0.1",
      LAZADA_TEST_ORDER_ID: id, LAZADA_TEST_WORKER_BUNDLE: workerFile,
      LAZADA_TEST_CALLS_FILE: callsFile, LAZADA_TEST_CONTROL_FILE: controlFile },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const exit = once(child, "exit");
  let logs = ""; child.stdout.on("data", d => { logs += d; }); child.stderr.on("data", d => { logs += d; });
  const api = `http://127.0.0.1:${port}/api`;
  const body = (extra = {}) => ({ seller_id: "1234567", message_type: 0, site: env.LAZADA_SITE, timestamp: Date.now(),
    data: { trade_order_id: id, trade_order_line_id: String(BigInt(id) + 100n), order_status: "confirmed",
      status_update_time: Math.floor(Date.now() / 1000) }, ...extra });
  const send = (payload, extraHeaders = {}, rawBody) => {
    const raw = rawBody ?? JSON.stringify(payload);
    const signature = createHmac("sha256", env.LAZADA_APP_SECRET).update(env.LAZADA_APP_KEY + raw).digest("hex");
    return fetch(`${api}/lazada/orders/push`, { method: "POST", body: raw,
      headers: { "Content-Type": "application/json", "X-Forwarded-Proto": "https", "X-Forwarded-For": ip,
        Authorization: signature, ...extraHeaders } });
  };
  const get = path => fetch(`${api}${path}`, { headers: { Cookie: f.cookie } });
  let taskId = 0;
  let manualSyncAt;
  const runWorker = task => new Promise((resolve, reject) => {
    const current = ++taskId;
    const timer = setTimeout(() => { child.off("message", handler); reject(new Error("Test worker timeout")); }, 10000);
    const handler = message => {
      if (message.taskId !== current) return;
      clearTimeout(timer); child.off("message", handler);
      if (message.failed) reject(new Error("Test worker failed")); else resolve(message.result);
    };
    child.on("message", handler); child.send({ task, taskId: current });
  });
  const orderRows = () => f.pool.query("SELECT * FROM orders WHERE lazada_order_id=$1", [id]);
  const status = async () => (await (await get("/lazada/orders/push-status")).json());
  try {
    for (let n = 0; n < 100; n++) {
      try { if ((await fetch(`${api}/healthz`)).ok) break; } catch {}
      await delay(50);
    }
    // Public trade example, NOT a documented contract for App Console Verify.
    const sample = { seller_id: "1234567", message_type: 0, site: "lazada_vn", timestamp: 1603766859530,
      data: { order_status: "unpaid", status_update_time: 1603698638,
        trade_order_id: "260422900198363", trade_order_line_id: "260422900298363" } };
    await t.test("Milliseconds and seconds normalize before freshness checks; invalid timestamps fail closed", () => {
      const now = 1_800_000_000_000;
      assert.equal(pure.normalizePushTimestamp(now), now);
      assert.equal(pure.normalizePushTimestamp(now / 1000), now);
      for (const invalid of [0, -1, 1.5, "1800000000", null, undefined, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        assert.throws(() => pure.normalizePushTimestamp(invalid), error => error.reason === "invalid_timestamp");
      }
      for (const invalid of [NaN, Infinity, now + 0.5, Number.MAX_SAFE_INTEGER + 1]) {
        assert.equal(pure.freshPush(invalid, now), false);
      }
      assert.equal(pure.freshPush(now - 7 * 3600000, now), true);
      assert.equal(pure.freshPush(now - 7 * 3600000 - 1, now), false);
      assert.equal(pure.freshPush(now + 5 * 60000, now), true);
      assert.equal(pure.freshPush(now + 5 * 60000 + 1, now), false);
    });
    await t.test("Invalid JSON, schema and site have safe reason codes, with no payload values", () => {
      assert.throws(() => pure.parsePush(Buffer.from("{"), config), error => error.reason === "invalid_json");
      assert.throws(() => pure.parsePush(Buffer.from(JSON.stringify(body({ data: {} }))), config),
        error => error.reason === "invalid_schema" && error.fields.includes("data.trade_order_id"));
      assert.throws(() => pure.parsePush(Buffer.from(JSON.stringify(body({ site: "lazada_vn" }))), config),
        error => error.reason === "site_mismatch" && error.fields.join() === "site");
    });
    await t.test("Parser uses exactly one configured site; the default still accepts only the API-country site", () => {
      const defaultConfig = pure.configuration({ ...env, LAZADA_SITE: undefined });
      assert.equal(defaultConfig.site, "lazada_id");
      assert.equal(config.country, "id");
      assert.equal(config.site, "lazada_sg");
      assert.equal(config.fingerprint, defaultConfig.fingerprint);
      assert.ok(pure.parsePush(Buffer.from(JSON.stringify(body({ site: "lazada_id" }))), defaultConfig));
      assert.throws(() => pure.parsePush(Buffer.from(JSON.stringify(body())), defaultConfig),
        error => error.reason === "site_mismatch");
      for (const invalid of [
        body({ site: { token: "PRIVATE-NESTED-SITE" }, message_type: { buyer: "PRIVATE-NESTED-MESSAGE" } }),
        null, [],
      ]) {
        assert.throws(() => pure.parsePush(Buffer.from(JSON.stringify(invalid)), config),
          error => error.reason === "invalid_schema");
      }
    });
    const timestampNotification = body();
    await t.test("Configured lazada_sg with API country id returns 200; milliseconds remain valid, with no API/order writes", async () => {
      const response = await send(timestampNotification);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { accepted: true });
      assert.equal((await f.pool.query("SELECT count(*)::int n FROM lazada_order_push WHERE user_id=$1", [f.id])).rows[0].n, 1);
      assert.equal((await orderRows()).rows.length, 0);
      assert.equal(await readFile(callsFile, "utf8"), "");
    });
    await t.test("Valid signed seconds notification returns 200 and remains idempotent", async () => {
      assert.equal((await send({ ...timestampNotification, timestamp: Math.floor(timestampNotification.timestamp / 1000) })).status, 200);
      assert.equal((await f.pool.query("SELECT count(*)::int n FROM lazada_order_push WHERE user_id=$1", [f.id])).rows[0].n, 1);
    });
    await t.test("Extra Lazada envelope and order fields do not reject a valid signed notification", async () => {
      assert.equal((await send({ ...timestampNotification, extension: { additional: true },
        data: { ...timestampNotification.data, reverse_order_id: "987654321", extension: ["additional"] } })).status, 200);
      assert.equal((await f.pool.query("SELECT count(*)::int n FROM lazada_order_push WHERE user_id=$1", [f.id])).rows[0].n, 1);
    });
    for (const [title, sites] of [
      ["API-country lazada_id is rejected when the configured webhook site is lazada_sg", ["lazada_id"]],
      ["Other country/marketplace or arbitrary sites are rejected, with no fallback", ["lazada_vn", "lazada_ph", "lazada_my", "lazada_th", "shopee_sg", "arbitrary"]],
      ["Empty site is rejected", [""]],
      ["Site matching is exact: uppercase, mixed case, whitespace and lists are rejected", ["LAZADA_SG", "Lazada_sg", " lazada_sg", "lazada_sg ", "lazada_sg,lazada_id"]],
    ]) {
      await t.test(title, async () => {
        for (const site of sites) {
          const response = await send({ ...timestampNotification, site });
          assert.equal(response.status, 400);
          assert.deepEqual(await response.json(), { error: "Payload order push tidak valid." });
        }
        assert.equal((await f.pool.query("SELECT count(*)::int n FROM lazada_order_push WHERE user_id=$1", [f.id])).rows[0].n, 1);
        assert.equal((await orderRows()).rows.length, 0);
        assert.equal(await readFile(callsFile, "utf8"), "");
      });
    }
    await t.test("Expired/future timestamps are rejected in both units, even for a known duplicate", async () => {
      for (const timestamp of [Date.now() - 8 * 3600000, Date.now() + 6 * 60000]) {
        for (const value of [timestamp, Math.floor(timestamp / 1000)]) {
          const response = await send({ ...timestampNotification, timestamp: value });
          assert.equal(response.status, 400);
          assert.deepEqual(await response.json(), { error: "Timestamp push kedaluwarsa atau tidak valid." });
        }
      }
      assert.equal((await f.pool.query("SELECT count(*)::int n FROM lazada_order_push WHERE user_id=$1", [f.id])).rows[0].n, 1);
      assert.equal((await orderRows()).rows.length, 0);
      assert.equal(await readFile(callsFile, "utf8"), "");
    });
    await f.pool.query("DELETE FROM lazada_order_push WHERE user_id=$1", [f.id]);
    await t.test("Signed public examples do not bypass normal site or timestamp validation", async () => {
      assert.equal((await send(sample)).status, 400);
      assert.equal((await send(sample)).status, 400);
      assert.equal((await send(sample, {}, JSON.stringify(sample, null, 2))).status, 400);
      assert.equal((await send({ ...sample, site: config.site })).status, 400, "Matching site does not exempt stale timestamps");
      assert.equal((await send({ ...sample, timestamp: Date.now() })).status, 400, "Fresh timestamp does not exempt foreign sites");
      assert.equal((await f.pool.query("SELECT count(*)::int n FROM lazada_order_push WHERE user_id=$1", [f.id])).rows[0].n, 0);
      assert.equal((await f.pool.query("SELECT count(*)::int n FROM orders WHERE lazada_order_id=$1", [sample.data.trade_order_id])).rows[0].n, 0);
      assert.equal(await readFile(callsFile, "utf8"), "");
    });
    await t.test("HTTPS and raw-byte HMAC remain mandatory; malformed payloads and guessed Verify flags are rejected", async () => {
      const plainHttp = await send(body(), { "X-Forwarded-Proto": "http" });
      assert.equal(plainHttp.status, 400);
      assert.deepEqual(await plainHttp.json(), { error: "HTTPS wajib." });
      const proxyRaw = JSON.stringify(body());
      const spoofed = await new Promise((resolve, reject) => {
        const request = http.request(`${api}/lazada/orders/push`, {
          method: "POST", localAddress: "127.0.0.2", agent: false,
          headers: { "Content-Type": "application/json", "X-Forwarded-Proto": "https",
            Authorization: createHmac("sha256", env.LAZADA_APP_SECRET).update(env.LAZADA_APP_KEY + proxyRaw).digest("hex") },
        }, response => {
          let text = "";
          response.on("data", chunk => { text += chunk; });
          response.on("end", () => resolve({ status: response.statusCode, body: JSON.parse(text) }));
        });
        request.on("error", reject);
        request.end(proxyRaw);
      });
      assert.deepEqual(spoofed, { status: 400, body: { error: "HTTPS wajib." } },
        "Even a valid raw-body HMAC cannot make an untrusted source's HTTPS header trusted");
      assert.equal((await send(sample, { Authorization: "" })).status, 401);
      assert.equal((await send(sample, { Authorization: "f".repeat(64) })).status, 401);
      assert.equal((await send(sample, { "X-Forwarded-Proto": "http" })).status, 400);
      const raw = JSON.stringify(sample);
      const sign = createHmac("sha256", env.LAZADA_APP_SECRET).update(env.LAZADA_APP_KEY + raw).digest("hex");
      assert.equal((await send(sample, { Authorization: sign }, raw + " ")).status, 401);
      for (const invalid of [
        body({ message_type: -1 }), body({ seller_id: "" }),
        body({ test: true, data: null }), body({ verify: true, data: {} }),
        body({ data: { ...body().data, trade_order_id: "" } }),
        body({ data: { ...body().data, trade_order_line_id: "" } }),
        body({ data: { ...body().data, order_status: "" } }),
        body({ data: { ...body().data, status_update_time: 0 } }),
        { message_type: 0, test: true }, { message_type: 0, verify: true }, null, [],
      ]) {
        assert.equal((await send(invalid)).status, 400, "Valid HMAC is not sufficient to accept an invalid order payload");
      }
      assert.equal((await send(sample, {}, "{")).status, 400);
      assert.equal((await send(sample, {}, JSON.stringify({ ...sample, extra: "x".repeat(17000) }))).status, 413);
      assert.equal((await send(sample, { "Content-Encoding": "gzip" })).status, 415);
      assert.equal((await f.pool.query("SELECT count(*)::int n FROM lazada_order_push WHERE user_id=$1", [f.id])).rows[0].n, 0);
      assert.equal(await readFile(callsFile, "utf8"), "");
    });
    await t.test("Official raw-byte HMAC, all mapping groups, invalid authentication/payload/replay/HTTPS", async () => {
      const raw = Buffer.from(JSON.stringify(body()));
      const sign = createHmac("sha256", env.LAZADA_APP_SECRET).update(env.LAZADA_APP_KEY).update(raw).digest("hex");
      assert.equal(pure.validPushSignature(raw, sign, config), true);
      assert.equal(pure.validPushSignature(Buffer.concat([raw, Buffer.from(" ")]), sign, config), false);
      for (const [statuses, expected] of [
        [["unpaid", "pending"], "pending"], [["repacked", "packed", "ready_to_ship_pending", "ready_to_ship", "shipped", "topack", "toship", "shipping"], "processing"],
        [["delivered", "confirmed"], "completed"], [["canceled"], "cancelled"], [["unsupported"], null],
      ]) assert.equal(pure.groupStatuses(statuses), expected);
      assert.equal((await send(body(), { Authorization: "f".repeat(64) })).status, 401);
      assert.equal((await send(body(), { "X-Forwarded-Proto": "http" })).status, 400);
      assert.equal((await send(body({ site: "lazada_vn" }))).status, 400);
      assert.equal((await send(body({ message_type: 3 }))).status, 400);
      assert.equal((await send(body({ timestamp: Date.now() - 8 * 3600000 }))).status, 400);
      assert.equal((await send(body({ timestamp: Date.now() + 3600000 }))).status, 400);
      assert.equal((await send(null, {}, "{")).status, 400);
      assert.equal((await fetch(`${api}/lazada/orders/push-status`)).status, 401);
      assert.equal(await readFile(callsFile, "utf8"), "");
      assert.equal((await orderRows()).rows.length, 0);
    });
    const notification = body();
    await t.test("Valid push ACK is durable and does NOT fetch APIs or create an order synchronously", async () => {
      const start = performance.now(), response = await send(notification);
      assert.equal(response.status, 200);
      manualSyncAt = (await response.json()).syncedAt;
      assert.ok(performance.now() - start < 500, "LPM acknowledgment deadline");
      assert.equal((await orderRows()).rows.length, 0);
      assert.equal(await readFile(callsFile, "utf8"), "");
      assert.equal((await status()).pending, 1); assert.equal((await status()).active, false);
    });
    await t.test("Duplicate push is acknowledged once, including JSON whitespace / changed delivery timestamp", async () => {
      assert.equal((await send(notification)).status, 200);
      assert.equal((await send({ ...notification, timestamp: Date.now() }, {}, JSON.stringify(notification, null, 2))).status, 200);
      assert.equal((await f.pool.query("SELECT count(*)::int n FROM lazada_order_push WHERE user_id=$1", [f.id])).rows[0].n, 1);
    });
    await t.test("Automatic ingestion fetches GetOrder + GetOrderItems; multiple items and exact digital_delivery_info", async () => {
      assert.equal(await runWorker("push"), true);
      assert.equal((await orderRows()).rows.length, 1);
      const saved = (await orderRows()).rows[0];
      const detail = await (await get(`/orders/${saved.id}`)).json();
      assert.equal(detail.status, "pending", "API status wins over misleading push status confirmed");
      assert.equal(detail.items.length, 2);
      assert.ok(detail.items.some(i => i.digitalDetail === "DUMMY-DEST-initial"));
      assert.ok(detail.items.some(i => i.digitalDetail === JSON.stringify({ test_only_account: "DUMMY-JSON" }, null, 2)));
      assert.ok(detail.items.every(i => i.digitalDetailSource === "digital_delivery_info"));
      assert.equal((await status()).active, true); assert.equal((await status()).pending, 0);
      assert.equal(await runWorker("push"), false);
    });
    await t.test("Existing order updates atomically, but identical API data do not rewrite timestamps or duplicate items", async () => {
      const old = (await orderRows()).rows[0];
      const changedEvent = body({ data: { ...notification.data, order_status: "pending", status_update_time: notification.data.status_update_time + 1 } });
      await writeFile(controlFile, "changed"); assert.equal((await send(changedEvent)).status, 200);
      await runWorker("push");
      const updated = (await orderRows()).rows[0]; assert.equal(updated.id, old.id); assert.equal(updated.status, "completed");
      assert.notEqual(updated.lazada_data.updated_at, old.lazada_data.updated_at);
      assert.equal((await f.pool.query("SELECT count(*)::int n FROM order_items WHERE order_id=$1", [old.id])).rows[0].n, 2);
      assert.equal((await send(body({ data: { ...notification.data, status_update_time: notification.data.status_update_time + 2 } }))).status, 200);
      await runWorker("push");
      assert.deepEqual((await orderRows()).rows[0], updated);
      // Redelivery after ingestion must not create another event/order/item.
      assert.equal((await send(notification)).status, 200);
      assert.equal(await runWorker("push"), false);
      assert.equal((await orderRows()).rows.length, 1);
      assert.deepEqual((await orderRows()).rows[0], updated);
      assert.equal((await f.pool.query("SELECT count(*)::int n FROM order_items WHERE order_id=$1", [old.id])).rows[0].n, 2);
    });
    await t.test("Failed API fetch persists retry; incomplete items preserve all previous data; retry then succeeds", async () => {
      const old = (await orderRows()).rows[0];
      const retryEvent = body({ data: { ...notification.data, status_update_time: notification.data.status_update_time + 3 } });
      await writeFile(controlFile, "fail"); await send(retryEvent); await runWorker("push");
      assert.deepEqual((await orderRows()).rows[0], old);
      assert.equal((await status()).pending, 1); assert.equal((await status()).lastError, "permission_denied");
      await f.pool.query("UPDATE lazada_order_push SET next_attempt_at=now() WHERE user_id=$1 AND status='pending'", [f.id]);
      await writeFile(controlFile, "broken"); await runWorker("push");
      assert.deepEqual((await orderRows()).rows[0], old);
      await f.pool.query("UPDATE lazada_order_push SET next_attempt_at=now() WHERE user_id=$1 AND status='pending'", [f.id]);
      await writeFile(controlFile, "changed"); await runWorker("push"); assert.equal((await status()).pending, 0);
    });
    await t.test("Reconciliation retries, refreshes an old order's status, and discovers orders without webhooks", async () => {
      await writeFile(controlFile, "fail"); assert.equal(await runWorker("reconcile"), true);
      const state = (await f.pool.query("SELECT * FROM lazada_order_automation WHERE user_id=$1", [f.id])).rows[0];
      assert.equal(state.reconciled_through, null); assert.equal(state.last_error, "permission_denied");
      await f.pool.query("UPDATE lazada_order_automation SET next_reconcile_at=now() WHERE user_id=$1", [f.id]);
      await writeFile(controlFile, "progressed"); assert.equal(await runWorker("reconcile"), true);
      assert.equal((await f.pool.query("SELECT count(*)::int n FROM orders WHERE lazada_order_id=ANY($1)", [[id, secondId]])).rows[0].n, 2);
      const refreshed = await (await get(`/orders/${(await f.pool.query("SELECT id FROM orders WHERE lazada_order_id=$1", [id])).rows[0].id}`)).json();
      assert.equal(refreshed.status, "processing", "Existing pending status follows the newer GetOrderItems status");
      assert.equal(refreshed.paymentStatus, "unknown", "A workflow header without item payment evidence is not payment confirmation");
      assert.equal(refreshed.items[0].sourceStatus, "packed");
      const newOrder = (await f.pool.query("SELECT id FROM orders WHERE lazada_order_id=$1", [secondId])).rows[0];
      const oldOrder = await (await get(`/orders/${newOrder.id}`)).json();
      assert.equal(oldOrder.items[0].digitalDetail, null);
      assert.match(oldOrder.sourceCreatedAt, /^2020-01-15/, "Updated-time reconciliation discovers an old-created order");
      assert.equal(await runWorker("reconcile"), false, "Low frequency, not continuous provider polling");
      assert.equal((await status()).lastError, null);
    });
    await t.test("Manual read fallback, rate limiting and no sensitive logs or provider writes", async () => {
      const response = await fetch(`${api}/lazada/orders/sync`, { method: "POST",
        headers: { Cookie: f.cookie, Origin: env.APP_ORIGIN, "X-CSRF-Token": f.csrfToken,
          "X-Forwarded-Proto": "https", "Content-Type": "application/json" },
        body: JSON.stringify({ createdAfter: new Date(Date.now() - 86400000).toISOString(), createdBefore: new Date().toISOString(), offset: 0 }) });
      assert.equal(response.status, 200);
      await f.pool.query(`INSERT INTO auth_login_buckets(key,attempts,reset_at) VALUES($1,120,now()+interval '1 minute')
        ON CONFLICT(key) DO UPDATE SET attempts=120,reset_at=now()+interval '1 minute'`, [digest("lpm-ip", ip)]);
      assert.equal((await send(notification)).status, 429);
      assert.equal((await send(sample)).status, 429, "Signed public examples do not bypass the persistent quota");
      const calls = (await readFile(callsFile, "utf8")).trim().split("\n").map(JSON.parse);
      assert.ok(calls.every(c => c.method === "GET" && ["/order/get", "/order/items/get", "/orders/get"].includes(c.path)));
      assert.ok(calls.some(c => c.path === "/orders/get" && c.parameterNames.includes("update_after")));
      const plainLogs = stripVTControlCharacters(logs);
      assert.ok(!plainLogs.includes("Lazada push diagnostic"), "Temporary diagnostic logging is removed");
      assert.match(plainLogs, /reason"?:\s*"site_mismatch"/);
      assert.match(plainLogs, /reason"?:\s*"invalid_schema"/);
      assert.match(plainLogs, /reason"?:\s*"invalid_json"/);
      assert.match(plainLogs, /reason"?:\s*"timestamp_out_of_window"/);
      const privateSignature = createHmac("sha256", env.LAZADA_APP_SECRET)
        .update(env.LAZADA_APP_KEY + JSON.stringify(timestampNotification)).digest("hex");
      for (const value of [env.LAZADA_APP_SECRET, env.LAZADA_TOKEN_ENCRYPTION_KEY, privateSignature,
        JSON.stringify(timestampNotification), "dummy-push-token-not-real", "DUMMY-DEST", "DUMMY-JSON", config.site])
        assert.ok(!plainLogs.includes(value), "No credential/digital values in logs");
      assert.deepEqual((await f.pool.query(originalHashSql, [id, secondId])).rows[0], before, "Existing user order/item rows untouched by test fixtures");
    });
    await t.test("Durable ACK stays below 500ms while slow reconciliation holds the automation-state lock", async () => {
      await f.pool.query("DELETE FROM auth_login_buckets WHERE key=$1", [digest("lpm-ip", ip)]);
      await f.pool.query("UPDATE lazada_order_automation SET next_reconcile_at=now() WHERE user_id=$1", [f.id]);
      await writeFile(controlFile, "slow");
      const slowRecovery = runWorker("reconcile");
      await delay(100);
      const start = performance.now();
      assert.equal((await send(body({ data: { ...notification.data, status_update_time: notification.data.status_update_time + 4 } }))).status, 200);
      assert.ok(performance.now() - start < 500, "Receipt must not wait for worker's state-row lock");
      assert.equal((await status()).pending, 1);
      assert.ok((await status()).lastPush);
      await slowRecovery;
      await writeFile(controlFile, "changed"); await runWorker("push");
      assert.equal((await status()).pending, 0);
    });
  } finally {
    child.kill("SIGTERM"); await exit;
    await f.pool.query("DELETE FROM order_items WHERE order_id IN(SELECT id FROM orders WHERE lazada_order_id=ANY($1))", [[id, secondId]]);
    await f.pool.query("DELETE FROM orders WHERE lazada_order_id=ANY($1)", [[id, secondId]]);
    await f.pool.query("DELETE FROM sync_logs WHERE metadata->>'appFingerprint'=$1", [config.fingerprint]);
    if (manualSyncAt) await f.pool.query("DELETE FROM sync_logs WHERE source='lazada' AND started_at=$1", [manualSyncAt]);
    await f.pool.query("DELETE FROM auth_login_buckets WHERE key=$1", [digest("lpm-ip", ip)]);
    await f.cleanup(); await rm(dir, { recursive: true, force: true });
  }
});
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { createAuthorizedFixture } from "./auth-helper.mjs";

const require = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const { build } = require("esbuild");
const temporary = await mkdtemp(`${tmpdir()}/zetas-lazada-`);
await build({ entryPoints: ["artifacts/api-server/src/modules/lazada/security.ts", "artifacts/api-server/src/modules/lazada/client.ts"],
  outdir: temporary, bundle: true, platform: "node", format: "esm", outExtension: { ".js": ".mjs" }, logLevel: "silent" });
const security = await import(pathToFileURL(`${temporary}/security.mjs`));
const { createClient, signature } = await import(pathToFileURL(`${temporary}/client.mjs`));
const env = { LAZADA_MODE: "testing", LAZADA_COUNTRY: "id", LAZADA_APP_KEY: "999000",
  LAZADA_APP_SECRET: "test-only-not-a-real-app-secret", LAZADA_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  LAZADA_REDIRECT_URI: "https://testing.example.invalid/api/lazada/oauth/callback", APP_ORIGIN: "https://testing.example.invalid" };
test.after(async () => { await rm(temporary, { recursive: true, force: true }); });

test("Lazada configuration fails closed without secrets, HTTPS, Testing mode or matching origin", () => {
  assert.ok(security.configuration(env));
  assert.equal(security.configuration({}), null);
  for (const patch of [
    { LAZADA_MODE: "production" }, { LAZADA_APP_SECRET: "" }, { LAZADA_TOKEN_ENCRYPTION_KEY: "short" },
    { LAZADA_REDIRECT_URI: "http://testing.example.invalid/api/lazada/oauth/callback" },
    { LAZADA_REDIRECT_URI: "https://other.example.invalid/api/lazada/oauth/callback" },
    { LAZADA_REDIRECT_URI: "https://testing.example.invalid/api/lazada/oauth/callback?token=fixture" },
    { LAZADA_COUNTRY: "untrusted" },
  ]) assert.equal(security.configuration({ ...env, ...patch }), null);
});
test("Webhook site defaults to the API country when unset/empty", () => {
  for (const country of Object.keys(security.endpoints)) {
    for (const site of [undefined, ""]) {
      const config = security.configuration({ ...env, LAZADA_COUNTRY: country, LAZADA_SITE: site });
      assert.equal(config.site, `lazada_${country}`);
      assert.equal(config.country, country);
    }
  }
});
test("Explicit webhook site leaves Indonesia API routing, fingerprint and encrypted tokens unchanged", async () => {
  const original = security.configuration(env);
  const config = security.configuration({ ...env, LAZADA_SITE: "lazada_sg" });
  assert.equal(config.site, "lazada_sg");
  assert.equal(config.country, "id");
  assert.equal(config.fingerprint, original.fingerprint);
  const encrypted = security.seal("dummy-token-not-real", original, "owner");
  assert.equal(security.unseal(encrypted, config, "owner"), "dummy-token-not-real");
  let requested;
  const client = createClient(config, async input => {
    requested = new URL(String(input));
    return new Response(JSON.stringify({ code: "InsufficientPermissions" }));
  });
  await assert.rejects(client.getOrder("dummy-token-not-real", "123"), error => error.reason === "permission_denied");
  assert.equal(requested.hostname, "api.lazada.co.id");
  assert.equal(requested.pathname, "/rest/order/get");
});
test("Webhook site configuration accepts only one exact supported site, never arbitrary names/wildcards", () => {
  for (const country of Object.keys(security.endpoints)) {
    assert.equal(security.configuration({ ...env, LAZADA_SITE: `lazada_${country}` }).site, `lazada_${country}`);
  }
  for (const site of ["*", "lazada_*", "lazada_us", "shopee_id", "LAZADA_SG", " lazada_sg",
    "lazada_sg ", "lazada_id,lazada_sg", "https://api.lazada.sg/rest"]) {
    assert.equal(security.configuration({ ...env, LAZADA_SITE: site }), null);
  }
});
test("Lazada AES-256-GCM uses random IVs and rejects ciphertext tampering, wrong owner and wrong key", () => {
  const config = security.configuration(env);
  const first = security.seal("test-only-token", config, "owner");
  assert.equal(security.unseal(first, config, "owner"), "test-only-token");
  assert.notEqual(first, security.seal("test-only-token", config, "owner"));
  assert.ok(!first.includes("test-only-token"));
  assert.throws(() => security.unseal(first, config, "other-owner"));
  assert.throws(() => security.unseal(first, { ...config, key: randomBytes(32) }, "owner"));
  const parts = first.split("."); parts[3] = Buffer.from("tampered").toString("base64url");
  assert.throws(() => security.unseal(parts.join("."), config, "owner"));
});
test("Lazada HMAC-SHA256 matches the official HTTP request signing example (no API call)", () => {
  assert.equal(signature("/order/get", { app_key: "123456", access_token: "test", timestamp: "1517820392000",
    sign_method: "sha256", order_id: "1234" }, "helloworld"),
  "4190D32361CFB9581350222F345CB77F3B19F0E31D162316848A2C1FFD5FAB4A");
});
test("Lazada client accepts only validated responses and safely handles network/permission errors", async () => {
  const config = security.configuration(env);
  const client = createClient(config, async () => { throw new Error("test-only-private-provider-detail"); });
  await assert.rejects(client.check("dummy"), error => error.reason === "api_unavailable" && !error.message.includes("private"));
  const denied = createClient(config, async () => new Response(JSON.stringify({ code: "InsufficientPermissions" })));
  await assert.rejects(denied.check("dummy"), error => error.reason === "permission_denied");
  const malformed = createClient(config, async () => new Response(JSON.stringify({ code: "0", access_token: "dummy" })));
  await assert.rejects(malformed.exchange("dummy"), error => error.reason === "authorization_failed");
});

test("Lazada provider diagnostics contain only safe response fields and preserve error mapping", async () => {
  const config = security.configuration(env);
  const diagnosticEntries = [];
  const diagnosticLogger = { warn: (fields, message) => diagnosticEntries.push({ fields, message }) };
  const authorizationCode = "test-only-oauth-code-must-not-be-logged";
  const exposedMessage = `Rejected ${authorizationCode}; secret=${config.appSecret}; https://example.invalid/path?access_token=leaked`;
  const invalidCode = createClient(config, async () => new Response(JSON.stringify({
    code: "InvalidCode", message: exposedMessage, request_id: "lazada-request-123",
  })), undefined, diagnosticLogger);

  await assert.rejects(invalidCode.exchange(authorizationCode), error => error.reason === "authorization_failed");
  assert.equal(diagnosticEntries.length, 1);
  const invalidCodeLog = diagnosticEntries[0].fields;
  assert.deepEqual(Object.keys(invalidCodeLog).sort(),
    ["path", "httpStatus", "providerCode", "providerMessage", "providerRequestId"].sort());
  assert.equal(invalidCodeLog.path, "/auth/token/create");
  assert.equal(invalidCodeLog.httpStatus, 200);
  assert.equal(invalidCodeLog.providerCode, "InvalidCode");
  assert.equal(invalidCodeLog.providerRequestId, "lazada-request-123");
  assert.ok(!JSON.stringify(invalidCodeLog).includes(authorizationCode));
  assert.ok(!JSON.stringify(invalidCodeLog).includes(config.appSecret));
  assert.ok(!JSON.stringify(invalidCodeLog).includes("leaked"));
  assert.ok(!JSON.stringify(invalidCodeLog).includes("https://"));

  const longAuthorizationCode = "test-only-long-oauth-code-".repeat(40);
  const longCodeClient = createClient(config, async () => new Response(JSON.stringify({
    code: "InvalidCode",
    message: `${longAuthorizationCode} was rejected by the provider`,
    request_id: "lazada-request-long-code",
  })), undefined, diagnosticLogger);
  await assert.rejects(longCodeClient.exchange(longAuthorizationCode), error => error.reason === "authorization_failed");
  const longCodeMessage = diagnosticEntries[1].fields.providerMessage;
  assert.ok(!longCodeMessage.includes(longAuthorizationCode));
  assert.ok(longCodeMessage.startsWith("[redacted]"));
  assert.ok(longCodeMessage.length <= 512);

  const denied = createClient(config, async () => new Response(JSON.stringify({
    code: "InsufficientPermissions", message: "Permission denied", request_id: "lazada-request-403",
  }), { status: 403 }), undefined, diagnosticLogger);
  await assert.rejects(denied.check("test-only-access-token"), error => error.reason === "api_unavailable");
  assert.equal(diagnosticEntries[2].fields.httpStatus, 403);
  assert.equal(diagnosticEntries[2].fields.providerCode, "InsufficientPermissions");

  const invalidJsonBody = "response contains test-only-private-provider-detail and must not be logged";
  const invalidJson = createClient(config, async () => new Response(invalidJsonBody, { status: 502 }), undefined, diagnosticLogger);
  await assert.rejects(invalidJson.exchange("another-test-code"), error => error.reason === "api_unavailable");
  assert.deepEqual(diagnosticEntries[3].fields, {
    path: "/auth/token/create",
    httpStatus: 502,
    providerCode: null,
    providerMessage: null,
    providerRequestId: null,
  });
  assert.ok(!JSON.stringify(diagnosticEntries).includes(invalidJsonBody));
});

test("Lazada Testing OAuth and connection API — simulated provider, real backend/PostgreSQL", async t => {
  const reservation = http.createServer();
  await new Promise(r => reservation.listen(0, "127.0.0.1", r));
  const port = reservation.address().port;
  await new Promise(r => reservation.close(r));
  const callsFile = `${temporary}/calls.jsonl`, controlFile = `${temporary}/control`;
  await writeFile(callsFile, ""); await writeFile(controlFile, "");
  let logs = "";
  const child = spawn(process.execPath, ["--import", "./tests/fixtures/lazada-provider.mjs", "artifacts/api-server/dist/index.mjs"], {
    env: { ...process.env, ...env, PORT: String(port), NODE_ENV: "test", LAZADA_TEST_CALLS_FILE: callsFile, LAZADA_TEST_CONTROL_FILE: controlFile },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", data => { logs += data; }); child.stderr.on("data", data => { logs += data; });
  const exit = once(child, "exit");
  const fixtures = [];
  const fixture = async () => { const f = await createAuthorizedFixture(); fixtures.push(f); return f; };
  const origin = env.APP_ORIGIN, base = `http://127.0.0.1:${port}/api`;
  const request = (path, f, method = "GET", extra = {}) => fetch(`${base}${path}`, { method, redirect: "manual",
    headers: { "X-Forwarded-Proto": "https", ...(f ? { Cookie: f.cookie, Origin: origin, "X-CSRF-Token": f.csrfToken } : {}), ...extra } });
  const calls = async () => (await readFile(callsFile, "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  const start = async f => {
    const response = await request("/lazada/oauth/authorize", f, "POST"); assert.equal(response.status, 200);
    // Session renewal and OAuth binding are separate Set-Cookie headers.
    const cookie = response.headers.getSetCookie().find(value => value.startsWith("zetas_lazada_oauth="));
    assert.ok(cookie);
    assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=Lax/);
    const url = new URL((await response.json()).authorizationUrl);
    assert.equal(url.origin, "https://auth.lazada.com"); assert.equal(url.searchParams.get("scope"), null);
    assert.equal(url.searchParams.get("redirect_uri"), env.LAZADA_REDIRECT_URI);
    return { state: url.searchParams.get("state"), cookie: cookie.split(";")[0] };
  };
  const callback = (flow, code = "valid", extra = "") => request(`/lazada/oauth/callback?state=${flow.state}&code=${code}${extra}`, null, "GET", { Cookie: flow.cookie });
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { if ((await request("/healthz")).ok) { ready = true; break; } } catch {}
      await delay(50);
    }
    assert.ok(ready, "Disposable test API must start");
    const a = await fixture(), b = await fixture();
    await t.test("Authorization/CSRF protection and disconnected status without provider traffic", async () => {
      assert.equal((await request("/lazada/connection")).status, 401);
      assert.equal((await request("/lazada/oauth/authorize", a, "POST", { "X-CSRF-Token": "invalid" })).status, 403);
      const status = await (await request("/lazada/connection", a)).json();
      assert.equal(status.connected, false); assert.equal(status.configured, true);
      assert.equal((await calls()).length, 0);
    });
    await t.test("OAuth success, encrypted storage, safe DTOs and user isolation", async () => {
      const flow = await start(a);
      const wrongBrowser = await callback({ ...flow, cookie: "zetas_lazada_oauth=invalid" });
      assert.match(wrongBrowser.headers.get("location"), /authorization_failed/);
      assert.equal((await calls()).length, 0);
      assert.equal((await a.pool.query("SELECT count(*)::int AS n FROM lazada_oauth_states WHERE user_id=$1", [a.id])).rows[0].n, 1);
      const response = await callback(flow);
      assert.equal(response.status, 303);
      assert.equal(response.headers.get("location"), "/settings?lazada=connected");
      assert.equal(response.headers.get("referrer-policy"), "no-referrer");
      const { rows: [row] } = await a.pool.query("SELECT * FROM lazada_connections WHERE user_id=$1", [a.id]);
      assert.ok(row.encrypted_tokens.startsWith("v1."));
      assert.ok(!JSON.stringify(row).includes("test-only-access-token"));
      const status = await (await request("/lazada/connection", a)).json();
      assert.equal(status.connected, true);
      assert.deepEqual(Object.keys(status).sort(), ["callbackUri", "configured", "connected", "country", "expiresAt", "lastCheckedAt", "mode", "reason"].sort());
      assert.ok(!JSON.stringify(status).includes("token"));
      assert.equal((await (await request(`/lazada/connection?userId=${a.id}`, b)).json()).connected, false);
      const before = (await calls()).length;
      assert.match((await callback(flow)).headers.get("location"), /authorization_failed/);
      assert.equal((await calls()).length, before, "Replay must not exchange code twice");
    });
    await t.test("Manual check, revocation, provider outage, retry and permission failures", async () => {
      assert.equal((await request("/lazada/check", a, "POST")).status, 200);
      for (const control of ["revoked", "network", "permission"]) {
        await writeFile(controlFile, control);
        const response = await request("/lazada/check", a, "POST"); assert.ok(response.status >= 400);
        assert.ok(!(await response.text()).includes("test-only"));
        assert.equal((await (await request("/lazada/connection", a)).json()).connected, false);
        await writeFile(controlFile, "");
        assert.equal((await (await request("/lazada/check", a, "POST")).json()).connected, true);
      }
    });
    await t.test("Denied authorization, country mismatch and expired state install no tokens", async () => {
      for (const code of ["deny", "wrong-country"]) {
        const flow = await start(b); assert.ok(!(await callback(flow, code)).headers.get("location").endsWith("=connected"));
      }
      const denied = await start(b);
      assert.match((await callback(denied, "valid", "&error=access_denied")).headers.get("location"), /authorization_failed/);
      const expired = await start(b);
      await b.pool.query("UPDATE lazada_oauth_states SET expires_at=now()-interval '1 second' WHERE user_id=$1", [b.id]);
      const before = (await calls()).length; await callback(expired);
      assert.equal((await calls()).length, before);
      assert.equal((await b.pool.query("SELECT * FROM lazada_connections WHERE user_id=$1", [b.id])).rows.length, 0);
    });
    await t.test("Concurrent callbacks consume state once; expired access token requires reauthorization", async () => {
      const flow = await start(b); const before = (await calls()).filter(c => c.path === "/auth/token/create").length;
      const responses = await Promise.all([callback(flow), callback(flow)]);
      assert.equal(responses.filter(r => r.headers.get("location").endsWith("=connected")).length, 1);
      assert.equal((await calls()).filter(c => c.path === "/auth/token/create").length, before + 1);
      await b.pool.query("UPDATE lazada_connections SET expires_at=now()-interval '1 second' WHERE user_id=$1", [b.id]);
      assert.equal((await (await request("/lazada/connection", b)).json()).reason, "expired");
      assert.equal((await request("/lazada/check", b, "POST")).status, 409);
    });
    await t.test("Session revocation during provider exchange prevents installation", async () => {
      const f = await fixture(), flow = await start(f), before = (await calls()).length;
      const pending = callback(flow, "slow");
      for (let i = 0; i < 50 && (await calls()).length === before; i++) await delay(10);
      assert.ok((await calls()).length > before, "Provider exchange must have started before revocation");
      await f.pool.query("DELETE FROM auth_sessions WHERE user_id=$1", [f.id]);
      assert.match((await pending).headers.get("location"), /authorization_failed/);
      assert.equal((await f.pool.query("SELECT * FROM lazada_connections WHERE user_id=$1", [f.id])).rows.length, 0);
    });
    const allCalls = await calls();
    assert.ok(allCalls.every(c => c.path === "/auth/token/create" && c.method === "POST" || c.path === "/seller/get" && c.method === "GET"));
    assert.ok(logs.includes("providerCode") && logs.includes("InvalidCode"));
    assert.ok(logs.includes("providerMessage") && logs.includes("Invalid authorization code"));
    for (const sensitive of ["test-only-access-token", "test-only-refresh-token", env.LAZADA_APP_SECRET, "test-only-private-provider-detail"])
      assert.ok(!logs.includes(sensitive), "Logs must not contain secrets, provider details or tokens");
  } finally {
    child.kill("SIGTERM"); await exit;
    for (const f of fixtures) await f.cleanup();
  }
});
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import { pathToFileURL } from "node:url";
import { createAuthorizedFixture } from "./auth-helper.mjs";

const require = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const { build } = require("esbuild");
const temporary = await mkdtemp(`${tmpdir()}/zetas-lazada-im-`);
await build({
  entryPoints: [
    "artifacts/api-server/src/modules/lazada/security.ts",
    "artifacts/api-server/src/modules/lazada/client.ts",
    "artifacts/api-server/src/modules/lazada/im-client.ts",
  ],
  outdir: temporary,
  bundle: true,
  platform: "node",
  format: "esm",
  outExtension: { ".js": ".mjs" },
  logLevel: "silent",
});
const security = await import(pathToFileURL(`${temporary}/security.mjs`));
const { createImClient } = await import(pathToFileURL(`${temporary}/im-client.mjs`));
const { signature } = await import(pathToFileURL(`${temporary}/client.mjs`));
const env = {
  LAZADA_MODE: "testing",
  LAZADA_COUNTRY: "id",
  LAZADA_APP_KEY: "999000",
  LAZADA_APP_SECRET: "test-only-not-a-real-app-secret",
  LAZADA_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  LAZADA_REDIRECT_URI: "https://testing.example.invalid/api/lazada/oauth/callback",
  APP_ORIGIN: "https://testing.example.invalid",
};
const config = security.configuration(env);
test.after(async () => { await rm(temporary, { recursive: true, force: true }); });

test("IM client signs one HTTPS Indonesia GET with the existing Lazada signing helper", async () => {
  let receivedUrl;
  let receivedMethod;
  const client = createImClient(config, async (input, init) => {
    receivedUrl = new URL(String(input));
    receivedMethod = init.method;
    return new Response(JSON.stringify({ code: "0", data: {
      has_more: false, next_start_time: null, last_session_id: null, session_list: [],
    } }), { headers: { "Content-Type": "application/json" } });
  });
  const response = await client.getSessionList("test-only-im-access-token", {
    startTime: "1700000000000", pageSize: 20, cursor: "",
  });
  assert.equal(receivedUrl.origin, "https://api.lazada.co.id");
  assert.equal(receivedUrl.pathname, "/rest/im/session/list");
  assert.equal(receivedMethod, "GET");
  const params = Object.fromEntries(receivedUrl.searchParams);
  const sign = params.sign;
  delete params.sign;
  assert.equal(params.app_key, env.LAZADA_APP_KEY);
  assert.equal(params.access_token, "test-only-im-access-token");
  assert.equal(params.sign_method, "sha256");
  assert.equal(params.start_time, "1700000000000");
  assert.equal(params.page_size, "20");
  assert.equal(Object.hasOwn(params, "last_session_id"), false);
  assert.equal(sign, signature("/im/session/list", params, env.LAZADA_APP_SECRET));
  assert.deepEqual(response.session_list, []);
  assert.equal(response.has_more, false);
  assert.ok(!JSON.stringify(response).includes("test-only-im-access-token"));
});

test("IM client fails closed for permission, token, and malformed provider responses", async () => {
  const permission = createImClient(config, async () => new Response(JSON.stringify({ code: "PermissionDenied" })));
  await assert.rejects(permission.getSessionList("fixture-token", { startTime: "1700000000000", pageSize: 20 }),
    error => error.reason === "permission_denied");
  const token = createImClient(config, async () => new Response(JSON.stringify({ code: "InvalidAccessToken" })));
  await assert.rejects(token.getSessionList("fixture-token", { startTime: "1700000000000", pageSize: 20 }),
    error => error.reason === "authorization_failed");
  const malformed = createImClient(config, async () => new Response(JSON.stringify({
    code: "0", data: { has_more: true, next_start_time: null, last_session_id: null, session_list: "not-an-array" },
  })));
  await assert.rejects(malformed.getSessionList("fixture-token", { startTime: "1700000000000", pageSize: 20 }),
    error => error.reason === "invalid_response");
});

test("Lazada In-house IM Phase 1 routes are authenticated, isolated, validated and read-only", async t => {
  const reservation = http.createServer();
  await new Promise(resolve => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));

  const callsFile = `${temporary}/im-calls.jsonl`;
  const controlFile = `${temporary}/im-control`;
  await writeFile(callsFile, "");
  await writeFile(controlFile, "");
  let logs = "";
  const child = spawn(process.execPath, [
    "--import", "./tests/fixtures/lazada-provider.mjs", "artifacts/api-server/dist/index.mjs",
  ], {
    env: { ...process.env, ...env, PORT: String(port), NODE_ENV: "test",
      LAZADA_TEST_CALLS_FILE: callsFile, LAZADA_TEST_CONTROL_FILE: controlFile },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", data => { logs += data; });
  child.stderr.on("data", data => { logs += data; });
  const exit = once(child, "exit");
  const fixtures = [];
  const createFixture = async () => {
    const fixture = await createAuthorizedFixture();
    fixtures.push(fixture);
    return fixture;
  };
  const base = `http://127.0.0.1:${port}/api`;
  const request = (path, fixture) => fetch(`${base}${path}`, {
    headers: { "X-Forwarded-Proto": "https", ...(fixture ? { Cookie: fixture.cookie } : {}) },
  });
  const calls = async () => (await readFile(callsFile, "utf8")).trim().split("\n")
    .filter(Boolean).map(line => JSON.parse(line));
  const setControl = value => writeFile(controlFile, value);
  const addConnection = async (fixture, verified) => {
    const encryptedTokens = security.seal(JSON.stringify({
      accessToken: "test-only-im-access-token",
      refreshToken: "test-only-im-refresh-token",
    }), config, fixture.id);
    await fixture.pool.query(`INSERT INTO lazada_connections
      (user_id, encrypted_tokens, app_fingerprint, country, expires_at, refresh_expires_at, verified, checked_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [
      fixture.id, encryptedTokens, config.fingerprint, config.country,
      new Date(Date.now() + 3_600_000), new Date(Date.now() + 7_200_000), verified, new Date(),
    ]);
  };

  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        if ((await request("/healthz")).ok) { ready = true; break; }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(ready, "Disposable test API must start");
    const owner = await createFixture();
    const other = await createFixture();
    await addConnection(owner, "yes");
    await addConnection(other, "no");
    const firstPage = "/lazada/im/sessions?start_time=1700000000000&page_size=20";

    await t.test("Authentication, connection ownership and input validation", async () => {
      assert.equal((await request(firstPage)).status, 401);
      assert.equal((await request(firstPage, other)).status, 409, "unverified connection must fail closed");
      assert.equal((await request("/lazada/im/sessions?page_size=20", owner)).status, 400);
      assert.equal((await request("/lazada/im/sessions?start_time=1700000000000&page_size=21", owner)).status, 400);
      assert.equal((await request("/lazada/im/sessions?start_time=1&page_size=2&last_session_id=bad%20cursor", owner)).status, 400);
      assert.equal((await request("/lazada/im/sessions/bad%20id", owner)).status, 400);
      assert.equal((await calls()).length, 0, "invalid or unauthorized requests must not call Lazada");
    });

    await t.test("Empty page is valid and first page omits the pagination cursor", async () => {
      await setControl("im-empty");
      const emptyResponse = await request(firstPage, owner);
      assert.equal(emptyResponse.status, 200);
      assert.equal(emptyResponse.headers.get("cache-control"), "no-store");
      assert.deepEqual((await emptyResponse.json()).session_list, []);
      const call = (await calls()).at(-1);
      assert.equal(call.path, "/im/session/list");
      assert.equal(call.method, "GET");
      assert.equal(call.parameterNames.includes("last_session_id"), false);
    });

    await t.test("Session pagination, detail and message paging each use one read-only provider call", async () => {
      await setControl("");
      const pageResponse = await request(firstPage, owner);
      assert.equal(pageResponse.status, 200);
      const page = await pageResponse.json();
      assert.equal(page.has_more, true);
      assert.equal(page.next_start_time, "1700000001000");
      assert.equal(page.last_session_id, "fixture-session-1");
      assert.equal(page.session_list[0].session_id, "fixture-session-1");
      assert.equal(Object.hasOwn(page.session_list[0], "buyer_id"), false);
      assert.equal(Object.hasOwn(page.session_list[0], "head_url"), false);

      const nextPage = await request(
        "/lazada/im/sessions?start_time=1700000001000&page_size=20&last_session_id=fixture-session-1", owner,
      );
      assert.equal(nextPage.status, 200);
      assert.equal((await calls()).at(-1).parameterNames.includes("last_session_id"), true);

      const detail = await request("/lazada/im/sessions/fixture-session-1", owner);
      assert.equal(detail.status, 200);
      assert.equal((await detail.json()).session.content, "synthetic test summary");

      const messages = await request(
        "/lazada/im/sessions/fixture-session-1/messages?start_time=1700000001000&page_size=20&last_message_id=fixture-message-1",
        owner,
      );
      assert.equal(messages.status, 200);
      const messagePage = await messages.json();
      assert.equal(messagePage.message_list[0].message_id, "fixture-message-1");
      assert.equal(messagePage.message_list[0].content, "{\"txt\":\"synthetic test message\"}");
      assert.equal(Object.hasOwn(messagePage.message_list[0], "from_account_id"), false);
      const sent = await calls();
      assert.ok(sent.every(call => call.method === "GET"));
      assert.equal(sent.filter(call => call.path === "/im/session/list").length, 3);
      assert.equal(sent.filter(call => call.path === "/im/session/get").length, 1);
      assert.equal(sent.filter(call => call.path === "/im/message/list").length, 1);
    });

    await t.test("Provider permission and malformed-response errors are safe", async () => {
      await setControl("im-permission");
      const denied = await request(firstPage, owner);
      assert.equal(denied.status, 403);
      assert.ok(!(await denied.text()).includes("test-only-permission-detail"));
      await setControl("im-malformed");
      const malformed = await request(firstPage, owner);
      assert.equal(malformed.status, 502);
      assert.ok(!(await malformed.text()).includes("test-only"));
    });

    const persisted = await owner.pool.query(
      "SELECT verified, checked_at FROM lazada_connections WHERE user_id=$1", [owner.id],
    );
    assert.equal(persisted.rows[0].verified, "yes");
    const allCalls = await calls();
    assert.ok(allCalls.every(call => ["/im/session/list", "/im/session/get", "/im/message/list"].includes(call.path)));
    for (const sensitive of [
      "test-only-im-access-token", "test-only-im-refresh-token", env.LAZADA_APP_SECRET,
      "synthetic test message", "private-fixture-buyer-id",
    ]) assert.ok(!logs.includes(sensitive), `Logs must not contain ${sensitive}`);
  } finally {
    child.kill("SIGTERM");
    await exit;
    for (const fixture of fixtures) await fixture.cleanup();
  }
});

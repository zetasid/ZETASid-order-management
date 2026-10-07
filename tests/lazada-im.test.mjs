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
  LAZADA_IM_APP_KEY: "999001",
  LAZADA_IM_APP_SECRET: "test-only-im-app-secret",
  LAZADA_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  LAZADA_REDIRECT_URI: "https://testing.example.invalid/api/lazada/oauth/callback",
  APP_ORIGIN: "https://testing.example.invalid",
};
const sellerConfig = security.configuration(env);
const config = security.imConfiguration(env);
test.after(async () => { await rm(temporary, { recursive: true, force: true }); });

test("IM client accepts the IM success envelope without requiring code and signs one HTTPS Indonesia GET", async () => {
  let receivedUrl;
  let receivedMethod;
  const client = createImClient(config, async (input, init) => {
    receivedUrl = new URL(String(input));
    receivedMethod = init.method;
    return new Response(JSON.stringify({ success: true, err_code: "0", err_message: "SUCCESS",
      request_id: "fixture-request-id", data: {
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
  assert.equal(params.app_key, env.LAZADA_IM_APP_KEY);
  assert.notEqual(params.app_key, env.LAZADA_APP_KEY);
  assert.equal(params.access_token, "test-only-im-access-token");
  assert.equal(params.sign_method, "sha256");
  assert.equal(params.start_time, "1700000000000");
  assert.equal(params.page_size, "20");
  assert.equal(Object.hasOwn(params, "last_session_id"), false);
  assert.equal(sign, signature("/im/session/list", params, env.LAZADA_IM_APP_SECRET));
  assert.deepEqual(response.session_list, []);
  assert.equal(response.has_more, false);
  assert.ok(!JSON.stringify(response).includes("test-only-im-access-token"));
});

test("IM client fails closed for permission, token, and malformed provider responses", async () => {
  const permission = createImClient(config, async () => new Response(JSON.stringify({
    success: false, err_code: "PermissionDenied", err_message: "denied", data: null,
  })));
  await assert.rejects(permission.getSessionList("fixture-token", { startTime: "1700000000000", pageSize: 20 }),
    error => error.reason === "permission_denied");
  const token = createImClient(config, async () => new Response(JSON.stringify({
    success: false, err_code: "InvalidAccessToken", err_message: "invalid token", data: null,
  })));
  await assert.rejects(token.getSessionList("fixture-token", { startTime: "1700000000000", pageSize: 20 }),
    error => error.reason === "authorization_failed");
  const malformed = createImClient(config, async () => new Response(JSON.stringify({
    success: true, err_code: "0", err_message: "SUCCESS",
    data: { has_more: true, next_start_time: null, last_session_id: null, session_list: "not-an-array" },
  })));
  await assert.rejects(malformed.getSessionList("fixture-token", { startTime: "1700000000000", pageSize: 20 }),
    error => error.reason === "invalid_response");
  const codeOnly = createImClient(config, async () => new Response(JSON.stringify({
    code: "0", data: { has_more: false, session_list: [] },
  })));
  await assert.rejects(codeOnly.getSessionList("fixture-token", { startTime: "1700000000000", pageSize: 20 }),
    error => error.reason === "api_unavailable");
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
  const request = (path, fixture, method = "GET", extraHeaders = {}, redirect = "follow") => fetch(`${base}${path}`, {
    method,
    redirect,
    headers: { "X-Forwarded-Proto": "https", ...(fixture ? { Cookie: fixture.cookie } : {}), ...extraHeaders },
  });
  const calls = async () => (await readFile(callsFile, "utf8")).trim().split("\n")
    .filter(Boolean).map(line => JSON.parse(line));
  const setControl = value => writeFile(controlFile, value);
  const addSellerConnection = async fixture => {
    const encryptedTokens = security.seal(JSON.stringify({
      accessToken: "test-only-access-token",
      refreshToken: "test-only-refresh-token",
    }), sellerConfig, fixture.id);
    await fixture.pool.query(`INSERT INTO lazada_connections
      (user_id, encrypted_tokens, app_fingerprint, country, expires_at, refresh_expires_at, verified, checked_at)
      VALUES ($1, $2, $3, $4, $5, $6, 'yes', $7)`, [
      fixture.id, encryptedTokens, sellerConfig.fingerprint, sellerConfig.country,
      new Date(Date.now() + 3_600_000), new Date(Date.now() + 7_200_000), new Date(),
    ]);
  };
  const getSellerConnection = async fixture => {
    const { rows: [row] } = await fixture.pool.query(
      `SELECT encrypted_tokens, app_fingerprint, country, expires_at, refresh_expires_at, verified, checked_at
       FROM lazada_connections WHERE user_id=$1`,
      [fixture.id],
    );
    return row ?? null;
  };
  const getImConnection = async fixture => {
    const { rows: [row] } = await fixture.pool.query(
      `SELECT encrypted_tokens, app_fingerprint, country, expires_at, refresh_expires_at
       FROM lazada_im_connections WHERE user_id=$1`,
      [fixture.id],
    );
    return row ?? null;
  };
  const addImConnection = async fixture => {
    const encryptedTokens = security.seal(JSON.stringify({
      accessToken: "test-only-im-access-token",
      refreshToken: "test-only-im-refresh-token",
    }), config, fixture.id);
    await fixture.pool.query(`INSERT INTO lazada_im_connections
      (user_id, encrypted_tokens, app_fingerprint, country, expires_at, refresh_expires_at)
      VALUES ($1, $2, $3, $4, $5, $6)`, [
      fixture.id, encryptedTokens, config.fingerprint, config.country,
      new Date(Date.now() + 3_600_000), new Date(Date.now() + 7_200_000),
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
    const oauthUser = await createFixture();
    await addSellerConnection(owner);
    await addImConnection(owner);
    await addSellerConnection(oauthUser);
    const firstPage = "/lazada/im/sessions?page_size=20";

    await t.test("IM OAuth uses its own App Key, state, cookie and encrypted token row", async () => {
      const sellerBefore = await getSellerConnection(oauthUser);
      assert.ok(sellerBefore, "OAuth user already has an independent Seller connection");
      const sellerAuthorization = await request("/lazada/oauth/authorize", oauthUser, "POST", {
        Origin: env.APP_ORIGIN,
        "X-CSRF-Token": oauthUser.csrfToken,
      });
      assert.equal(sellerAuthorization.status, 200);
      const sellerCookieHeader = sellerAuthorization.headers.getSetCookie()
        .find(value => value.startsWith("zetas_lazada_oauth="));
      assert.ok(sellerCookieHeader);
      const sellerCookie = sellerCookieHeader.split(";")[0];
      const startFlow = async () => {
        const response = await request("/lazada/im/oauth/authorize", oauthUser, "POST", {
          Origin: env.APP_ORIGIN,
          "X-CSRF-Token": oauthUser.csrfToken,
        });
        assert.equal(response.status, 200);
        const authorization = await response.json();
        assert.ok(!JSON.stringify(authorization).includes(env.LAZADA_IM_APP_SECRET));
        const cookies = response.headers.getSetCookie();
        const cookieHeader = cookies.find(value => value.startsWith("zetas_lazada_im_oauth="));
        assert.ok(cookieHeader);
        assert.equal(cookies.some(value => value.startsWith("zetas_lazada_oauth=")), false,
          "IM authorization must not set the Seller OAuth cookie");
        assert.match(cookieHeader, /HttpOnly/);
        assert.match(cookieHeader, /Secure/);
        assert.match(cookieHeader, /SameSite=Lax/);
        const url = new URL(authorization.authorizationUrl);
        assert.equal(url.origin, "https://auth.lazada.com");
        assert.equal(url.searchParams.get("client_id"), env.LAZADA_IM_APP_KEY);
        assert.notEqual(url.searchParams.get("client_id"), env.LAZADA_APP_KEY);
        assert.equal(url.searchParams.get("redirect_uri"), env.LAZADA_REDIRECT_URI);
        const state = url.searchParams.get("state");
        assert.match(state, /^im_[A-Za-z0-9_-]{43}$/);
        return { state, flowCookie: cookieHeader.split(";")[0] };
      };
      const flow = await startFlow();

      const sellerStatesBeforeMisroute = (await oauthUser.pool.query(
        "SELECT count(*)::int AS n FROM lazada_oauth_states WHERE user_id=$1", [oauthUser.id],
      )).rows[0].n;
      const exchangesBeforeMisroute = (await calls()).filter(call => call.path === "/auth/token/create").length;
      const sellerCookieCallback = await request(
        `/lazada/oauth/callback?state=${flow.state}&code=valid`, null, "GET",
        { Cookie: sellerCookie }, "manual",
      );
      assert.equal(sellerCookieCallback.headers.get("location"), "/settings?lazada_im=authorization_failed",
        "IM state must dispatch to IM OAuth and reject a Seller-only cookie");
      assert.equal((await calls()).filter(call => call.path === "/auth/token/create").length, exchangesBeforeMisroute);
      assert.equal((await oauthUser.pool.query(
        "SELECT count(*)::int AS n FROM lazada_oauth_states WHERE user_id=$1", [oauthUser.id],
      )).rows[0].n, sellerStatesBeforeMisroute, "IM callback must not consume Seller OAuth state");

      const invalidState = `${flow.state.slice(0, -1)}${flow.state.endsWith("A") ? "B" : "A"}`;
      const exchangesBeforeInvalidState = (await calls()).filter(call => call.path === "/auth/token/create").length;
      const invalidCallback = await request(`/lazada/oauth/callback?state=${invalidState}&code=valid`, null, "GET", {
        Cookie: flow.flowCookie,
      }, "manual");
      assert.equal(invalidCallback.status, 303);
      assert.equal(invalidCallback.headers.get("location"), "/settings?lazada_im=authorization_failed");
      assert.equal((await calls()).filter(call => call.path === "/auth/token/create").length, exchangesBeforeInvalidState,
        "unknown IM state must not exchange a code through either OAuth flow");
      assert.equal(await getImConnection(oauthUser), null);
      assert.deepEqual(await getSellerConnection(oauthUser), sellerBefore);

      const callback = await request(`/lazada/oauth/callback?state=${flow.state}&code=valid`, null, "GET", {
        Cookie: flow.flowCookie,
      }, "manual");
      assert.equal(callback.status, 303);
      assert.equal(callback.headers.get("location"), "/settings?lazada_im=connected");
      assert.equal(callback.headers.get("referrer-policy"), "no-referrer");
      const row = await getImConnection(oauthUser);
      assert.ok(row.encrypted_tokens.startsWith("v1."));
      assert.ok(!JSON.stringify(row).includes("test-only-im-access-token"));
      assert.deepEqual(await getSellerConnection(oauthUser), sellerBefore,
        "IM callback must leave an existing Seller connection byte-for-byte unchanged");
      const status = await (await request("/lazada/im/connection", oauthUser)).json();
      assert.deepEqual(status, { configured: true, status: "connected", expiresAt: row.expires_at.toISOString() });
      assert.ok(!JSON.stringify(status).includes("test-only"));
      const callsBeforeReplay = (await calls()).filter(call => call.path === "/auth/token/create").length;
      assert.equal((await request(`/lazada/oauth/callback?state=${flow.state}&code=valid`, null, "GET", {
        Cookie: flow.flowCookie,
      }, "manual")).headers.get("location"), "/settings?lazada_im=authorization_failed");
      assert.equal((await calls()).filter(call => call.path === "/auth/token/create").length, callsBeforeReplay);
      assert.deepEqual(await getSellerConnection(oauthUser), sellerBefore);
      assert.deepEqual(await getImConnection(oauthUser), row, "replayed IM state must not alter the stored IM token");

      for (const [code, outcome] of [
        ["wrong-country", "wrong_country"],
        ["invalid-response", "authorization_failed"],
      ]) {
        const failedFlow = await startFlow();
        const imBefore = await getImConnection(oauthUser);
        const sellerBeforeFailure = await getSellerConnection(oauthUser);
        const exchangesBeforeFailure = (await calls()).filter(call => call.path === "/auth/token/create").length;
        const failed = await request(
          `/lazada/oauth/callback?state=${failedFlow.state}&code=${code}`, null, "GET",
          { Cookie: failedFlow.flowCookie }, "manual",
        );
        assert.equal(failed.status, 303);
        assert.equal(failed.headers.get("location"), `/settings?lazada_im=${outcome}`);
        assert.equal((await calls()).filter(call => call.path === "/auth/token/create").length, exchangesBeforeFailure + 1);
        assert.deepEqual(await getImConnection(oauthUser), imBefore,
          `${code} callback must not replace the existing IM connection`);
        assert.deepEqual(await getSellerConnection(oauthUser), sellerBeforeFailure,
          `${code} callback must not change the Seller connection`);
      }
    });

    await t.test("Authentication, connection ownership and input validation", async () => {
      assert.equal((await request(firstPage)).status, 401);
      assert.equal((await request(firstPage, other)).status, 409, "a user without an IM connection must fail closed");
      assert.deepEqual(await (await request("/lazada/im/connection", other)).json(), {
        configured: true, status: "not_connected", expiresAt: null,
      });
      const callsBeforeValidation = (await calls()).length;
      assert.equal((await request("/lazada/im/sessions?start_time=1700000000000&page_size=20", owner)).status, 400,
        "browser-supplied start_time must be rejected");
      assert.equal((await request("/lazada/im/sessions?start_time=1700000000000&page_size=21", owner)).status, 400);
      assert.equal((await request("/lazada/im/sessions?next_start_time=1700000000000&page_size=2", owner)).status, 400,
        "next page requires its cursor");
      assert.equal((await request("/lazada/im/sessions?page_size=2&last_session_id=fixture-session-1", owner)).status, 400,
        "cursor without next_start_time must be rejected");
      assert.equal((await request("/lazada/im/sessions?next_start_time=1&page_size=2&last_session_id=bad%20cursor", owner)).status, 400);
      assert.equal((await request("/lazada/im/sessions/bad%20id", owner)).status, 400);
      assert.equal((await calls()).length, callsBeforeValidation, "invalid or unauthorized requests must not call Lazada");
    });

    await t.test("Empty page is valid and first page omits the pagination cursor", async () => {
      await setControl("im-empty");
      const before = Date.now();
      const emptyResponse = await request(firstPage, owner);
      const after = Date.now();
      assert.equal(emptyResponse.status, 200);
      assert.equal(emptyResponse.headers.get("cache-control"), "no-store");
      assert.deepEqual((await emptyResponse.json()).session_list, []);
      const call = (await calls()).at(-1);
      assert.equal(call.path, "/im/session/list");
      assert.equal(call.method, "GET");
      assert.ok(Number(call.startTime) >= before && Number(call.startTime) <= after,
        "server must generate the first-page start_time");
      assert.equal(call.parameterNames.includes("last_session_id"), false);
    });

    await t.test("Session pagination, detail and message paging each use one read-only provider call", async () => {
      await setControl("");
      const firstPageBefore = Date.now();
      const pageResponse = await request(firstPage, owner);
      const firstPageAfter = Date.now();
      assert.equal(pageResponse.status, 200);
      const page = await pageResponse.json();
      assert.equal(page.has_more, true);
      assert.equal(page.next_start_time, "1700000001000");
      assert.equal(page.last_session_id, "fixture-session-1");
      assert.equal(page.session_list[0].session_id, "fixture-session-1");
      assert.equal(Object.hasOwn(page.session_list[0], "buyer_id"), false);
      assert.equal(Object.hasOwn(page.session_list[0], "head_url"), false);
      const firstSessionCall = (await calls()).filter(call => call.path === "/im/session/list").at(-1);
      assert.ok(Number(firstSessionCall.startTime) >= firstPageBefore
        && Number(firstSessionCall.startTime) <= firstPageAfter);

      const nextPage = await request(
        "/lazada/im/sessions?next_start_time=1700000001000&page_size=20&last_session_id=fixture-session-1", owner,
      );
      assert.equal(nextPage.status, 200);
      const nextSessionCall = (await calls()).filter(call => call.path === "/im/session/list").at(-1);
      assert.equal(nextSessionCall.startTime, "1700000001000");
      assert.equal(nextSessionCall.cursor, "fixture-session-1");

      const detail = await request("/lazada/im/sessions/fixture-session-1", owner);
      assert.equal(detail.status, 200);
      assert.equal((await detail.json()).session.content, "synthetic test summary");

      const firstMessagesBefore = Date.now();
      const firstMessages = await request(
        "/lazada/im/sessions/fixture-session-1/messages?page_size=20", owner,
      );
      const firstMessagesAfter = Date.now();
      assert.equal(firstMessages.status, 200);
      const firstMessageCall = (await calls()).filter(call => call.path === "/im/message/list").at(-1);
      assert.ok(Number(firstMessageCall.startTime) >= firstMessagesBefore
        && Number(firstMessageCall.startTime) <= firstMessagesAfter);
      assert.equal(firstMessageCall.cursor, null);

      const messages = await request(
        "/lazada/im/sessions/fixture-session-1/messages?next_start_time=1700000001000&page_size=20&last_message_id=fixture-message-1",
        owner,
      );
      assert.equal(messages.status, 200);
      const messagePage = await messages.json();
      assert.equal(messagePage.message_list[0].message_id, "fixture-message-1");
      assert.equal(messagePage.message_list[0].content, "{\"txt\":\"synthetic test message\"}");
      assert.equal(Object.hasOwn(messagePage.message_list[0], "from_account_id"), false);
      const nextMessageCall = (await calls()).filter(call => call.path === "/im/message/list").at(-1);
      assert.equal(nextMessageCall.startTime, "1700000001000");
      assert.equal(nextMessageCall.cursor, "fixture-message-1");
      const sent = await calls();
      assert.ok(sent.filter(call => call.path.startsWith("/im/")).every(call => call.method === "GET"));
      assert.ok(sent.filter(call => call.path === "/auth/token/create").every(call => call.method === "POST"));
      assert.equal(sent.filter(call => call.path === "/im/session/list").length, 3);
      assert.equal(sent.filter(call => call.path === "/im/session/get").length, 1);
      assert.equal(sent.filter(call => call.path === "/im/message/list").length, 2);
    });

    await t.test("Provider permission and malformed-response errors are safe", async () => {
      const sellerBefore = await getSellerConnection(owner);
      await setControl("im-permission");
      const denied = await request(firstPage, owner);
      assert.equal(denied.status, 403);
      assert.ok(!(await denied.text()).includes("test-only-permission-detail"));
      await setControl("im-malformed");
      const malformed = await request(firstPage, owner);
      assert.equal(malformed.status, 502);
      assert.ok(!(await malformed.text()).includes("test-only"));
      assert.deepEqual(await getSellerConnection(owner), sellerBefore,
        "malformed IM responses must not modify the Seller connection");
    });

    const allCalls = await calls();
    assert.ok(allCalls.every(call => ["/auth/token/create", "/im/session/list", "/im/session/get", "/im/message/list"].includes(call.path)));
    assert.ok(allCalls.filter(call => call.path.startsWith("/im/")).every(call =>
      call.appKey === env.LAZADA_IM_APP_KEY && call.tokenSource === "im"));
    assert.ok(allCalls.filter(call => call.path === "/auth/token/create").every(call =>
      call.appKey === env.LAZADA_IM_APP_KEY && call.tokenSource === null));
    for (const sensitive of [
      "test-only-im-access-token", "test-only-im-refresh-token", env.LAZADA_APP_SECRET, env.LAZADA_IM_APP_SECRET,
      "synthetic test message", "private-fixture-buyer-id",
    ]) assert.ok(!logs.includes(sensitive), `Logs must not contain ${sensitive}`);
  } finally {
    child.kill("SIGTERM");
    await exit;
    for (const fixture of fixtures) await fixture.cleanup();
  }
});

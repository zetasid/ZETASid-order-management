import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHmac, randomBytes } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import { pathToFileURL } from "node:url";
import { createAuthorizedFixture } from "./auth-helper.mjs";

const require = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const { build } = require("esbuild");
const express = require("express");
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
await build({
  stdin: {
    contents: `export { resolveImSessionUpdateUserId } from "./artifacts/api-server/src/modules/lazada/im-connection.ts";
      export { createLazadaImPushRouter } from "./artifacts/api-server/src/routes/lazada-im-push.ts";
      export { enqueueImSessionUpdate, parseImSessionUpdate, processNextImSessionSync,
        unavailableImPushVerifier, verifyImPushSignature } from "./artifacts/api-server/src/modules/lazada/im-push.ts";
      export { pool } from "./lib/db/src/index.ts";`,
    resolveDir: process.cwd(),
    sourcefile: "lazada-im-identity-test-loader.ts",
  },
  outfile: `${temporary}/im-connection-test.mjs`,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
});
const security = await import(pathToFileURL(`${temporary}/security.mjs`));
const { createImClient } = await import(pathToFileURL(`${temporary}/im-client.mjs`));
const { signature } = await import(pathToFileURL(`${temporary}/client.mjs`));
const {
  resolveImSessionUpdateUserId,
  createLazadaImPushRouter,
  enqueueImSessionUpdate,
  parseImSessionUpdate,
  processNextImSessionSync,
  unavailableImPushVerifier,
  verifyImPushSignature,
  pool: identityTestPool,
} =
  await import(pathToFileURL(`${temporary}/im-connection-test.mjs`));
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
const imPushSignature = raw => createHmac("sha256", env.LAZADA_IM_APP_SECRET)
  .update(env.LAZADA_IM_APP_KEY, "utf8")
  .update(Buffer.from(raw))
  .digest("hex");
test.after(async () => {
  await identityTestPool.end();
  await rm(temporary, { recursive: true, force: true });
});

test("IM push HMAC verifies exact raw bytes and requires lowercase hex Authorization", async () => {
  const raw = `{\n  "data":[{"sync_type":"SESSION_UPDATE","session_id":"100094063_2_1011822749_1_103"}],\n  "seller_id":"20240305",\n  "message_type":19\n}`;
  const authorization = imPushSignature(raw);
  assert.match(authorization, /^[0-9a-f]{64}$/);
  assert.equal(await verifyImPushSignature(Buffer.from(raw), { authorization }, config), "valid");
  assert.equal(await verifyImPushSignature(Buffer.from(`${raw} `), { authorization }, config), "invalid",
    "a signature for reserialized/different bytes must not validate");
  assert.equal(await verifyImPushSignature(Buffer.from(raw), {}, config), "invalid",
    "missing Authorization must fail closed");
  assert.equal(await verifyImPushSignature(Buffer.from(raw), {
    authorization: authorization.toUpperCase(),
  }, config), "invalid", "uppercase hex is outside the documented lowercase representation");
  assert.equal(await verifyImPushSignature(Buffer.from(raw), {
    authorization: "0".repeat(64),
  }, config), "invalid");
});

test("IM Session Update parser accepts the documented root plus data[] shape only", () => {
  const body = {
    data: [
      {
        sync_type: "SESSION_UPDATE",
        user_account_id: "100094063",
        user_account_type: 2,
        session_id: "100094063_2_1011822749_1_103",
        unread_count: 0,
        to_position: 1596550789323,
        self_position: 1596550789323,
        site_id: "SG",
      },
      {
        sync_type: "SESSION_UPDATE",
        session_id: "second-session",
      },
    ],
    seller_id: "20240305",
    message_type: 19,
  };
  assert.deepEqual(parseImSessionUpdate(Buffer.from(JSON.stringify(body))), {
    kind: "session_updates",
    events: [
      {
        message_type: 19,
        sync_type: "SESSION_UPDATE",
        seller_id: "20240305",
        session_id: "100094063_2_1011822749_1_103",
        unread_count: 0,
        site_id: "SG",
      },
      {
        message_type: 19,
        sync_type: "SESSION_UPDATE",
        seller_id: "20240305",
        session_id: "second-session",
      },
    ],
  });
  assert.equal(parseImSessionUpdate(Buffer.from("{ malformed")).kind, "invalid");
  assert.equal(parseImSessionUpdate(Buffer.from(JSON.stringify({
    ...body, seller_id: undefined,
  }))).kind, "invalid");
  assert.equal(parseImSessionUpdate(Buffer.from(JSON.stringify({
    ...body, data: [{ sync_type: "SESSION_UPDATE" }],
  }))).kind, "invalid");
  assert.equal(parseImSessionUpdate(Buffer.from(JSON.stringify({
    ...body, data: {},
  }))).kind, "invalid");
  assert.equal(parseImSessionUpdate(Buffer.from(JSON.stringify({
    ...body, message_type: 2,
  }))).kind, "unsupported");
  assert.equal(parseImSessionUpdate(Buffer.from(JSON.stringify({
    ...body, data: [{ sync_type: "OTHER", session_id: "ignored" }],
  }))).kind, "unsupported");
  const mixed = parseImSessionUpdate(Buffer.from(JSON.stringify({
    ...body,
    data: [
      { sync_type: "OTHER" },
      { sync_type: "SESSION_UPDATE", session_id: "supported-session" },
    ],
  })));
  assert.equal(mixed.kind, "session_updates");
  assert.deepEqual(mixed.events.map(event => event.session_id), ["supported-session"],
    "an unsupported item must not suppress a supported Session Update in the same data array");
  assert.equal(parseImSessionUpdate(Buffer.from(JSON.stringify({
    message_type: 19,
    seller_id: "20240305",
    sync_type: "SESSION_UPDATE",
    session_id: "root-only-session",
  }))).kind, "invalid", "root-only event fields are not the documented envelope");
});

test("default IM push router applies HMAC before parsing and queues the documented event", async () => {
  const raw = `{\n  "data":[{"sync_type":"SESSION_UPDATE","session_id":"fixture-session-1","unread_count":1}],\n  "seller_id":"20240305",\n  "message_type":19\n}`;
  const queued = [];
  let scheduleCount = 0;
  let downstreamFinished = false;
  let finishDownstream;
  const blockedDownstream = new Promise(resolve => {
    finishDownstream = () => {
      downstreamFinished = true;
      resolve();
    };
  });
  const app = express();
  app.set("trust proxy", 1);
  app.use("/api/lazada/im/push", createLazadaImPushRouter({
    getConfig: () => config,
    enqueueSessionUpdate: async (_config, event) => {
      queued.push(event);
      return { kind: "queued", userId: "fixture-user", sessionId: event.session_id };
    },
    scheduleProcessing: () => {
      scheduleCount += 1;
      return blockedDownstream;
    },
  }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/lazada/im/push`;
  const send = authorization => fetch(url, {
    method: "POST",
    headers: {
      "X-Forwarded-Proto": "https",
      "Content-Type": "application/json",
      ...(authorization === undefined ? {} : { Authorization: authorization }),
    },
    body: raw,
  });
  try {
    assert.equal((await send(undefined)).status, 401);
    assert.equal((await send("0".repeat(64))).status, 401);
    assert.equal(queued.length, 0);
    const ackStartedAt = Date.now();
    assert.equal((await send(imPushSignature(raw))).status, 200);
    assert.ok(Date.now() - ackStartedAt < 500, "valid callback ACK must stay within the provider budget");
    assert.deepEqual(queued, [{
      message_type: 19,
      sync_type: "SESSION_UPDATE",
      seller_id: "20240305",
      session_id: "fixture-session-1",
      unread_count: 1,
    }]);
    assert.equal(scheduleCount, 1);
    assert.equal(downstreamFinished, false, "ACK must not wait for downstream processing");
    finishDownstream();
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("IM webhook deadline returns 503 before a delayed durable enqueue and schedules only after it commits", async () => {
  const raw = `{"data":[{"sync_type":"SESSION_UPDATE","session_id":"fixture-delayed-session"}],"seller_id":"20240305","message_type":19}`;
  let finishEnqueue;
  let durable = false;
  let scheduleCount = 0;
  const app = express();
  app.set("trust proxy", 1);
  app.use("/api/lazada/im/push", createLazadaImPushRouter({
    getConfig: () => config,
    ackDeadlineMs: 30,
    enqueueSessionUpdate: () => new Promise(resolve => {
      finishEnqueue = () => {
        durable = true;
        resolve({ kind: "queued", userId: "fixture-user", sessionId: "fixture-delayed-session" });
      };
    }),
    scheduleProcessing: () => {
      assert.equal(durable, true, "worker may only be scheduled after durable enqueue completes");
      scheduleCount += 1;
    },
  }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/lazada/im/push`;
  try {
    const startedAt = Date.now();
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "X-Forwarded-Proto": "https",
        "Content-Type": "application/json",
        Authorization: imPushSignature(raw),
      },
      body: raw,
    });
    assert.equal(response.status, 503, "an unpersisted event must never receive HTTP 200");
    assert.ok(Date.now() - startedAt < 500, "slow queue writes must not exceed the callback deadline");
    assert.equal(durable, false);
    assert.equal(scheduleCount, 0);

    finishEnqueue();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(durable, true);
    assert.equal(scheduleCount, 1, "late durable work remains processable after the 503 retry response");
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

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

test("ReadSession posts the documented IDs as signed form data and accepts a success ACK without data", async () => {
  let receivedUrl;
  let receivedInit;
  const diagnostics = [];
  const client = createImClient(config, async (input, init) => {
    receivedUrl = new URL(String(input));
    receivedInit = init;
    return new Response(JSON.stringify({ success: true, err_code: "0", err_message: "SUCCESS" }), {
      headers: { "Content-Type": "application/json" },
    });
  }, { warn: (...args) => diagnostics.push(args) });
  const result = await client.readSession(
    "test-only-im-access-token",
    "fixture-session-1",
    "fixture-last-read-message-2",
  );

  assert.equal(result, undefined);
  assert.equal(receivedUrl.origin, "https://api.lazada.co.id");
  assert.equal(receivedUrl.pathname, "/rest/im/session/read");
  assert.equal(receivedUrl.search, "");
  assert.equal(receivedInit.method, "POST");
  assert.equal(receivedInit.headers["Content-Type"], "application/x-www-form-urlencoded");
  const params = Object.fromEntries(new URLSearchParams(receivedInit.body));
  const sign = params.sign;
  delete params.sign;
  assert.equal(params.app_key, env.LAZADA_IM_APP_KEY);
  assert.notEqual(params.app_key, env.LAZADA_APP_KEY);
  assert.equal(params.access_token, "test-only-im-access-token");
  assert.equal(params.sign_method, "sha256");
  assert.equal(params.session_id, "fixture-session-1");
  assert.equal(params.last_read_message_id, "fixture-last-read-message-2");
  assert.match(params.timestamp, /^\d+$/);
  assert.equal(sign, signature("/im/session/read", params, env.LAZADA_IM_APP_SECRET));
  assert.deepEqual(diagnostics, []);
});

test("ReadSession propagates provider errors and redacts request values from diagnostics", async () => {
  const token = "test-only-im-read-token";
  const secret = env.LAZADA_IM_APP_SECRET;
  const lastReadMessageId = "fixture-read-cursor";
  const diagnostics = [];
  const client = createImClient(config, async () => new Response(JSON.stringify({
    success: false,
    err_code: "PermissionDenied",
    err_message: `denied ${token} ${secret} ${lastReadMessageId}`,
  })), { warn: (...args) => diagnostics.push(args) });

  await assert.rejects(client.readSession(token, "fixture-session-2", lastReadMessageId),
    error => error.reason === "permission_denied");
  const logged = JSON.stringify(diagnostics);
  assert.ok(!logged.includes(token));
  assert.ok(!logged.includes(secret));
  assert.ok(!logged.includes(lastReadMessageId));
});

test("SendMessage posts template 1 text as signed form data and parses the documented result", async () => {
  let receivedUrl;
  let receivedInit;
  const client = createImClient(config, async (input, init) => {
    receivedUrl = new URL(String(input));
    receivedInit = init;
    return new Response(JSON.stringify({
      success: true,
      err_code: 0,
      err_message: "SUCCESS",
      data: { current_time: "1700000000000", message_id: "fixture-sent-message-3", template_id: 1 },
    }), { headers: { "Content-Type": "application/json" } });
  });
  const result = await client.sendMessage(
    "test-only-im-access-token",
    "fixture-session-3",
    "Synthetic test reply",
  );

  assert.equal(receivedUrl.origin, "https://api.lazada.co.id");
  assert.equal(receivedUrl.pathname, "/rest/im/message/send");
  assert.equal(receivedUrl.search, "");
  assert.equal(receivedInit.method, "POST");
  assert.equal(receivedInit.headers["Content-Type"], "application/x-www-form-urlencoded");
  const params = Object.fromEntries(new URLSearchParams(receivedInit.body));
  const sign = params.sign;
  delete params.sign;
  assert.equal(params.app_key, env.LAZADA_IM_APP_KEY);
  assert.notEqual(params.app_key, env.LAZADA_APP_KEY);
  assert.equal(params.access_token, "test-only-im-access-token");
  assert.equal(params.sign_method, "sha256");
  assert.equal(params.session_id, "fixture-session-3");
  assert.equal(params.template_id, "1");
  assert.equal(params.txt, "Synthetic test reply");
  assert.match(params.timestamp, /^\d+$/);
  assert.equal(sign, signature("/im/message/send", params, env.LAZADA_IM_APP_SECRET));
  assert.deepEqual(result, {
    current_time: "1700000000000",
    message_id: "fixture-sent-message-3",
    template_id: 1,
  });
});

test("SendMessage propagates provider errors without logging tokens, secrets, signatures or chat text", async () => {
  const token = "test-only-im-send-token";
  const secret = env.LAZADA_IM_APP_SECRET;
  const txt = "Synthetic private reply";
  const diagnostics = [];
  let requestSign;
  const client = createImClient(config, async (_input, init) => {
    requestSign = new URLSearchParams(init.body).get("sign");
    return new Response(JSON.stringify({
      success: false,
      err_code: "PermissionDenied",
      err_message: `denied ${token} ${secret} ${requestSign} ${txt}`,
    }));
  }, { warn: (...args) => diagnostics.push(args) });

  await assert.rejects(client.sendMessage(token, "fixture-session-4", txt),
    error => error.reason === "permission_denied");
  const logged = JSON.stringify(diagnostics);
  assert.ok(!logged.includes(token));
  assert.ok(!logged.includes(secret));
  assert.ok(!logged.includes(requestSign));
  assert.ok(!logged.includes(txt));
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
      `SELECT lazada_seller_id, encrypted_tokens, app_fingerprint, country, expires_at, refresh_expires_at
       FROM lazada_im_connections WHERE user_id=$1`,
      [fixture.id],
    );
    return row ?? null;
  };
  const addImConnection = async (fixture, { sellerId = null, connectionConfig = config } = {}) => {
    const encryptedTokens = security.seal(JSON.stringify({
      accessToken: "test-only-im-access-token",
      refreshToken: "test-only-im-refresh-token",
    }), connectionConfig, fixture.id);
    await fixture.pool.query(`INSERT INTO lazada_im_connections
      (user_id, lazada_seller_id, encrypted_tokens, app_fingerprint, country, expires_at, refresh_expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)`, [
      fixture.id, sellerId, encryptedTokens, connectionConfig.fingerprint, connectionConfig.country,
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
      const startFlow = async (target = oauthUser) => {
        const response = await request("/lazada/im/oauth/authorize", target, "POST", {
          Origin: env.APP_ORIGIN,
          "X-CSRF-Token": target.csrfToken,
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
      assert.equal(row.lazada_seller_id, "fixture-im-seller-1");
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

      const differentSellerFlow = await startFlow();
      const differentSellerCallback = await request(
        `/lazada/oauth/callback?state=${differentSellerFlow.state}&code=different-seller`, null, "GET",
        { Cookie: differentSellerFlow.flowCookie }, "manual",
      );
      assert.equal(differentSellerCallback.headers.get("location"), "/settings?lazada_im=authorization_failed");
      assert.deepEqual(await getImConnection(oauthUser), row,
        "reauthorizing a different seller must not overwrite the existing connection");

      const duplicateSellerFlow = await startFlow(other);
      const duplicateSellerCallback = await request(
        `/lazada/oauth/callback?state=${duplicateSellerFlow.state}&code=valid`, null, "GET",
        { Cookie: duplicateSellerFlow.flowCookie }, "manual",
      );
      assert.equal(duplicateSellerCallback.headers.get("location"), "/settings?lazada_im=authorization_failed");
      assert.equal(await getImConnection(other), null,
        "the same app-scoped seller cannot be claimed by a second ZETAS user");
      assert.deepEqual(await getImConnection(oauthUser), row,
        "a conflicting authorization must not alter the existing seller connection");

      for (const [code, outcome] of [
        ["wrong-country", "wrong_country"],
        ["invalid-response", "authorization_failed"],
        ["missing-seller-id", "invalid_response"],
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

    await t.test("Session Update identity maps only by seller ID within the IM app and country scope", async () => {
      const differentSellerUser = await createFixture();
      const differentScopeUser = await createFixture();
      const differentScopeConfig = security.imConfiguration({
        ...env,
        LAZADA_IM_APP_KEY: "999002",
        LAZADA_COUNTRY: "sg",
      });
      assert.ok(differentScopeConfig);
      await addImConnection(differentSellerUser, { sellerId: "fixture-im-seller-2" });
      await addImConnection(differentScopeUser, {
        sellerId: "fixture-im-seller-1",
        connectionConfig: differentScopeConfig,
      });

      const sessionUpdate = {
        message_type: 19,
        sync_type: "SESSION_UPDATE",
        seller_id: "fixture-im-seller-1",
        user_account_id: differentSellerUser.id,
        user_account_type: 1,
        session_id: "fixture-session-for-mapping",
        site_id: "lazada_id",
      };
      assert.equal(await resolveImSessionUpdateUserId(config, sessionUpdate), oauthUser.id,
        "seller_id selects the matching IM connection even if user_account_id names another ZETAS user");
      assert.equal(await resolveImSessionUpdateUserId(config, {
        ...sessionUpdate,
        seller_id: "unconnected-seller",
      }), null, "a different seller ID must not map to an existing connection");
      assert.equal(await resolveImSessionUpdateUserId(config, {
        ...sessionUpdate,
        seller_id: undefined,
      }), null, "missing seller_id must not fall back to user_account_id or session_id");
      assert.equal(await resolveImSessionUpdateUserId(config, {
        ...sessionUpdate,
        message_type: 2,
      }), null, "non-session-update events must not use this identity resolver");

      const sellerTwoEvent = {
        ...sessionUpdate,
        seller_id: "fixture-im-seller-2",
        user_account_id: oauthUser.id,
      };
      assert.equal(await resolveImSessionUpdateUserId(config, sellerTwoEvent), differentSellerUser.id,
        "distinct sellers owned by different ZETAS users must not be crossed");

      const sameSellerOtherScope = await resolveImSessionUpdateUserId(differentScopeConfig, {
        ...sessionUpdate,
        site_id: "lazada_sg",
      });
      assert.equal(sameSellerOtherScope, differentScopeUser.id,
        "the same provider seller ID is isolated by its separate app/country scope");

      assert.equal(await resolveImSessionUpdateUserId(config, {
        ...sessionUpdate,
        seller_id: null,
        user_account_id: owner.id,
      }), null, "a legacy connection with no seller ID is not selected by account/session IDs");
      assert.equal(await resolveImSessionUpdateUserId(config, {
        ...sessionUpdate,
        sync_type: "OTHER",
      }), null);
      assert.ok(!JSON.stringify(sellerTwoEvent).includes(env.LAZADA_IM_APP_SECRET));
    });

    await t.test("Public IM Session Update receiver verifies raw bytes and stores seller-scoped messages idempotently", async subtest => {
      const syncColumns = await identityTestPool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema=current_schema() AND table_name='lazada_im_sessions'
           AND column_name IN ('sync_requested_at','sync_request_version','sync_next_attempt_at',
                               'sync_attempts','sync_lease_until','sync_lease_token')`,
      );
      if (syncColumns.rows.length !== 6) {
        subtest.skip("the workspace development database has not yet received the additive IM sync migration");
        return;
      }
      const differentSellerUser = await createFixture();
      await addImConnection(differentSellerUser, { sellerId: "fixture-im-push-seller-2" });

      let authentication = "valid";
      const verifiedBodies = [];
      const messageFetches = [];
      const mockMessagePage = userId => ({
        has_more: false,
        next_start_time: null,
        last_message_id: `fixture-message-${userId}`,
        message_list: [{
          message_id: `fixture-message-${userId}`,
          content: "synthetic-only message",
          from_account_type: 1,
          to_account_type: 2,
          template_id: null,
          type: 1,
          status: "sent",
          auto_reply: false,
        }],
      });
      const pushApp = express();
      pushApp.set("trust proxy", 1);
      pushApp.use("/api/lazada/im/push", createLazadaImPushRouter({
        getConfig: () => config,
        verifySignature: async (rawBody, _headers, verifierConfig) => {
          assert.equal(Buffer.isBuffer(rawBody), true);
          assert.equal(verifierConfig.appKey, env.LAZADA_IM_APP_KEY);
          verifiedBodies.push(Buffer.from(rawBody));
          return authentication;
        },
        enqueueSessionUpdate: enqueueImSessionUpdate,
        scheduleProcessing: () => {},
      }));
      pushApp.use("/api/lazada/im/push-unconfigured", createLazadaImPushRouter({
        getConfig: () => config,
        verifySignature: unavailableImPushVerifier,
      }));
      const pushServer = http.createServer(pushApp);
      await new Promise(resolve => pushServer.listen(0, "127.0.0.1", resolve));
      const pushUrl = `http://127.0.0.1:${pushServer.address().port}/api/lazada/im/push`;
      const pushRequest = (body, raw = false) => fetch(pushUrl, {
        method: "POST",
        headers: {
          "X-Forwarded-Proto": "https",
          "Content-Type": "application/json",
        },
        body: raw ? body : JSON.stringify(body),
      });
      const sharedSessionId = "fixture-session-shared-across-sellers";
      const sellerOneEvent = {
        message_type: 19,
        seller_id: "fixture-im-seller-1",
        data: [{
          sync_type: "SESSION_UPDATE",
          session_id: sharedSessionId,
          unread_count: 2,
          site_id: "lazada_id",
          user_account_id: differentSellerUser.id,
        }],
      };

      try {
        const rawFirstEvent = `{\n  "message_type":19,\n  "seller_id":"fixture-im-seller-1",\n  "data":[{"sync_type":"SESSION_UPDATE","session_id":"${sharedSessionId}","unread_count":2,"site_id":"lazada_id","user_account_id":"${differentSellerUser.id}"}]\n}`;
        const firstResponse = await pushRequest(rawFirstEvent, true);
        assert.equal(firstResponse.status, 200);
        assert.equal(await firstResponse.text(), "", "webhook response must not return chat data");
        assert.equal(verifiedBodies.at(-1).toString("utf8"), rawFirstEvent,
          "signature adapter must receive the original raw bytes, not reserialized JSON");
        assert.equal(messageFetches.length, 0, "ACK must not wait for the Lazada message API");

        const duplicateResponse = await pushRequest(sellerOneEvent);
        assert.equal(duplicateResponse.status, 200);
        const firstSellerSession = await oauthUser.pool.query(
          `SELECT id, unread_count, site_id, sync_requested_at, sync_request_version
           FROM lazada_im_sessions WHERE user_id=$1 AND lazada_session_id=$2`,
          [oauthUser.id, sharedSessionId],
        );
        assert.equal(firstSellerSession.rows.length, 1, "duplicate event must not duplicate the session");
        assert.equal(firstSellerSession.rows[0].unread_count, 2);
        assert.ok(firstSellerSession.rows[0].sync_requested_at, "event must be durably queued before ACK");
        assert.equal(firstSellerSession.rows[0].sync_request_version, 2,
          "duplicate events coalesce into the existing session row");

        const sellerTwoResponse = await pushRequest({
          ...sellerOneEvent,
          seller_id: "fixture-im-push-seller-2",
          data: [{
            ...sellerOneEvent.data[0],
            user_account_id: oauthUser.id,
          }],
        });
        assert.equal(sellerTwoResponse.status, 200);
        const secondSellerSession = await differentSellerUser.pool.query(
          "SELECT id, sync_requested_at FROM lazada_im_sessions WHERE user_id=$1 AND lazada_session_id=$2",
          [differentSellerUser.id, sharedSessionId],
        );
        assert.equal(secondSellerSession.rows.length, 1);

        const mockFetchMessages = async (userId, sessionId, input) => {
          messageFetches.push({ userId, sessionId, input });
          assert.match(input.startTime, /^\d+$/);
          assert.equal(input.pageSize, 20);
          assert.equal(input.cursor, undefined);
          return mockMessagePage(userId);
        };
        const workerResults = [
          await processNextImSessionSync(mockFetchMessages),
          await processNextImSessionSync(mockFetchMessages),
        ];
        const processedResults = workerResults.filter(result => result.kind === "processed");
        assert.equal(processedResults.length, 2);
        assert.deepEqual(new Set(processedResults.map(result => result.userId)),
          new Set([oauthUser.id, differentSellerUser.id]),
          "each queued job must use only its seller-mapped ZETAS connection");
        assert.equal(messageFetches.length, 2);
        assert.ok(messageFetches.every(call => call.sessionId === sharedSessionId));

        const firstSellerMessages = await oauthUser.pool.query(
          "SELECT count(*)::int AS count FROM lazada_im_messages WHERE session_id=$1",
          [firstSellerSession.rows[0].id],
        );
        assert.equal(firstSellerMessages.rows[0].count, 1,
          "existing session/message unique keys make message persistence idempotent");
        const secondSellerMessages = await differentSellerUser.pool.query(
          "SELECT count(*)::int AS count FROM lazada_im_messages WHERE session_id=$1",
          [secondSellerSession.rows[0].id],
        );
        assert.equal(secondSellerMessages.rows[0].count, 1);
        const pendingRows = await oauthUser.pool.query(
          `SELECT count(*)::int AS count FROM lazada_im_sessions
           WHERE user_id=$1 AND lazada_session_id=$2 AND sync_requested_at IS NOT NULL`,
          [oauthUser.id, sharedSessionId],
        );
        assert.equal(pendingRows.rows[0].count, 0, "successful processing clears only the completed request");
        assert.equal((await processNextImSessionSync()).kind, "empty");

        const fetchesBeforeRejects = messageFetches.length;
        assert.equal((await pushRequest({ ...sellerOneEvent, seller_id: "unconnected-seller" })).status, 404);
        assert.equal((await pushRequest({ ...sellerOneEvent, seller_id: undefined })).status, 400);
        authentication = "invalid";
        assert.equal((await pushRequest(sellerOneEvent)).status, 401);
        authentication = "unavailable";
        assert.equal((await pushRequest(sellerOneEvent)).status, 503);
        authentication = "valid";
        assert.equal((await pushRequest({ ...sellerOneEvent, message_type: 2 })).status, 200);
        assert.equal((await pushRequest({
          ...sellerOneEvent,
          data: [{ ...sellerOneEvent.data[0], sync_type: "OTHER" }],
        })).status, 200);
        assert.equal((await pushRequest("{ malformed", true)).status, 400);
        const failClosed = await fetch(`${pushUrl}-unconfigured`, {
          method: "POST",
          headers: { "X-Forwarded-Proto": "https", "Content-Type": "application/json" },
          body: JSON.stringify(sellerOneEvent),
        });
        assert.equal(failClosed.status, 503,
          "an unavailable verifier must fail closed");
        assert.equal(messageFetches.length, fetchesBeforeRejects,
          "invalid, unmapped and unsupported callbacks must not call GetMessages");
        assert.ok(verifiedBodies.length >= 10);
        assert.ok(!verifiedBodies.some(body => body.toString("utf8").includes(env.LAZADA_IM_APP_SECRET)));
      } finally {
        await new Promise(resolve => pushServer.close(resolve));
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
      await setControl("im-invalid-session-item");
      const invalidSession = await request(firstPage, owner);
      assert.equal(invalidSession.status, 502);
      const diagnosticLine = logs.split("\n")
        .find(line => line.includes("Lazada IM session item validation diagnostic"));
      assert.ok(diagnosticLine, "an invalid session item must emit field-level diagnostics");
      const diagnostic = JSON.parse(diagnosticLine);
      assert.equal(diagnostic.itemIndex, 1, "diagnostics must identify a failing item beyond the first");
      assert.deepEqual(diagnostic.failedValidators, [{ field: "unread_count", validator: "optionalNumber" }]);
      const unreadCountDiagnostic = diagnostic.fields.find(field => field.field === "unread_count");
      assert.deepEqual(unreadCountDiagnostic, {
        field: "unread_count", valueType: "string", isNull: false, isUndefined: false,
      });
      for (const sensitive of [
        "fixture-session-id-must-not-be-logged",
        "fixture-summary-must-not-be-logged",
        "fixture-private-value-must-not-be-logged",
      ]) assert.ok(!logs.includes(sensitive), "field-level diagnostics must not include field values");
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
      "synthetic test message", "private-fixture-buyer-id", "Synthetic private reply",
      "fixture-im-seller-1", "fixture-im-seller-2",
    ]) assert.ok(!logs.includes(sensitive), `Logs must not contain ${sensitive}`);
  } finally {
    child.kill("SIGTERM");
    await exit;
    for (const fixture of fixtures) await fixture.cleanup();
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const require = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const { build } = require("esbuild");
const temporary = await mkdtemp(`${tmpdir()}/zetas-oauth-diagnostics-`);
await build({
  entryPoints: [
    "artifacts/api-server/src/modules/lazada/im-oauth-diagnostics.ts",
    "artifacts/api-server/src/modules/lazada/security.ts",
  ],
  outdir: temporary,
  bundle: true,
  platform: "node",
  format: "esm",
  outExtension: { ".js": ".mjs" },
  logLevel: "silent",
});
await build({
  entryPoints: ["artifacts/api-server/src/modules/lazada/client.ts"],
  outfile: `${temporary}/client.cjs`,
  bundle: true,
  platform: "node",
  format: "cjs",
  logLevel: "silent",
});
const { dispatchLazadaOAuthCallback, logImOAuthDiagnostic, sanitizeImOAuthProviderIdentifier } =
  await import(pathToFileURL(`${temporary}/im-oauth-diagnostics.mjs`));
const { createClient } = require(`${temporary}/client.cjs`);
const { imConfiguration } = await import(pathToFileURL(`${temporary}/security.mjs`));

test.after(async () => rm(temporary, { recursive: true, force: true }));

test("callback dispatch sends every im_ state only to the IM handler", () => {
  const calls = [];
  const handlers = {
    im: () => calls.push("im"),
    seller: () => calls.push("seller"),
  };
  dispatchLazadaOAuthCallback("im_invalid-state", handlers.im, handlers.seller);
  assert.deepEqual(calls, ["im"]);
  calls.length = 0;
  dispatchLazadaOAuthCallback(`im_${"a".repeat(43)}`, handlers.im, handlers.seller);
  assert.deepEqual(calls, ["im"]);
  calls.length = 0;
  dispatchLazadaOAuthCallback("seller-state-fixture", handlers.im, handlers.seller);
  assert.deepEqual(calls, ["seller"]);
});

test("IM OAuth diagnostic records use one correlation ID and only allowlisted metadata", () => {
  const records = [];
  const logger = { info: (fields, message) => records.push({ ...fields, message }) };
  const correlationId = "8e32c5a0-8f18-4e74-9b8d-8e18a0d78b21";
  const stages = [
    ["callback_received", "started"],
    ["callback_validation", "succeeded"],
    ["state_cookie", "failed", "state_not_found_expired_or_used"],
    ["authorization_code", "failed", "code_missing_or_rejected"],
    ["session_check", "failed", "session_inactive"],
    ["token_exchange", "failed", "network_error"],
    ["token_exchange", "failed", "provider_response_error"],
    ["token_exchange", "failed", "invalid_provider_response"],
    ["token_exchange", "failed", "local_failure"],
    ["token_validation", "failed", "invalid_token_response"],
    ["seller_validation", "failed", "seller_identity_invalid"],
    ["connection_storage", "failed", "storage_error"],
    ["callback_complete", "failed"],
  ];
  for (const [stage, result, category] of stages)
    logImOAuthDiagnostic(logger, correlationId, stage, result, category);

  assert.equal(records.length, stages.length);
  assert.ok(records.every(record => record.correlationId === correlationId));
  assert.deepEqual(records.map(record => [
    record.stage, record.result, ...(record.category ? [record.category] : []),
  ]), stages);
  for (const record of records) {
    assert.deepEqual(Object.keys(record).sort(),
      ["category", "correlationId", "message", "result", "stage"].filter(key => key in record).sort());
  }
  const beforeInvalid = records.length;
  logImOAuthDiagnostic(logger, "synthetic-secret", "callback_received", "started");
  logImOAuthDiagnostic(logger, correlationId, "callback_received", "started", undefined, {
    httpStatus: 999,
    providerCode: "synthetic-secret",
    providerRequestId: "https://private.example.invalid/",
  });
  assert.equal(records.length, beforeInvalid + 1);
  assert.equal(records.at(-1).httpStatus, undefined);
  assert.equal(records.at(-1).providerCode, "[redacted]");
  assert.equal(records.at(-1).providerRequestId, "[redacted]");
  for (const [value, maxLength] of [
    ["", 64],
    ["x".repeat(65), 64],
    ["bad value", 64],
    ["token-like-value", 64],
    ["secret-like-value", 64],
    ["cookie-state-value", 96],
    ["customer@example.invalid", 96],
  ]) assert.equal(sanitizeImOAuthProviderIdentifier(value, maxLength), "[redacted]");
  assert.equal(sanitizeImOAuthProviderIdentifier("E_PROVIDER_1", 64), "E_PROVIDER_1");
  const serialized = JSON.stringify(records);
  for (const sensitive of ["synthetic-code", "synthetic-state", "synthetic-cookie",
    "synthetic-access-token", "synthetic-refresh-token", "synthetic-secret", "synthetic-seller-id"])
    assert.ok(!serialized.includes(sensitive));

  assert.doesNotThrow(() => logImOAuthDiagnostic({ info() { throw new Error("sink failure"); } },
    correlationId, "callback_received", "started"));
});

test("mocked token exchange distinguishes network, provider, invalid response and success safely", async () => {
  const config = imConfiguration({
    LAZADA_MODE: "testing",
    LAZADA_COUNTRY: "id",
    LAZADA_IM_APP_KEY: "999001",
    LAZADA_IM_APP_SECRET: "synthetic-app-secret",
    LAZADA_TOKEN_ENCRYPTION_KEY: "a".repeat(64),
    LAZADA_REDIRECT_URI: "https://testing.example.invalid/api/lazada/oauth/callback",
    APP_ORIGIN: "https://testing.example.invalid",
  });
  assert.ok(config);
  const makeRun = (transport) => {
    const diagnostics = [];
    const warnings = [];
    const diagnostic = (stage, result, category, details) => logImOAuthDiagnostic(
      { info: (fields, message) => diagnostics.push({ ...fields, message }) },
      "8e32c5a0-8f18-4e74-9b8d-8e18a0d78b21", stage, result, category, details);
    return {
      diagnostics,
      warnings,
      exchange: () => createClient(config, transport, undefined,
        { warn: fields => warnings.push(fields) }, diagnostic).exchange("synthetic-code"),
    };
  };

  const network = makeRun(async () => { throw new Error("synthetic-app-secret synthetic-code"); });
  await assert.rejects(network.exchange(), error => error.reason === "api_unavailable");
  assert.ok(network.diagnostics.some(record =>
    record.category === "network_error" && record.stage === "token_exchange"));

  const provider = makeRun(async () => new Response(JSON.stringify({
    code: "E_PROVIDER_1", message: "synthetic-access-token synthetic-app-secret",
    request_id: "req-test-123",
  }), { status: 400 }));
  await assert.rejects(provider.exchange(), error => error.reason === "api_unavailable");
  const providerFailure = provider.diagnostics.find(record => record.category === "provider_response_error");
  assert.equal(providerFailure.httpStatus, "400");
  assert.equal(providerFailure.providerCode, "E_PROVIDER_1");
  assert.equal(providerFailure.providerRequestId, "req-test-123");
  assert.ok(!JSON.stringify(provider).includes("synthetic-access-token"));
  assert.ok(!JSON.stringify(provider.warnings).includes("synthetic-app-secret"));
  assert.ok(!JSON.stringify(provider.warnings).includes("synthetic-code"));

  const sensitiveProviderFields = makeRun(async () => new Response(JSON.stringify({
    code: "synthetic-secret-token", message: "synthetic raw sensitive response",
    request_id: "synthetic-cookie-state-value",
  }), { status: 400 }));
  await assert.rejects(sensitiveProviderFields.exchange(), error => error.reason === "api_unavailable");
  const safeProviderFailure = sensitiveProviderFields.diagnostics.find(
    record => record.category === "provider_response_error");
  assert.equal(safeProviderFailure.providerCode, "[redacted]");
  assert.equal(safeProviderFailure.providerRequestId, "[redacted]");
  assert.ok(!JSON.stringify(sensitiveProviderFields).includes("synthetic-secret-token"));
  assert.ok(!JSON.stringify(sensitiveProviderFields).includes("synthetic-cookie-state-value"));
  assert.ok(!JSON.stringify(sensitiveProviderFields).includes("synthetic raw sensitive response"));

  const malformed = makeRun(async () => new Response("not-json", { status: 200 }));
  await assert.rejects(malformed.exchange(), error => error.reason === "api_unavailable");
  assert.ok(malformed.diagnostics.some(record => record.category === "invalid_provider_response"));

  const invalidToken = makeRun(async () => new Response(JSON.stringify({
    code: "0", access_token: "", refresh_token: "synthetic-refresh-token",
    expires_in: 3600, refresh_expires_in: 7200, country: "id",
    country_user_info: [{ country: "id", seller_id: "synthetic-seller-id" }],
  }), { status: 200 }));
  await assert.rejects(invalidToken.exchange(), error => error.reason === "authorization_failed");
  assert.ok(invalidToken.diagnostics.some(record =>
    record.stage === "token_validation" && record.category === "invalid_token_response"));

  const wrongCountry = makeRun(async () => new Response(JSON.stringify({
    code: "0", access_token: "synthetic-access-token", refresh_token: "synthetic-refresh-token",
    expires_in: 3600, refresh_expires_in: 7200, country: "sg",
    country_user_info: [{ country: "sg", seller_id: "synthetic-seller-id" }],
  }), { status: 200 }));
  await assert.rejects(wrongCountry.exchange(), error => error.reason === "wrong_country");
  assert.ok(wrongCountry.diagnostics.some(record =>
    record.stage === "token_validation" && record.category === "wrong_country"));

  const success = makeRun(async () => new Response(JSON.stringify({
    code: "0", access_token: "synthetic-access-token", refresh_token: "synthetic-refresh-token",
    expires_in: 3600, refresh_expires_in: 7200, country: "id",
    country_user_info: [{ country: "id", seller_id: "synthetic-seller-id" }],
  }), { status: 200 }));
  await success.exchange();
  assert.ok(success.diagnostics.some(record =>
    record.stage === "token_exchange" && record.result === "succeeded" && record.httpStatus === "200"));
  assert.ok(!JSON.stringify(success.diagnostics).includes("synthetic-access-token"));
  assert.ok(!JSON.stringify(success.diagnostics).includes("synthetic-seller-id"));
});

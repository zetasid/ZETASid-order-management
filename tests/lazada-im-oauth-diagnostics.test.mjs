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
  entryPoints: ["artifacts/api-server/src/modules/lazada/im-oauth-diagnostics.ts"],
  outdir: temporary,
  bundle: true,
  platform: "node",
  format: "esm",
  outExtension: { ".js": ".mjs" },
  logLevel: "silent",
});
const { logImOAuthDiagnostic } = await import(pathToFileURL(`${temporary}/im-oauth-diagnostics.mjs`));

test.after(async () => rm(temporary, { recursive: true, force: true }));

test("IM OAuth diagnostic records use one correlation ID and only allowlisted metadata", () => {
  const records = [];
  const logger = { info: (fields, message) => records.push({ ...fields, message }) };
  const correlationId = "request-fixture-7f6c";
  const stages = [
    ["callback_received", "started"],
    ["callback_validation", "succeeded"],
    ["state_cookie", "failed", "state_not_found_expired_or_used"],
    ["authorization_code", "failed", "code_missing_or_rejected"],
    ["session_check", "failed", "session_inactive"],
    ["token_exchange", "failed", "provider_or_transport_error"],
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
  const serialized = JSON.stringify(records);
  for (const sensitive of ["synthetic-code", "synthetic-state", "synthetic-cookie",
    "synthetic-access-token", "synthetic-refresh-token", "synthetic-secret", "synthetic-seller-id"])
    assert.ok(!serialized.includes(sensitive));

  assert.doesNotThrow(() => logImOAuthDiagnostic({ info() { throw new Error("sink failure"); } },
    correlationId, "callback_received", "started"));
});

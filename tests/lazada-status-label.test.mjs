import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const require = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const { build } = require("esbuild");
const dir = await mkdtemp(`${tmpdir()}/zetas-status-label-`);
await build({
  entryPoints: ["artifacts/zetas-id/src/lib/lazada-status-label.ts"],
  outfile: `${dir}/status-label.mjs`,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
});
const { isKnownLazadaStatus, lazadaStatusLabel, lazadaStatusesLabel } =
  await import(pathToFileURL(`${dir}/status-label.mjs`));
test.after(async () => { await rm(dir, { recursive: true, force: true }); });

test("Lazada workflow labels follow raw item status and keep payment separate", () => {
  assert.equal(lazadaStatusLabel("pending", "pending"), "Belum Dibayar");
  assert.equal(lazadaStatusLabel("pending", "confirmed"), "Menunggu Proses");
  assert.equal(lazadaStatusLabel("pending", "unknown"), "Status tidak diketahui");
  assert.equal(lazadaStatusLabel("packed", "pending"), "Dikemas");
  assert.equal(lazadaStatusLabel("to_pack", "pending"), "Dikemas");
  assert.equal(lazadaStatusLabel("ready_to_ship", "confirmed"), "Dikemas");
  assert.equal(lazadaStatusLabel("shipped", "confirmed"), "Dikirim");
  assert.equal(lazadaStatusLabel("to_ship", "confirmed"), "Dikirim");
  assert.equal(lazadaStatusLabel("delivered", "confirmed"), "Selesai");
  assert.equal(lazadaStatusLabel("cancelled", "pending"), "Dibatalkan");
  assert.equal(lazadaStatusesLabel(["packed", "ready_to_ship"], "pending"), "Dikemas");
  assert.equal(lazadaStatusesLabel(["packed", "shipped"], "pending"), "Dikemas, Dikirim");
  assert.equal(lazadaStatusesLabel(["future_status"], "unknown"), "future_status");
  assert.equal(isKnownLazadaStatus("future_status"), false);
});

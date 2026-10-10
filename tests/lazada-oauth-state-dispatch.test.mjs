import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const require = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const express = require("express");
const { build } = require("esbuild");
const temporary = await mkdtemp(`${tmpdir()}/zetas-oauth-dispatch-`);
await build({
  entryPoints: ["artifacts/api-server/src/modules/lazada/oauth-state-dispatch.ts"],
  outdir: temporary,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
});
const { resolveLazadaOAuthFlow } = await import(pathToFileURL(`${temporary}/oauth-state-dispatch.js`));
after(() => rm(temporary, { recursive: true, force: true }));

const sellerOld = `im_${"s".repeat(43)}`;
const sellerNew = `seller1_${"s".repeat(43)}`;
const imOld = `im_${"i".repeat(43)}`;
const imNew = `im1_${"i".repeat(43)}`;

async function withHttpHarness(records, options = {}) {
  const calls = [];
  const claimed = new Set();
  const rejectedClaims = options.rejectedClaims ?? new Set();
  const app = express();
  app.set("trust proxy", true);
  app.get("/api/lazada/oauth/callback", async (req, res) => {
    if (!req.secure || options.configured === false) return res.redirect(303, "/settings");
    const flow = await resolveLazadaOAuthFlow(req.query.state, async state => records.get(state) ?? {
      seller: false, im: false,
    });
    if (flow !== "seller" && flow !== "im") return res.redirect(303, "/settings");
    calls.push(flow);
    const cookieName = flow === "im" ? "zetas_lazada_im_oauth" : "zetas_lazada_oauth";
    const expectedCookie = flow === "im" ? "im-cookie" : "seller-cookie";
    const cookie = req.get("cookie") ?? "";
    const validCookie = cookie.split("; ").includes(`${cookieName}=${expectedCookie}`);
    if (!validCookie) {
      res.clearCookie(cookieName, { path: "/api/lazada/oauth/callback" });
      return res.redirect(303, `/settings?lazada_${flow}=authorization_failed`);
    }
    // Simulate the existing single-use handler claim; lookup above is read-only.
    if (claimed.has(req.query.state) || rejectedClaims.has(req.query.state)) {
      res.clearCookie(cookieName, { path: "/api/lazada/oauth/callback" });
      return res.redirect(303, `/settings?lazada_${flow}=authorization_failed`);
    }
    claimed.add(req.query.state);
    res.clearCookie(cookieName, { path: "/api/lazada/oauth/callback" });
    return res.redirect(303, `/settings?lazada_${flow}=connected`);
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const { port } = server.address();
  const request = (state, cookie, headers = {}) => fetch(`http://127.0.0.1:${port}/api/lazada/oauth/callback?state=${encodeURIComponent(state)}`, {
    redirect: "manual",
    headers: { "x-forwarded-proto": "https", ...(cookie ? { cookie } : {}), ...headers },
  });
  return { calls, request, close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

test("mocked Express callback routes legacy and namespaced seller/IM states without cross-handler fallback", async () => {
  const records = new Map([
    [sellerOld, { seller: true, im: false }],
    [imOld, { seller: false, im: true }],
  ]);
  const harness = await withHttpHarness(records);
  try {
    for (const [state, flow] of [[sellerOld, "seller"], [sellerNew, "seller"], [imOld, "im"], [imNew, "im"]]) {
      const cookieName = flow === "im" ? "zetas_lazada_im_oauth" : "zetas_lazada_oauth";
      const response = await harness.request(state, `${cookieName}=${flow}-cookie`);
      // Exercise the route with the correctly bound synthetic browser cookie.
      assert.equal(response.status, 303);
      assert.equal(response.headers.get("location"), `/settings?lazada_${flow}=connected`);
    }
    assert.deepEqual(harness.calls, ["seller", "seller", "im", "im"]);
  } finally { await harness.close(); }
});

test("unknown, expired/used, and dual-table states fail closed; cookie failures stay in selected flow", async () => {
  const expired = `seller1_${"e".repeat(43)}`;
  const alreadyUsed = `im1_${"u".repeat(43)}`;
  const records = new Map([
    [expired, { seller: true, im: false }],
    [alreadyUsed, { seller: false, im: true }],
    ["ambiguous-state", { seller: true, im: true }],
  ]);
  const harness = await withHttpHarness(records, { rejectedClaims: new Set([expired, alreadyUsed]) });
  try {
    const unknown = await harness.request("legacy-unknown",
      "zetas_lazada_oauth=seller-cookie; zetas_lazada_im_oauth=im-cookie");
    assert.equal(unknown.status, 303);
    assert.equal(unknown.headers.get("location"), "/settings");
    assert.equal(unknown.headers.get("set-cookie"), null);

    const expiredResponse = await harness.request(expired, "zetas_lazada_oauth=seller-cookie");
    assert.equal(expiredResponse.headers.get("location"), "/settings?lazada_seller=authorization_failed");
    assert.match(expiredResponse.headers.get("set-cookie") ?? "", /^zetas_lazada_oauth=;/);
    const usedResponse = await harness.request(alreadyUsed, "zetas_lazada_im_oauth=im-cookie");
    assert.equal(usedResponse.headers.get("location"), "/settings?lazada_im=authorization_failed");
    assert.match(usedResponse.headers.get("set-cookie") ?? "", /^zetas_lazada_im_oauth=;/);

    const ambiguous = await harness.request("ambiguous-state",
      "zetas_lazada_oauth=seller-cookie; zetas_lazada_im_oauth=im-cookie");
    assert.equal(ambiguous.headers.get("location"), "/settings");
    assert.equal(ambiguous.headers.get("set-cookie"), null);
    const missing = await harness.request(imNew, undefined);
    assert.equal(missing.headers.get("location"), "/settings?lazada_im=authorization_failed");
    assert.match(missing.headers.get("set-cookie") ?? "", /^zetas_lazada_im_oauth=;/);
    const mismatch = await harness.request(sellerNew, "zetas_lazada_oauth=wrong");
    assert.equal(mismatch.headers.get("location"), "/settings?lazada_seller=authorization_failed");
    assert.match(mismatch.headers.get("set-cookie") ?? "", /^zetas_lazada_oauth=;/);
    const both = await harness.request(sellerNew,
      "zetas_lazada_oauth=seller-cookie; zetas_lazada_im_oauth=im-cookie");
    assert.equal(both.headers.get("location"), "/settings?lazada_seller=connected");
    assert.match(both.headers.get("set-cookie") ?? "", /^zetas_lazada_oauth=;/);
    assert.doesNotMatch(both.headers.get("set-cookie") ?? "", /zetas_lazada_im_oauth=/);
    assert.deepEqual(harness.calls, ["seller", "im", "im", "seller", "seller"]);
  } finally { await harness.close(); }
});

test("simultaneous mock callbacks claim one state at most once", async () => {
  const records = new Map([[imNew, { seller: false, im: true }]]);
  const harness = await withHttpHarness(records);
  try {
    const [first, second] = await Promise.all([
      harness.request(imNew, "zetas_lazada_im_oauth=im-cookie"),
      harness.request(imNew, "zetas_lazada_im_oauth=im-cookie"),
    ]);
    const locations = [first.headers.get("location"), second.headers.get("location")];
    assert.equal(locations.filter(value => value === "/settings?lazada_im=connected").length, 1);
    assert.equal(locations.filter(value => value === "/settings?lazada_im=authorization_failed").length, 1);
  } finally { await harness.close(); }
});

test("production callback validates HTTPS and config before resolver lookup", async () => {
  const routeSource = await readFile("artifacts/api-server/src/routes/lazada.ts", "utf8");
  const secureIndex = routeSource.indexOf('if (!req.secure)', routeSource.indexOf('get("/lazada/oauth/callback"'));
  const configIndex = routeSource.indexOf("const sellerConfig = configuration();", secureIndex);
  const imConfigIndex = routeSource.indexOf("const imConfig = imConfiguration();", configIndex);
  const resolverIndex = routeSource.indexOf("resolveLazadaOAuthFlow(", imConfigIndex);
  assert.ok(secureIndex >= 0 && secureIndex < configIndex && configIndex < imConfigIndex && imConfigIndex < resolverIndex);
});

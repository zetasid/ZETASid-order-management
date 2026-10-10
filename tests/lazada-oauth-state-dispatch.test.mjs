import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";

const require = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const express = require("express");
const { build } = require("esbuild");
const temporary = await mkdtemp(`${tmpdir()}/zetas-oauth-dispatch-`);
await build({
  entryPoints: ["artifacts/api-server/src/routes/lazada-oauth-callback.ts"],
  outfile: `${temporary}/callback.cjs`,
  bundle: true,
  platform: "node",
  format: "cjs",
  logLevel: "silent",
});
const { createLazadaOAuthCallbackRouter } = require(`${temporary}/callback.cjs`);
after(() => rm(temporary, { recursive: true, force: true }));

// Legacy Seller nonce is 43 characters total and may itself begin with "im_".
const sellerOld = `im_${"s".repeat(40)}`;
const sellerNew = `seller1_${"s".repeat(43)}`;
const imOld = `im_${"i".repeat(43)}`;
const imNew = `im1_${"i".repeat(43)}`;
const sellerCookieValue = "s".repeat(43);
const imCookieValue = "i".repeat(43);

async function withHttpHarness(records, options = {}) {
  const calls = [];
  const lookups = [];
  const claimed = new Set();
  const app = express();
  app.set("trust proxy", true);
  app.use((req, _res, next) => {
    req.cookies = Object.fromEntries((req.headers.cookie ?? "").split("; ").filter(Boolean)
      .map(item => item.split("=")));
    req.log = { warn() {}, info() {} };
    next();
  });
  const rejectedClaims = options.rejectedClaims ?? new Set();
  const callbackRouter = createLazadaOAuthCallbackRouter({
    lookupState: async state => {
      lookups.push(state);
      return records.get(state) ?? { seller: false, im: false };
    },
    sellerConfig: () => options.sellerConfig === false ? null : {},
    imConfig: () => options.imConfig === false ? null : {},
    isSellerState: state => typeof state === "string"
      && (/^[A-Za-z0-9_-]{43}$/.test(state) || /^seller1_[A-Za-z0-9_-]{43}$/.test(state)),
    isImState: state => typeof state === "string" && /^(?:im_|im1_)[A-Za-z0-9_-]{43}$/.test(state),
    finishSeller: async (_config, state) => {
      calls.push("seller");
      if (!records.get(state)?.seller || claimed.has(state) || rejectedClaims.has(state)) throw new Error("claim failed");
      claimed.add(state);
    },
    finishIm: async (_config, state) => {
      calls.push("im");
      if (!records.get(state)?.im || claimed.has(state) || rejectedClaims.has(state)) throw new Error("claim failed");
      claimed.add(state);
    },
  });
  app.use("/api", callbackRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const { port } = server.address();
  const request = (state, cookie, headers = {}) => fetch(`http://127.0.0.1:${port}/api/lazada/oauth/callback?state=${encodeURIComponent(state)}`, {
    redirect: "manual",
    headers: { "x-forwarded-proto": "https", ...(cookie ? { cookie } : {}), ...headers },
  });
  return { calls, lookups, request, close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

test("mocked Express callback routes legacy and namespaced seller/IM states without cross-handler fallback", async () => {
  const records = new Map([
    [sellerOld, { seller: true, im: false }],
    [sellerNew, { seller: true, im: false }],
    [imOld, { seller: false, im: true }],
    [imNew, { seller: false, im: true }],
  ]);
  const harness = await withHttpHarness(records);
  try {
    for (const [state, flow] of [[sellerOld, "seller"], [sellerNew, "seller"], [imOld, "im"], [imNew, "im"]]) {
      const cookieName = flow === "im" ? "zetas_lazada_im_oauth" : "zetas_lazada_oauth";
      const value = flow === "im" ? imCookieValue : sellerCookieValue;
      const response = await harness.request(state, `${cookieName}=${value}`);
      // Exercise the route with the correctly bound synthetic browser cookie.
      assert.equal(response.status, 303);
      assert.equal(response.headers.get("location"),
        flow === "im" ? "/settings?lazada_im=connected" : "/settings?lazada=connected");
    }
    assert.deepEqual(harness.calls, ["seller", "seller", "im", "im"]);
  } finally { await harness.close(); }
});

test("unknown, expired/used, and dual-table states fail closed; cookie failures stay in selected flow", async () => {
  const expired = `seller1_${"e".repeat(43)}`;
  const alreadyUsed = `im1_${"u".repeat(43)}`;
  const ambiguousState = `seller1_${"a".repeat(43)}`;
  const unrecordedNewSeller = `seller1_${"n".repeat(43)}`;
  const records = new Map([
    [expired, { seller: true, im: false }],
    [alreadyUsed, { seller: false, im: true }],
    [sellerNew, { seller: true, im: false }],
    [ambiguousState, { seller: true, im: true }],
    [imNew, { seller: false, im: true }],
  ]);
  const harness = await withHttpHarness(records, { rejectedClaims: new Set([expired, alreadyUsed]) });
  try {
    const unknown = await harness.request("legacy-unknown",
      `zetas_lazada_oauth=${sellerCookieValue}; zetas_lazada_im_oauth=${imCookieValue}`);
    assert.equal(unknown.status, 303);
    assert.equal(unknown.headers.get("location"), "/settings");
    assert.equal(unknown.headers.get("set-cookie"), null);

    const expiredResponse = await harness.request(expired, `zetas_lazada_oauth=${sellerCookieValue}`);
    assert.equal(expiredResponse.headers.get("location"), "/settings?lazada=authorization_failed");
    assert.match(expiredResponse.headers.get("set-cookie") ?? "", /^zetas_lazada_oauth=;/);
    const usedResponse = await harness.request(alreadyUsed, `zetas_lazada_im_oauth=${imCookieValue}`);
    assert.equal(usedResponse.headers.get("location"), "/settings?lazada_im=authorization_failed");
    assert.match(usedResponse.headers.get("set-cookie") ?? "", /^zetas_lazada_im_oauth=;/);

    const ambiguous = await harness.request(ambiguousState,
      `zetas_lazada_oauth=${sellerCookieValue}; zetas_lazada_im_oauth=${imCookieValue}`);
    assert.equal(ambiguous.headers.get("location"), "/settings");
    assert.equal(ambiguous.headers.get("set-cookie"), null);
    assert.ok(harness.lookups.includes(ambiguousState));
    const unrecorded = await harness.request(unrecordedNewSeller,
      `zetas_lazada_oauth=${sellerCookieValue}`);
    assert.equal(unrecorded.headers.get("location"), "/settings?lazada=authorization_failed");
    assert.match(unrecorded.headers.get("set-cookie") ?? "", /^zetas_lazada_oauth=;/);
    const missing = await harness.request(imNew, undefined);
    assert.equal(missing.headers.get("location"), "/settings?lazada_im=authorization_failed");
    assert.match(missing.headers.get("set-cookie") ?? "", /^zetas_lazada_im_oauth=;/);
    const mismatch = await harness.request(sellerNew, "zetas_lazada_oauth=wrong");
    assert.equal(mismatch.headers.get("location"), "/settings?lazada=authorization_failed");
    assert.match(mismatch.headers.get("set-cookie") ?? "", /^zetas_lazada_oauth=;/);
    const both = await harness.request(sellerNew,
      `zetas_lazada_oauth=${sellerCookieValue}; zetas_lazada_im_oauth=${imCookieValue}`);
    assert.equal(both.headers.get("location"), "/settings?lazada=connected");
    assert.match(both.headers.get("set-cookie") ?? "", /^zetas_lazada_oauth=;/);
    assert.doesNotMatch(both.headers.get("set-cookie") ?? "", /zetas_lazada_im_oauth=/);
    // Missing/mismatched cookies stop before finishSeller/finishIm is called.
    assert.deepEqual(harness.calls, ["seller", "im", "seller", "seller"]);
  } finally { await harness.close(); }
});

test("simultaneous mock callbacks claim one state at most once", async () => {
  const records = new Map([[imNew, { seller: false, im: true }]]);
  const harness = await withHttpHarness(records);
  try {
    const [first, second] = await Promise.all([
      harness.request(imNew, `zetas_lazada_im_oauth=${imCookieValue}`),
      harness.request(imNew, `zetas_lazada_im_oauth=${imCookieValue}`),
    ]);
    const locations = [first.headers.get("location"), second.headers.get("location")];
    assert.equal(locations.filter(value => value === "/settings?lazada_im=connected").length, 1);
    assert.equal(locations.filter(value => value === "/settings?lazada_im=authorization_failed").length, 1);
  } finally { await harness.close(); }
});

test("production callback validates HTTPS and config before resolver lookup", async () => {
  const routeSource = await readFile("artifacts/api-server/src/routes/lazada-oauth-callback.ts", "utf8");
  const secureIndex = routeSource.indexOf("if (!req.secure)");
  const configIndex = routeSource.indexOf("const sellerConfig = deps.sellerConfig();", secureIndex);
  const imConfigIndex = routeSource.indexOf("const imConfig = deps.imConfig();", configIndex);
  const resolverIndex = routeSource.indexOf("resolveLazadaOAuthFlow(", imConfigIndex);
  assert.ok(secureIndex >= 0 && secureIndex < configIndex && configIndex < imConfigIndex && imConfigIndex < resolverIndex);

  const harness = await withHttpHarness(new Map(), { sellerConfig: false, imConfig: false });
  try {
    const insecure = await harness.request(imNew, `${"zetas_lazada_im_oauth"}=${imCookieValue}`, {
      "x-forwarded-proto": "",
    });
    assert.equal(insecure.status, 303);
    assert.equal(harness.lookups.length, 0);
    const noConfig = await harness.request(imNew, `zetas_lazada_im_oauth=${imCookieValue}`);
    assert.equal(noConfig.status, 303);
    assert.equal(harness.lookups.length, 0);
  } finally { await harness.close(); }

  const sellerUnavailable = await withHttpHarness(new Map(), { sellerConfig: false });
  try {
    const response = await sellerUnavailable.request(sellerNew, `zetas_lazada_oauth=${sellerCookieValue}`);
    assert.equal(response.status, 303);
    assert.equal(sellerUnavailable.lookups.length, 0);
  } finally { await sellerUnavailable.close(); }

  const imUnavailable = await withHttpHarness(new Map(), { imConfig: false });
  try {
    const response = await imUnavailable.request(imNew, `zetas_lazada_im_oauth=${imCookieValue}`);
    assert.equal(response.status, 303);
    assert.equal(imUnavailable.lookups.length, 0);
  } finally { await imUnavailable.close(); }
});

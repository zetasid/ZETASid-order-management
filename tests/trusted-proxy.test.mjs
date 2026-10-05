import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import http from "node:http";
import { pathToFileURL } from "node:url";

const require = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const express = require("express");
const { build } = require("esbuild");
const dir = await mkdtemp(`${tmpdir()}/zetas-proxy-`);
after(() => rm(dir, { recursive: true, force: true }));
await build({
  stdin: { contents: "export { trustedProxyAddresses } from './artifacts/api-server/src/lib/trusted-proxy.ts';",
    resolveDir: process.cwd(), loader: "ts" },
  outfile: `${dir}/proxy.mjs`, bundle: true, platform: "node", format: "esm", logLevel: "silent",
});
const { trustedProxyAddresses } = await import(pathToFileURL(`${dir}/proxy.mjs`));

test("Proxy allowlist accepts explicit IPv4/IPv6 CIDRs and refuses blanket/hop-count trust", () => {
  assert.deepEqual(trustedProxyAddresses(" loopback, 172.20.0.2/32, ::1, fd00::/64 "), [
    "loopback", "172.20.0.2/32", "::1", "fd00::/64",
  ]);
  assert.deepEqual(trustedProxyAddresses("loopback,uniquelocal"), ["loopback", "uniquelocal"]);
  for (const value of ["", " ", "true", "false", "1", "*", "0.0.0.0/0", "::/0",
    "127.0.0.1,", "nginx.example", "172.20.0.2/33", "::1/129", "127.0.0.1/-1", "127.0.0.1/32/32"]) {
    assert.throws(() => trustedProxyAddresses(value), /TRUST_PROXY/, value);
  }
});

test("Trusted Nginx HTTPS is secure; HTTP and spoofed HTTPS from an untrusted socket are not", async t => {
  const app = express();
  app.set("trust proxy", trustedProxyAddresses("127.0.0.1"));
  app.get("/", (req, res) => res.json({ secure: req.secure, protocol: req.protocol, ip: req.ip }));
  const server = await new Promise(resolve => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const request = (headers = {}, localAddress = "127.0.0.1") => new Promise((resolve, reject) => {
    http.get({ hostname: "127.0.0.1", port: server.address().port, path: "/", headers, localAddress, agent: false }, res => {
      let body = "";
      res.on("data", chunk => { body += chunk; });
      res.on("end", () => resolve(JSON.parse(body)));
    }).on("error", reject);
  });
  try {
    await t.test("Trusted proxy HTTPS preserves client IP", async () => {
      assert.deepEqual(await request({ "X-Forwarded-Proto": "https", "X-Forwarded-For": "203.0.113.5" }),
        { secure: true, protocol: "https", ip: "203.0.113.5" });
    });
    await t.test("Trusted proxy HTTP remains HTTP, even with a later HTTPS value", async () => {
      for (const protocol of ["http", "http, https"]) {
        assert.deepEqual(await request({ "X-Forwarded-Proto": protocol }), { secure: false, protocol: "http", ip: "127.0.0.1" });
      }
    });
    await t.test("Missing or non-HTTPS forwarded protocol is not secure", async () => {
      assert.deepEqual(await request(), { secure: false, protocol: "http", ip: "127.0.0.1" });
      assert.equal((await request({ "X-Forwarded-Proto": "wss" })).secure, false);
    });
    await t.test("Untrusted socket cannot spoof protocol or client IP", async () => {
      assert.deepEqual(await request({ "X-Forwarded-Proto": "https", "X-Forwarded-For": "203.0.113.5" }, "127.0.0.2"),
        { secure: false, protocol: "http", ip: "127.0.0.2" });
    });
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { api, createAuthorizedFixture, signIn, digest } from "./auth-helper.mjs";

const require = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const { build } = require("esbuild");
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

test("Login persists for 30 days; activity renews it beyond the original month and maintenance preserves it", async () => {
  const fixture = await createAuthorizedFixture();
  const dir = await mkdtemp(`${tmpdir()}/zetas-session-duration-`);
  let maintenance;
  try {
    await build({
      bundle: true, platform: "node", format: "esm", logLevel: "silent",
      banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
      stdin: {
        contents: `export { removeExpiredAuthData } from './artifacts/api-server/src/modules/auth/session.ts';
          export { activeSession } from './artifacts/api-server/src/modules/lazada/connection.ts';
          export { db, pool } from './lib/db/src/index.ts';`,
        resolveDir: process.cwd(), loader: "ts",
      },
      outfile: `${dir}/maintenance.mjs`,
    });
    maintenance = await import(pathToFileURL(`${dir}/maintenance.mjs`));
    const loginAt = Date.now();
    const login = await signIn(fixture, { Cookie: fixture.cookie });
    assert.equal(login.status, 200);
    const cookieHeader = login.headers.getSetCookie()[0];
    assert.match(cookieHeader, /Max-Age=2592000(?:;|$)/);
    const cookie = cookieHeader.split(";")[0];
    const sessionHash = digest("session", cookie.split("=")[1]);
    const sessionRows = () => fixture.pool.query("SELECT expires_at FROM auth_sessions WHERE user_id=$1", [fixture.id]);
    assert.ok((await sessionRows()).rows.every(row => row.expires_at.getTime() >= loginAt + MONTH_MS - 1000));

    for (const days of [29, 45]) {
      // Simulate returning after a long absence, then an actively renewed old session.
      await fixture.pool.query(`UPDATE auth_sessions
        SET created_at=now()-$2*interval '1 day',expires_at=now()+interval '1 day'
        WHERE user_id=$1`, [fixture.id, days]);
      await maintenance.removeExpiredAuthData();
      assert.equal((await sessionRows()).rows.length, 1, "Maintenance must not delete live sessions based on creation age");
      assert.equal(await maintenance.db.transaction(tx => maintenance.activeSession(tx, fixture.id, sessionHash)), true,
        "The transactional session guard must honor the same long-lived session policy");
      const returnedAt = Date.now();
      const response = await fetch(`${api}/auth/me`, { headers: { Cookie: cookie } });
      assert.equal(response.status, 200);
      assert.ok(response.headers.getSetCookie()[0].includes("HttpOnly"));
      assert.match(response.headers.getSetCookie()[0], /Max-Age=259199[89](?:;|$)|Max-Age=2592000(?:;|$)/);
      assert.ok((await sessionRows()).rows[0].expires_at.getTime() >= returnedAt + MONTH_MS - 1000);
    }

    await fixture.pool.query("UPDATE auth_sessions SET expires_at=now()-interval '1 minute' WHERE user_id=$1", [fixture.id]);
    await maintenance.removeExpiredAuthData();
    assert.equal((await sessionRows()).rows.length, 0, "Maintenance still removes expired sessions");
    assert.equal((await fetch(`${api}/auth/me`, { headers: { Cookie: cookie } })).status, 401);
  } finally {
    await maintenance?.pool.end();
    await fixture.cleanup();
    await rm(dir, { recursive: true, force: true });
  }
});
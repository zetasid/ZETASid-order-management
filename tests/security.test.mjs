import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { hashPassword, verifyPassword } from "../artifacts/api-server/dist/password.mjs";
import { api, createAuthorizedFixture, signIn, digest } from "./auth-helper.mjs";
const run = promisify(execFile);

test("Hash scrypt bersalt, verifikasi konstan-waktu, dan batas password", async () => {
  const password = randomBytes(24).toString("base64url");
  const a = await hashPassword(password);
  const b = await hashPassword(password);
  assert.ok(a !== b && a !== password && a.startsWith("scrypt$65536$8$2$"));
  assert.ok(await verifyPassword(password, a));
  assert.ok(!await verifyPassword(randomBytes(24).toString("base64url"), a));
  assert.ok(!await verifyPassword(password, "invalid"));
  await assert.rejects(hashPassword("short"));
  await assert.rejects(hashPassword("x".repeat(129)));
});

test("API pesanan menolak anonim, cookie palsu, bearer palsu dan perubahan data", async () => {
  const fixture = await createAuthorizedFixture();
  const orderId = randomUUID();
  try {
    await fixture.pool.query("INSERT INTO orders (id,lazada_order_id) VALUES ($1,$2)", [orderId, `security-order-${orderId}`]);
    for (const path of ["/orders", `/orders/${orderId}`, "/dashboard/summary", "/auth/me"]) {
      for (const headers of [{}, { Cookie: `zetas_session=${randomBytes(32).toString("base64url")}` }, { Authorization: "Bearer invalid", "X-User-Id": fixture.id }]) {
        const result = await fetch(`${api}${path}`, { headers });
        assert.equal(result.status, 401);
        assert.equal(result.headers.get("cache-control"), "no-store");
      }
    }
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const anonymous = await fetch(`${api}/orders/${orderId}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "completed" }) });
      assert.equal(anonymous.status, 401);
      const authorized = await fetch(`${api}/orders/${orderId}`, { method, headers: { Cookie: fixture.cookie, "X-CSRF-Token": fixture.csrfToken, "Content-Type": "application/json" }, body: JSON.stringify({ status: "completed" }) });
      assert.equal(authorized.status, 405);
    }
    assert.equal((await fixture.pool.query("SELECT status FROM orders WHERE id=$1", [orderId])).rows[0].status, "pending");
    assert.equal((await fetch(`${api}/auth/register`, { method: "POST" })).status, 401);
  } finally {
    await fixture.pool.query("DELETE FROM orders WHERE id=$1", [orderId]);
    await fixture.cleanup();
  }
});

test("Login, rotasi session, CSRF logout, pencabutan dan respons tanpa credential", async () => {
  const fixture = await createAuthorizedFixture();
  try {
    const response = await signIn(fixture, { Cookie: fixture.cookie, Origin: new URL(api).origin });
    assert.equal(response.status, 200);
    const cookieHeader = response.headers.getSetCookie()[0];
    assert.ok(cookieHeader.includes("HttpOnly") && cookieHeader.includes("SameSite=Strict") && cookieHeader.includes("Path=/"));
    assert.match(cookieHeader, /Max-Age=2592000(?:;|$)/, "Persistent login cookie lasts 30 days");
    const cookie = cookieHeader.split(";")[0];
    assert.ok(cookie !== fixture.cookie);
    const text = await response.text();
    assert.ok(!text.includes(fixture.password) && !text.includes(fixture.hash) && !text.includes("passwordHash") && !text.includes(process.env.SESSION_SECRET));
    const session = JSON.parse(text);
    assert.ok(Object.keys(session).sort().join(",") === "csrfToken,user");
    assert.equal((await fetch(`${api}/orders`, { headers: { Cookie: cookie } })).status, 200);
    assert.equal((await fetch(`${api}/orders`, { headers: { Cookie: fixture.cookie } })).status, 401, "Old session must be invalid after login rotation");
    const token = cookie.split("=")[1];
    const stored = (await fixture.pool.query("SELECT token_hash FROM auth_sessions WHERE user_id=$1", [fixture.id])).rows;
    assert.ok(stored.length === 1 && stored[0].token_hash !== token);
    assert.equal((await fetch(`${api}/auth/logout`, { method: "POST", headers: { Cookie: cookie } })).status, 403);
    assert.equal((await fetch(`${api}/auth/logout`, { method: "POST", headers: { Cookie: cookie, "X-CSRF-Token": session.csrfToken, Origin: "https://evil.example" } })).status, 403);
    const logout = await fetch(`${api}/auth/logout`, { method: "POST", headers: { Cookie: cookie, "X-CSRF-Token": session.csrfToken } });
    assert.equal(logout.status, 204);
    assert.ok(logout.headers.getSetCookie()[0].includes("Expires="));
    assert.equal((await fetch(`${api}/orders`, { headers: { Cookie: cookie } })).status, 401);
    assert.equal((await fixture.pool.query("SELECT count(*)::int AS n FROM auth_sessions WHERE user_id=$1", [fixture.id])).rows[0].n, 0);
  } finally { await fixture.cleanup(); }
});

test("Session kedaluwarsa dan akun dinonaktifkan tidak diizinkan; batas 8 jam tidak lagi berlaku", async () => {
  const fixture = await createAuthorizedFixture();
  try {
    await fixture.pool.query("UPDATE auth_sessions SET expires_at=now()-interval '1 minute' WHERE user_id=$1", [fixture.id]);
    assert.equal((await fetch(`${api}/auth/me`, { headers: { Cookie: fixture.cookie } })).status, 401);
    let response = await signIn(fixture);
    assert.equal(response.status, 200);
    let cookie = response.headers.getSetCookie()[0].split(";")[0];
    await fixture.pool.query("UPDATE auth_sessions SET created_at=now()-interval '9 hours',expires_at=now()+interval '1 hour' WHERE user_id=$1", [fixture.id]);
    assert.equal((await fetch(`${api}/orders`, { headers: { Cookie: cookie } })).status, 200);
    await fixture.pool.query("UPDATE auth_sessions SET created_at=now()-interval '31 days',expires_at=now()-interval '1 minute' WHERE user_id=$1", [fixture.id]);
    assert.equal((await fetch(`${api}/orders`, { headers: { Cookie: cookie } })).status, 401);
    response = await signIn(fixture);
    assert.equal(response.status, 200);
    cookie = response.headers.getSetCookie()[0].split(";")[0];
    await fixture.pool.query("UPDATE users SET is_active=false WHERE id=$1", [fixture.id]);
    assert.equal((await fetch(`${api}/orders`, { headers: { Cookie: cookie } })).status, 401);
    assert.equal((await signIn(fixture)).status, 401);
  } finally { await fixture.cleanup(); }
});

test("Validasi ketat, error generik, Origin dan lockout PostgreSQL anti brute force", async () => {
  const fixture = await createAuthorizedFixture();
  const unknownEmail = `unknown-${randomUUID()}@example.invalid`;
  try {
    const call = (body, headers = {}) => fetch(`${api}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
    for (const body of [
      { email: "not-an-email", password: fixture.password },
      { email: fixture.email, password: {} },
      { email: fixture.email, password: "x".repeat(129) },
      { email: fixture.email, password: fixture.password, userId: fixture.id },
    ]) assert.equal((await call(body)).status, 400);
    assert.equal((await signIn(fixture, { Origin: "https://evil.example" })).status, 403);
    const wrong = randomBytes(24).toString("base64url");
    const unknown = await call({ email: unknownEmail, password: wrong });
    assert.equal(unknown.status, 401);
    const unknownText = await unknown.text();
    // Clear only this generated fixture's account bucket after validation cases.
    await fixture.pool.query("DELETE FROM auth_login_buckets WHERE key=$1", [digest("login-account", fixture.email)]);
    for (let i = 0; i < 5; i++) {
      const denied = await call({ email: fixture.email, password: wrong });
      assert.equal(denied.status, 401);
      assert.ok((await denied.text()) === unknownText);
    }
    const blocked = await call({ email: fixture.email, password: fixture.password }, { "X-Forwarded-For": "198.51.100.123" });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("retry-after")) > 0);
    const record = (await fixture.pool.query("SELECT attempts,reset_at FROM auth_login_buckets WHERE key=$1", [digest("login-account", fixture.email)])).rows[0];
    assert.ok(record.attempts >= 6 && record.reset_at > new Date());
    const malformed = await fetch(`${api}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: `{"password":"${fixture.password}",` });
    assert.equal(malformed.status, 400);
    assert.ok(!(await malformed.text()).includes(fixture.password));
    const large = await fetch(`${api}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: "x".repeat(17000) }) });
    assert.equal(large.status, 413);
  } finally {
    await fixture.pool.query("DELETE FROM auth_login_buckets WHERE key=$1", [digest("login-account", unknownEmail)]);
    await fixture.cleanup();
  }
});

test("Console pengelola membuat/reset/nonaktifkan akun tanpa credential di output", async () => {
  const fixture = await createAuthorizedFixture();
  const email = `console-test-${randomUUID()}@example.invalid`;
  const password = randomBytes(24).toString("base64url");
  let id;
  try {
    const command = (action, value = password) => run("node", ["artifacts/api-server/dist/manage-users.mjs", action], {
      env: { ...process.env, AUTH_SETUP_EMAIL: email, AUTH_SETUP_PASSWORD: value },
    });
    const output = await command("create");
    assert.ok(!output.stdout.includes(password) && !output.stderr.includes(password));
    const row = (await fixture.pool.query("SELECT id,password_hash FROM users WHERE email=$1", [email])).rows[0];
    id = row.id;
    assert.ok(await verifyPassword(password, row.password_hash));
    const login = await signIn({ email, password });
    assert.equal(login.status, 200);
    const cookie = login.headers.getSetCookie()[0].split(";")[0];
    const replacement = randomBytes(24).toString("base64url");
    await command("reset-password", replacement);
    assert.equal((await fetch(`${api}/orders`, { headers: { Cookie: cookie } })).status, 401);
    assert.equal((await signIn({ email, password: replacement })).status, 200);
    await command("disable", "");
    assert.equal((await signIn({ email, password: replacement })).status, 401);
  } finally {
    if (id) await fixture.pool.query("DELETE FROM users WHERE id=$1", [id]);
    else await fixture.pool.query("DELETE FROM users WHERE email=$1", [email]);
    await fixture.pool.query("DELETE FROM auth_login_buckets WHERE key=$1", [digest("login-account", email)]);
    await fixture.cleanup();
  }
});

test("Session tidak bertahan saat reset berbarengan dengan verifikasi password lama", async () => {
  const fixture = await createAuthorizedFixture();
  try {
    const replacement = randomBytes(24).toString("base64url");
    const replacementHash = await hashPassword(replacement);
    const verifying = signIn(fixture);
    await delay(50);
    const client = await fixture.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE users SET password_hash=$1 WHERE id=$2", [replacementHash, fixture.id]);
      await client.query("DELETE FROM auth_sessions WHERE user_id=$1", [fixture.id]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK"); throw error;
    } finally { client.release(); }
    const response = await verifying;
    // Fast machines may finish login before reset; that session must still be revoked.
    assert.ok([200, 401].includes(response.status));
    const count = (await fixture.pool.query("SELECT count(*)::int AS n FROM auth_sessions WHERE user_id=$1", [fixture.id])).rows[0].n;
    assert.equal(count, 0, "No pre-reset password verification may leave a usable session");
    const cookie = response.headers.getSetCookie()[0]?.split(";")[0] ?? fixture.cookie;
    assert.equal((await fetch(`${api}/orders`, { headers: { Cookie: cookie } })).status, 401);
    assert.equal((await signIn({ email: fixture.email, password: replacement })).status, 200);
  } finally { await fixture.cleanup(); }
});
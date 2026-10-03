import { createRequire } from "node:module";
import { randomUUID, randomBytes, createHmac } from "node:crypto";
import { hashPassword } from "../artifacts/api-server/dist/password.mjs";

const require = createRequire(new URL("../lib/db/package.json", import.meta.url));
const { Pool } = require("pg");
export const api = process.env.TEST_API_URL || `${process.env.TEST_BASE_URL || "http://localhost:80"}/api`;
export const digest = (purpose, value) => createHmac("sha256", process.env.SESSION_SECRET).update(`${purpose}:${value}`).digest("hex");
export async function createAuthorizedFixture() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const id = randomUUID();
  const email = `security-test-${id}@example.invalid`;
  const password = randomBytes(24).toString("base64url");
  const hash = await hashPassword(password);
  const token = randomBytes(32).toString("base64url");
  await pool.query("INSERT INTO users (id,email,password_hash) VALUES ($1,$2,$3)", [id, email, hash]);
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,expires_at) VALUES ($1,$2,$3)", [digest("session", token), id, new Date(Date.now() + 1800000)]);
  return {
    id, email, password, hash, pool,
    cookie: `zetas_session=${token}`, csrfToken: digest("csrf", token),
    async cleanup() {
      await pool.query("DELETE FROM users WHERE id = $1", [id]);
      await pool.query("DELETE FROM auth_login_buckets WHERE key = $1", [digest("login-account", email)]);
      await pool.end();
    },
  };
}
export async function signIn(fixture, headers = {}) {
  return fetch(`${api}/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ email: fixture.email, password: fixture.password }),
  });
}
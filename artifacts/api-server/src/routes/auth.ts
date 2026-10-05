import { Router, type IRouter } from "express";
import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, usersTable, authSessionsTable, authLoginBucketsTable } from "@workspace/db";
import { LoginBody, LoginResponse, GetSessionResponse } from "@workspace/api-zod";
import { hashPassword, verifyPassword } from "../modules/auth/password";
import { digest, SESSION_TTL_MS } from "../modules/auth/config";
import { consumeLoginQuota, withPasswordSlot } from "../modules/auth/limits";
import { COOKIE, cookieOptions, readToken, clearSessionCookie, requireSession, requireSameOrigin, requireCsrf } from "../modules/auth/session";

const router: IRouter = Router();
const dummyHash = await hashPassword(randomBytes(32).toString("hex"));

router.post("/auth/login", requireSameOrigin, async (req, res): Promise<void> => {
  const candidate = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase().slice(0, 254) : undefined;
  const retryAfter = await consumeLoginQuota(req.ip ?? "unknown", candidate);
  if (retryAfter) {
    res.set("Retry-After", String(retryAfter)).status(429).json({ error: "Terlalu banyak percobaan. Coba lagi nanti." }); return;
  }
  const parsed = LoginBody.strict().safeParse(req.body);
  if (!req.is("application/json") || !parsed.success || typeof req.body.email !== "string" || typeof req.body.password !== "string") {
    res.status(400).json({ error: "Email atau kata sandi tidak valid." }); return;
  }
  const email = parsed.data.email.trim().toLowerCase();
  const result = await withPasswordSlot(async () => {
    const matches = await db.select().from(usersTable).where(sql`lower(${usersTable.email}) = ${email}`).limit(2);
    const user = matches.length === 1 ? matches[0] : undefined;
    const valid = await verifyPassword(parsed.data.password, user?.passwordHash ?? dummyHash);
    return valid && user?.isActive && user.passwordHash ? user : null;
  });
  if (result === undefined) {
    res.set("Retry-After", "5").status(429).json({ error: "Terlalu banyak percobaan. Coba lagi nanti." }); return;
  }
  if (!result) { res.status(401).json({ error: "Email atau kata sandi tidak sesuai." }); return; }
  const token = randomBytes(32).toString("base64url");
  const old = readToken(req);
  const created = await db.transaction(async (tx) => {
    // Serialize with password resets/disabling: a completed old-password
    // verification must not mint a session after those changes commit.
    const [current] = await tx.select().from(usersTable).where(eq(usersTable.id, result.id)).for("update");
    if (!current?.isActive || current.passwordHash !== result.passwordHash) return false;
    if (old) await tx.delete(authSessionsTable).where(eq(authSessionsTable.tokenHash, digest("session", old)));
    await tx.insert(authSessionsTable).values({ tokenHash: digest("session", token), userId: result.id, expiresAt: new Date(Date.now() + SESSION_TTL_MS) });
    await tx.delete(authLoginBucketsTable).where(eq(authLoginBucketsTable.key, digest("login-account", email)));
    return true;
  });
  if (!created) { res.status(401).json({ error: "Email atau kata sandi tidak sesuai." }); return; }
  res.cookie(COOKIE, token, { ...cookieOptions(req), maxAge: SESSION_TTL_MS });
  res.json(LoginResponse.parse({ user: { id: result.id, email: result.email, displayName: result.displayName }, csrfToken: digest("csrf", token) }));
});
router.get("/auth/me", requireSession, (_req, res) => { res.json(GetSessionResponse.parse(res.locals.auth)); });
router.post("/auth/logout", requireSession, requireSameOrigin, requireCsrf, async (req, res): Promise<void> => {
  await db.delete(authSessionsTable).where(eq(authSessionsTable.tokenHash, res.locals.auth.tokenHash));
  clearSessionCookie(req, res);
  res.status(204).end();
});

export default router;
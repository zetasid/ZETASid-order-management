import type { CookieOptions, Request, RequestHandler, Response } from "express";
import { and, eq, gt, sql } from "drizzle-orm";
import { db, usersTable, authSessionsTable, authLoginBucketsTable } from "@workspace/db";
import { digest, SESSION_TTL_MS, secureEqual } from "./config";

export const COOKIE = "zetas_session";
export function cookieOptions(req: Request): CookieOptions {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production" || req.secure, sameSite: "strict", path: "/" };
}
export function readToken(req: Request): string | null {
  const value: unknown = req.cookies?.[COOKIE];
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}
export function clearSessionCookie(req: Request, res: Response) {
  res.clearCookie(COOKIE, cookieOptions(req));
}
export const requireSession: RequestHandler = async (req, res, next) => {
  const token = readToken(req);
  if (!token) { clearSessionCookie(req, res); res.status(401).json({ error: "Silakan masuk terlebih dahulu." }); return; }
  const tokenHash = digest("session", token);
  const [session] = await db.select({
    id: usersTable.id, email: usersTable.email, displayName: usersTable.displayName,
  }).from(authSessionsTable).innerJoin(usersTable, eq(authSessionsTable.userId, usersTable.id)).where(and(
    eq(authSessionsTable.tokenHash, tokenHash),
    gt(authSessionsTable.expiresAt, new Date()),
    eq(usersTable.isActive, true),
  )).limit(1);
  if (!session) { clearSessionCookie(req, res); res.status(401).json({ error: "Silakan masuk terlebih dahulu." }); return; }
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const renewed = await db.update(authSessionsTable).set({ expiresAt }).where(and(
    eq(authSessionsTable.tokenHash, tokenHash),
    gt(authSessionsTable.expiresAt, new Date()),
  )).returning({ hash: authSessionsTable.tokenHash });
  if (!renewed.length) { clearSessionCookie(req, res); res.status(401).json({ error: "Silakan masuk terlebih dahulu." }); return; }
  res.cookie(COOKIE, token, { ...cookieOptions(req), maxAge: expiresAt.getTime() - Date.now() });
  res.locals.auth = { user: { id: session.id, email: session.email, displayName: session.displayName }, tokenHash, csrfToken: digest("csrf", token) };
  next();
};

export const requireSameOrigin: RequestHandler = (req, res, next) => {
  const origin = req.get("origin");
  let allowed = req.get("sec-fetch-site") !== "cross-site";
  if (origin) {
    try {
      const url = new URL(origin);
      const configured = process.env.APP_ORIGIN;
      allowed = allowed && (configured
        ? url.origin === new URL(configured).origin
        : url.host === new URL(`${url.protocol}//${req.get("host")}`).host
          && (url.protocol === "https:" || (process.env.NODE_ENV !== "production" && !req.secure)));
    } catch { allowed = false; }
  }
  if (!allowed) { res.status(403).json({ error: "Permintaan tidak diizinkan." }); return; }
  next();
};

export const requireCsrf: RequestHandler = (req, res, next) => {
  const supplied = req.get("x-csrf-token") ?? "";
  if (!secureEqual(supplied, res.locals.auth.csrfToken)) { res.status(403).json({ error: "Permintaan tidak diizinkan." }); return; }
  next();
};

export async function removeExpiredAuthData() {
  await db.delete(authSessionsTable).where(sql`${authSessionsTable.expiresAt} <= now()`);
  // Keep rate-limit records for a day; never clear still-active lockouts.
  await db.delete(authLoginBucketsTable).where(sql`${authLoginBucketsTable.resetAt} < now() - interval '1 day'`);
}
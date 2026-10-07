import { and, eq, gt, lt } from "drizzle-orm";
import {
  db,
  lazadaImConnectionsTable,
  lazadaImOauthStatesTable,
} from "@workspace/db";
import { activeSession } from "./connection";
import { createClient, LazadaError } from "./client";
import { hash, imConfiguration, nonce, seal, unseal, validNonce, type LazadaConfig } from "./security";

export const imOAuthCookieName = "zetas_lazada_im_oauth";
const imStatePattern = /^im_[A-Za-z0-9_-]{43}$/;

export function isImOAuthState(value: unknown): value is string {
  return typeof value === "string" && imStatePattern.test(value);
}

function storedAccessToken(encryptedTokens: string, config: LazadaConfig, userId: string): string | null {
  try {
    const tokens: unknown = JSON.parse(unseal(encryptedTokens, config, userId));
    if (!tokens || typeof tokens !== "object" || Array.isArray(tokens)) return null;
    const accessToken = (tokens as Record<string, unknown>).accessToken;
    return typeof accessToken === "string" && accessToken.length > 0 && accessToken.length <= 8192
      ? accessToken : null;
  } catch {
    return null;
  }
}

export async function startImAuthorization(config: LazadaConfig, userId: string, sessionHash: string) {
  const state = `im_${nonce()}`;
  const browser = nonce();
  await db.transaction(async tx => {
    if (!await activeSession(tx, userId, sessionHash)) throw new LazadaError("authorization_failed");
    await tx.delete(lazadaImOauthStatesTable).where(eq(lazadaImOauthStatesTable.userId, userId));
    await tx.delete(lazadaImOauthStatesTable).where(lt(lazadaImOauthStatesTable.expiresAt, new Date()));
    await tx.insert(lazadaImOauthStatesTable).values({
      stateHash: hash(state),
      browserHash: hash(browser),
      userId,
      sessionHash,
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });
  });
  const url = new URL("https://auth.lazada.com/oauth/authorize");
  url.search = new URLSearchParams({
    response_type: "code",
    force_auth: "true",
    client_id: config.appKey,
    redirect_uri: config.callback.href,
    state,
  }).toString();
  return { authorizationUrl: url.href, browser };
}

export async function finishImAuthorization(
  config: LazadaConfig,
  state: string,
  browser: string,
  code: string | null,
): Promise<void> {
  if (!isImOAuthState(state) || !validNonce(browser)) throw new LazadaError("authorization_failed");
  const [pending] = await db.delete(lazadaImOauthStatesTable).where(and(
    eq(lazadaImOauthStatesTable.stateHash, hash(state)),
    eq(lazadaImOauthStatesTable.browserHash, hash(browser)),
    gt(lazadaImOauthStatesTable.expiresAt, new Date()),
  )).returning();
  if (!pending || !code) throw new LazadaError("authorization_failed");
  if (!await db.transaction(tx => activeSession(tx, pending.userId, pending.sessionHash)))
    throw new LazadaError("authorization_failed");

  const issuedAt = Date.now();
  const tokens = await createClient(config).exchange(code);
  const expiresAt = new Date(issuedAt + tokens.expiresIn * 1000);
  if (expiresAt <= new Date()) throw new LazadaError("authorization_failed");

  await db.transaction(async tx => {
    if (!await activeSession(tx, pending.userId, pending.sessionHash))
      throw new LazadaError("authorization_failed");
    const values = {
      userId: pending.userId,
      appFingerprint: config.fingerprint,
      country: config.country,
      encryptedTokens: seal(JSON.stringify({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      }), config, pending.userId),
      expiresAt,
      refreshExpiresAt: new Date(issuedAt + tokens.refreshExpiresIn * 1000),
    };
    await tx.insert(lazadaImConnectionsTable).values(values).onConflictDoUpdate({
      target: lazadaImConnectionsTable.userId,
      set: values,
    });
  });
}

export async function imConnectionStatus(userId: string) {
  const config = imConfiguration();
  const [row] = await db.select({
    encryptedTokens: lazadaImConnectionsTable.encryptedTokens,
    appFingerprint: lazadaImConnectionsTable.appFingerprint,
    country: lazadaImConnectionsTable.country,
    expiresAt: lazadaImConnectionsTable.expiresAt,
  }).from(lazadaImConnectionsTable).where(eq(lazadaImConnectionsTable.userId, userId)).limit(1);

  let status: "not_configured" | "not_connected" | "connected" | "expired";
  if (!config) status = "not_configured";
  else if (!row || row.appFingerprint !== config.fingerprint || row.country !== config.country)
    status = "not_connected";
  else if (row.expiresAt.getTime() <= Date.now()) status = "expired";
  else status = storedAccessToken(row.encryptedTokens, config, userId) ? "connected" : "not_connected";

  return {
    configured: !!config,
    status,
    expiresAt: status === "connected" || status === "expired" ? row?.expiresAt.toISOString() ?? null : null,
  };
}

export async function getImConnectionCredentials(userId: string) {
  const config = imConfiguration();
  if (!config) throw new LazadaError("authorization_failed");
  const [row] = await db.select({
    encryptedTokens: lazadaImConnectionsTable.encryptedTokens,
    appFingerprint: lazadaImConnectionsTable.appFingerprint,
    country: lazadaImConnectionsTable.country,
    expiresAt: lazadaImConnectionsTable.expiresAt,
  }).from(lazadaImConnectionsTable).where(eq(lazadaImConnectionsTable.userId, userId)).limit(1);
  if (!row || row.appFingerprint !== config.fingerprint || row.country !== config.country
    || row.expiresAt.getTime() <= Date.now()) throw new LazadaError("authorization_failed");
  const accessToken = storedAccessToken(row.encryptedTokens, config, userId);
  if (!accessToken) throw new LazadaError("authorization_failed");
  return { config, accessToken };
}

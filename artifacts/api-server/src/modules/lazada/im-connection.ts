import { and, eq, gt, lt } from "drizzle-orm";
import {
  db,
  lazadaImConnectionsTable,
  lazadaImOauthStatesTable,
} from "@workspace/db";
import { activeSession } from "./connection";
import { createClient, LazadaError } from "./client";
import { hash, imConfiguration, nonce, seal, unseal, validNonce, type LazadaConfig } from "./security";
import type {
  ImOAuthDiagnosticCategory,
  ImOAuthDiagnosticDetails,
  ImOAuthDiagnosticStage,
} from "./im-oauth-diagnostics";

export const imOAuthCookieName = "zetas_lazada_im_oauth";
const imStatePattern = /^(?:im_|im1_)[A-Za-z0-9_-]{43}$/;

function providerSellerId(value: unknown): string | null {
  if (typeof value === "number")
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  if (typeof value !== "string") return null;
  const sellerId = value.trim();
  return sellerId.length > 0 && sellerId.length <= 128 && !/[\u0000-\u001f\u007f]/.test(sellerId)
    ? sellerId : null;
}

export function isUniqueConstraintViolation(error: unknown): boolean {
  const seen = new Set<object>();
  let current = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if ("code" in current && current.code === "23505") return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}

export async function resolveImSessionUpdateUserId(config: LazadaConfig, payload: unknown): Promise<string | null> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const event = payload as Record<string, unknown>;
  if (event.message_type !== 19 || event.sync_type !== "SESSION_UPDATE") return null;
  const sellerId = providerSellerId(event.seller_id);
  if (!sellerId) return null;

  const matches = await db.select({
    userId: lazadaImConnectionsTable.userId,
    sellerId: lazadaImConnectionsTable.lazadaSellerId,
    appFingerprint: lazadaImConnectionsTable.appFingerprint,
    country: lazadaImConnectionsTable.country,
  }).from(lazadaImConnectionsTable).where(and(
    eq(lazadaImConnectionsTable.lazadaSellerId, sellerId),
    eq(lazadaImConnectionsTable.appFingerprint, config.fingerprint),
    eq(lazadaImConnectionsTable.country, config.country),
  )).limit(2);

  if (matches.length !== 1) return null;
  const [match] = matches;
  return match.sellerId === sellerId
    && match.appFingerprint === config.fingerprint
    && match.country === config.country
    ? match.userId : null;
}

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
  const state = `im1_${nonce()}`;
  const browser = nonce();
  await db.transaction(async tx => {
    if (!await activeSession(tx, userId, sessionHash)) throw new LazadaError("authorization_failed");
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
  diagnostic?: (stage: ImOAuthDiagnosticStage, result: "started" | "succeeded" | "failed",
    category?: ImOAuthDiagnosticCategory, details?: ImOAuthDiagnosticDetails) => void,
): Promise<void> {
  const report = (stage: ImOAuthDiagnosticStage, result: "started" | "succeeded" | "failed",
    category?: ImOAuthDiagnosticCategory, details?: ImOAuthDiagnosticDetails) => {
    try { diagnostic?.(stage, result, category, details); } catch { /* Diagnostics must not affect OAuth. */ }
  };
  if (!isImOAuthState(state)) {
    report("state_cookie", "failed", "state_invalid");
    throw new LazadaError("authorization_failed");
  }
  if (!validNonce(browser)) {
    report("state_cookie", "failed", "cookie_invalid");
    throw new LazadaError("authorization_failed");
  }
  report("state_cookie", "started");
  let pending;
  try {
    [pending] = await db.delete(lazadaImOauthStatesTable).where(and(
      eq(lazadaImOauthStatesTable.stateHash, hash(state)),
      eq(lazadaImOauthStatesTable.browserHash, hash(browser)),
      gt(lazadaImOauthStatesTable.expiresAt, new Date()),
    )).returning();
  } catch (error) {
    report("state_cookie", "failed", "database_error");
    throw new Error("OAuth state claim failed");
  }
  if (!pending) {
    report("state_cookie", "failed", "state_not_found_expired_or_used");
    throw new LazadaError("authorization_failed");
  }
  report("state_cookie", "succeeded");
  if (!code) {
    report("authorization_code", "failed", "code_missing_or_rejected");
    throw new LazadaError("authorization_failed");
  }
  report("authorization_code", "succeeded");

  report("session_check", "started");
  let sessionActive: boolean;
  try {
    sessionActive = await db.transaction(tx => activeSession(tx, pending.userId, pending.sessionHash));
  } catch (error) {
    report("session_check", "failed", "database_error");
    throw new Error("OAuth session check failed");
  }
  if (!sessionActive) {
    report("session_check", "failed", "session_inactive");
    throw new LazadaError("authorization_failed");
  }
  report("session_check", "succeeded");

  const issuedAt = Date.now();
  report("token_exchange", "started");
  let tokens;
  let exchangeOutcomeReported = false;
  const exchangeDiagnostic = (stage: ImOAuthDiagnosticStage, result: "started" | "succeeded" | "failed",
    category?: ImOAuthDiagnosticCategory, details?: ImOAuthDiagnosticDetails) => {
    if (stage === "token_exchange" && (result === "succeeded" || result === "failed"))
      exchangeOutcomeReported = true;
    report(stage, result, category, details);
  };
  try {
    tokens = await createClient(config, undefined, undefined, undefined, exchangeDiagnostic).exchange(code);
  } catch (error) {
    if (!exchangeOutcomeReported)
      report("token_exchange", "failed", "local_failure");
    throw error;
  }
  const sellerId = tokens.sellerId;
  if (!sellerId) {
    report("seller_validation", "failed", "seller_identity_invalid");
    throw new LazadaError("invalid_response");
  }
  report("seller_validation", "succeeded");
  const expiresAt = new Date(issuedAt + tokens.expiresIn * 1000);
  if (expiresAt <= new Date()) {
    report("token_validation", "failed", "expiry_invalid");
    throw new LazadaError("authorization_failed");
  }
  report("token_validation", "succeeded");

  report("connection_storage", "started");
  try {
    await db.transaction(async tx => {
      if (!await activeSession(tx, pending.userId, pending.sessionHash)) {
        report("session_check", "failed", "session_inactive");
        throw new LazadaError("authorization_failed");
      }
      const values = {
        userId: pending.userId,
        lazadaSellerId: sellerId,
        appFingerprint: config.fingerprint,
        country: config.country,
        encryptedTokens: seal(JSON.stringify({
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
        }), config, pending.userId),
        expiresAt,
        refreshExpiresAt: new Date(issuedAt + tokens.refreshExpiresIn * 1000),
      };
      const [saved] = await tx.insert(lazadaImConnectionsTable).values(values).onConflictDoUpdate({
        target: lazadaImConnectionsTable.userId,
        set: values,
        // A user-scoped row cannot be silently rebound to a different or unknown seller.
        setWhere: eq(lazadaImConnectionsTable.lazadaSellerId, sellerId),
      }).returning({ userId: lazadaImConnectionsTable.userId });
      if (!saved) {
        report("connection_storage", "failed", "seller_conflict");
        throw new LazadaError("authorization_failed");
      }
    });
    report("connection_storage", "succeeded");
  } catch (error) {
    if (error instanceof LazadaError) throw error;
    if (isUniqueConstraintViolation(error)) {
      report("connection_storage", "failed", "seller_conflict");
      throw new LazadaError("authorization_failed");
    }
    report("connection_storage", "failed", "storage_error");
    throw error;
  }
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

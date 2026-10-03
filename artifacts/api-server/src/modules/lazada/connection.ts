import { and, eq, gt, lt } from "drizzle-orm";
import { db, usersTable, authSessionsTable, lazadaConnectionsTable as connections, lazadaOauthStatesTable as states } from "@workspace/db";
import { ABSOLUTE_MS } from "../auth/config";
import { createClient, LazadaError } from "./client";
import { configuration, hash, nonce, seal, unseal, type LazadaConfig } from "./security";

async function activeSession(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], userId: string, sessionHash: string) {
  // Match the user -> session lock order used by account reset/deactivation.
  const [user] = await tx.select({ id: usersTable.id }).from(usersTable)
    .where(and(eq(usersTable.id, userId), eq(usersTable.isActive, true))).for("update");
  if (!user) return false;
  const [session] = await tx.select({ hash: authSessionsTable.tokenHash }).from(authSessionsTable).where(and(
    eq(authSessionsTable.tokenHash, sessionHash), eq(authSessionsTable.userId, userId),
    gt(authSessionsTable.expiresAt, new Date()), gt(authSessionsTable.createdAt, new Date(Date.now() - ABSOLUTE_MS)),
  )).for("update");
  return !!session;
}

export async function startAuthorization(config: LazadaConfig, userId: string, sessionHash: string) {
  const state = nonce(), browser = nonce();
  await db.transaction(async tx => {
    if (!await activeSession(tx, userId, sessionHash)) throw new LazadaError("authorization_failed");
    await tx.delete(states).where(eq(states.userId, userId));
    await tx.delete(states).where(lt(states.expiresAt, new Date()));
    await tx.insert(states).values({ stateHash: hash(state), browserHash: hash(browser), userId, sessionHash,
      expiresAt: new Date(Date.now() + 10 * 60_000) });
  });
  const url = new URL("https://auth.lazada.com/oauth/authorize");
  url.search = new URLSearchParams({ response_type: "code", force_auth: "true", client_id: config.appKey,
    redirect_uri: config.callback.href, state }).toString();
  // No scope parameter: permission selection belongs in the app's Lazada console.
  return { authorizationUrl: url.href, browser };
}

export async function finishAuthorization(config: LazadaConfig, state: string, browser: string, code: string | null) {
  // Atomic single-use claim, also bound to the browser that initiated authorization.
  const [pending] = await db.delete(states).where(and(eq(states.stateHash, hash(state)),
    eq(states.browserHash, hash(browser)), gt(states.expiresAt, new Date()))).returning();
  if (!pending || !code) throw new LazadaError("authorization_failed");
  const alive = await db.transaction(tx => activeSession(tx, pending.userId, pending.sessionHash));
  if (!alive) throw new LazadaError("authorization_failed");
  const client = createClient(config);
  const issuedAt = Date.now();
  const tokens = await client.exchange(code);
  await client.check(tokens.accessToken);
  const expiresAt = new Date(issuedAt + tokens.expiresIn * 1000);
  if (expiresAt <= new Date()) throw new LazadaError("authorization_failed");
  await db.transaction(async tx => {
    // A session revoked while the provider was being contacted cannot install tokens.
    if (!await activeSession(tx, pending.userId, pending.sessionHash)) throw new LazadaError("authorization_failed");
    const values = { userId: pending.userId, appFingerprint: config.fingerprint, country: config.country,
      encryptedTokens: seal(JSON.stringify({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken }), config, pending.userId),
      expiresAt, refreshExpiresAt: new Date(issuedAt + tokens.refreshExpiresIn * 1000),
      verified: "yes", checkedAt: new Date() };
    await tx.insert(connections).values(values).onConflictDoUpdate({ target: connections.userId, set: values });
  });
}

export async function connectionStatus(userId: string) {
  const config = configuration();
  const [row] = await db.select().from(connections).where(eq(connections.userId, userId));
  let reason = !config ? "not_configured" : !row ? "not_connected" : row.expiresAt <= new Date() ? "expired"
    : row.appFingerprint !== config.fingerprint || row.country !== config.country || row.verified !== "yes" ? "verification_failed" : "connected";
  if (reason === "connected" && row && config) {
    try { JSON.parse(unseal(row.encryptedTokens, config, userId)); } catch { reason = "verification_failed"; }
  }
  return { mode: "testing" as const, configured: !!config, connected: reason === "connected", reason,
    country: row?.country ?? config?.country ?? null, expiresAt: row?.expiresAt.toISOString() ?? null,
    lastCheckedAt: row?.checkedAt.toISOString() ?? null, callbackUri: config?.callback.href ?? null };
}

export async function checkConnection(userId: string) {
  const config = configuration();
  if (!config) throw new LazadaError("authorization_failed");
  const [row] = await db.select().from(connections).where(eq(connections.userId, userId));
  if (!row || row.appFingerprint !== config.fingerprint || row.country !== config.country || row.expiresAt <= new Date())
    throw new LazadaError("authorization_failed");
  try {
    const tokens = JSON.parse(unseal(row.encryptedTokens, config, userId));
    if (typeof tokens.accessToken !== "string" || !tokens.accessToken) throw new LazadaError("authorization_failed");
    await createClient(config).check(tokens.accessToken);
    await db.update(connections).set({ verified: "yes", checkedAt: new Date() }).where(and(
      eq(connections.userId, userId), eq(connections.encryptedTokens, row.encryptedTokens),
    ));
  } catch (error) {
    await db.update(connections).set({ verified: "no", checkedAt: new Date() }).where(and(
      eq(connections.userId, userId), eq(connections.encryptedTokens, row.encryptedTokens),
    ));
    throw error instanceof LazadaError ? error : new LazadaError("authorization_failed");
  }
  return connectionStatus(userId);
}
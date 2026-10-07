import { eq } from "drizzle-orm";
import { db, lazadaConnectionsTable } from "@workspace/db";
import { LazadaError } from "./client";
import { createImClient, type ImPageInput } from "./im-client";
import { configuration, unseal } from "./security";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

async function currentUserClient(userId: string) {
  const config = configuration();
  if (!config) throw new LazadaError("authorization_failed");
  const [connection] = await db.select({
    encryptedTokens: lazadaConnectionsTable.encryptedTokens,
    appFingerprint: lazadaConnectionsTable.appFingerprint,
    country: lazadaConnectionsTable.country,
    expiresAt: lazadaConnectionsTable.expiresAt,
    verified: lazadaConnectionsTable.verified,
  }).from(lazadaConnectionsTable).where(eq(lazadaConnectionsTable.userId, userId)).limit(1);
  if (!connection || connection.verified !== "yes"
    || connection.appFingerprint !== config.fingerprint || connection.country !== config.country
    || connection.expiresAt.getTime() <= Date.now()) throw new LazadaError("authorization_failed");

  try {
    const tokens: unknown = JSON.parse(unseal(connection.encryptedTokens, config, userId));
    if (!isRecord(tokens) || typeof tokens.accessToken !== "string"
      || tokens.accessToken.length === 0 || tokens.accessToken.length > 8192)
      throw new Error("Invalid stored token");
    return { client: createImClient(config), accessToken: tokens.accessToken };
  } catch {
    throw new LazadaError("authorization_failed");
  }
}

export async function getImSessionList(userId: string, input: ImPageInput) {
  const { client, accessToken } = await currentUserClient(userId);
  return client.getSessionList(accessToken, input);
}

export async function getImSessionDetail(userId: string, sessionId: string) {
  const { client, accessToken } = await currentUserClient(userId);
  return client.getSessionDetail(accessToken, sessionId);
}

export async function getImMessages(userId: string, sessionId: string, input: ImPageInput) {
  const { client, accessToken } = await currentUserClient(userId);
  return client.getMessages(accessToken, sessionId, input);
}

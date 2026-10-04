import { and, eq, gt } from "drizzle-orm";
import { db, lazadaConnectionsTable, usersTable } from "@workspace/db";
import { LazadaError } from "./client";
import { unseal, type LazadaConfig } from "./security";
import type { OrderTx } from "./order-store";

// The existing Seller In-house integration is single-account. Do not guess which
// seller token to use if multiple eligible connections are found for the same app.
export async function automaticConnection(tx: OrderTx | typeof db, config: LazadaConfig, userId?: string) {
  const rows = await tx.select({ connection: lazadaConnectionsTable }).from(lazadaConnectionsTable)
    .innerJoin(usersTable, eq(usersTable.id, lazadaConnectionsTable.userId))
    .where(and(eq(lazadaConnectionsTable.appFingerprint, config.fingerprint),
      eq(lazadaConnectionsTable.country, config.country), eq(lazadaConnectionsTable.verified, "yes"),
      gt(lazadaConnectionsTable.expiresAt, new Date()), eq(usersTable.isActive, true),
      userId ? eq(lazadaConnectionsTable.userId, userId) : undefined)).limit(2);
  if (rows.length !== 1) throw new LazadaError("authorization_failed");
  return rows[0].connection;
}
export function automaticToken(connection: Awaited<ReturnType<typeof automaticConnection>>, config: LazadaConfig) {
  try {
    const token = JSON.parse(unseal(connection.encryptedTokens, config, connection.userId)).accessToken;
    if (typeof token !== "string" || !token) throw new Error();
    return token as string;
  } catch { throw new LazadaError("authorization_failed"); }
}
export async function guardAutomaticConnection(tx: OrderTx, connection: Awaited<ReturnType<typeof automaticConnection>>) {
  const [valid] = await tx.select({ id: lazadaConnectionsTable.userId }).from(lazadaConnectionsTable)
    .innerJoin(usersTable, eq(usersTable.id, lazadaConnectionsTable.userId)).where(and(
      eq(lazadaConnectionsTable.userId, connection.userId),
      eq(lazadaConnectionsTable.encryptedTokens, connection.encryptedTokens),
      eq(lazadaConnectionsTable.appFingerprint, connection.appFingerprint),
      eq(lazadaConnectionsTable.country, connection.country),
      eq(lazadaConnectionsTable.verified, "yes"), gt(lazadaConnectionsTable.expiresAt, new Date()),
      eq(usersTable.isActive, true),
    )).for("update");
  if (!valid) throw new LazadaError("authorization_failed");
}
import { sql } from "drizzle-orm";
import { db, authLoginBucketsTable } from "@workspace/db";
import { digest } from "./config";

export async function consumeLoginQuota(ip: string, email?: string) {
  const buckets = [{ key: digest("login-ip", ip), limit: 30 }];
  if (email) buckets.push({ key: digest("login-account", email), limit: 5 });
  return db.transaction(async (tx) => {
    let retryAfter = 0;
    for (const bucket of buckets) {
      const [row] = await tx.insert(authLoginBucketsTable).values({
        key: bucket.key, attempts: 1, resetAt: new Date(Date.now() + 15 * 60 * 1000),
      }).onConflictDoUpdate({
        target: authLoginBucketsTable.key,
        set: {
          attempts: sql`case when ${authLoginBucketsTable.resetAt} <= now() then 1 else ${authLoginBucketsTable.attempts} + 1 end`,
          resetAt: sql`case when ${authLoginBucketsTable.resetAt} <= now() then now() + interval '15 minutes' else ${authLoginBucketsTable.resetAt} end`,
        },
      }).returning();
      if (row.attempts > bucket.limit) {
        retryAfter = Math.max(retryAfter, Math.max(1, Math.ceil((row.resetAt.getTime() - Date.now()) / 1000)));
      }
    }
    return retryAfter;
  });
}

// Bound expensive scrypt work; excess concurrent verification fails closed.
let verifying = 0;
export async function withPasswordSlot<T>(fn: () => Promise<T>): Promise<T | undefined> {
  if (verifying >= 4) return undefined;
  verifying++;
  try { return await fn(); } finally { verifying--; }
}
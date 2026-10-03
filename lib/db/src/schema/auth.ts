import { pgTable, text, uuid, timestamp, integer, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const authSessionsTable = pgTable("auth_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => [index("auth_sessions_user_id_idx").on(t.userId), index("auth_sessions_expires_at_idx").on(t.expiresAt)]);

export const authLoginBucketsTable = pgTable("auth_login_buckets", {
  key: text("key").primaryKey(),
  attempts: integer("attempts").notNull(),
  resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
}, (t) => [index("auth_login_buckets_reset_at_idx").on(t.resetAt)]);
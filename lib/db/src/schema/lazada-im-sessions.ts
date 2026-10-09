import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { lazadaImConnectionsTable } from "./lazada-im-connections";

// user_id is also the primary key of the user's isolated IM connection.
export const lazadaImSessionsTable = pgTable("lazada_im_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => lazadaImConnectionsTable.userId, { onDelete: "cascade" }),
  lazadaSessionId: text("lazada_session_id").notNull(),
  unreadCount: integer("unread_count").notNull().default(0),
  lastMessageId: text("last_message_id"),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  siteId: text("site_id"),
  syncRequestedAt: timestamp("sync_requested_at", { withTimezone: true }),
  syncStartAt: timestamp("sync_start_at", { withTimezone: true }),
  syncRequestVersion: integer("sync_request_version").notNull().default(0),
  syncCursorStartTime: text("sync_cursor_start_time"),
  syncCursorMessageId: text("sync_cursor_message_id"),
  syncCursorRequestVersion: integer("sync_cursor_request_version"),
  syncCursorHistory: text("sync_cursor_history").array().notNull().default(sql`ARRAY[]::text[]`),
  syncNextAttemptAt: timestamp("sync_next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  syncAttempts: integer("sync_attempts").notNull().default(0),
  syncBlockedAt: timestamp("sync_blocked_at", { withTimezone: true }),
  syncLeaseUntil: timestamp("sync_lease_until", { withTimezone: true }),
  syncLeaseToken: uuid("sync_lease_token"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  unique("lazada_im_sessions_user_provider_uq").on(table.userId, table.lazadaSessionId),
  check("lazada_im_sessions_provider_id_not_blank", sql`length(btrim(${table.lazadaSessionId})) > 0`),
  check("lazada_im_sessions_unread_nonnegative", sql`${table.unreadCount} >= 0`),
  check("lazada_im_sessions_sync_request_version_nonnegative", sql`${table.syncRequestVersion} >= 0`),
  check(
    "lazada_im_sessions_sync_cursor_version_nonnegative",
    sql`${table.syncCursorRequestVersion} IS NULL OR ${table.syncCursorRequestVersion} >= 0`,
  ),
  check(
    "lazada_im_sessions_sync_cursor_fields_consistent",
    sql`(
      ${table.syncCursorStartTime} IS NULL
      AND ${table.syncCursorMessageId} IS NULL
      AND ${table.syncCursorRequestVersion} IS NULL
    ) OR (
      ${table.syncCursorStartTime} IS NOT NULL
      AND ${table.syncCursorMessageId} IS NOT NULL
      AND ${table.syncCursorRequestVersion} IS NOT NULL
    )`,
  ),
  check("lazada_im_sessions_sync_attempts_nonnegative", sql`${table.syncAttempts} >= 0`),
  index("lazada_im_sessions_user_last_message_idx").on(table.userId, table.lastMessageAt),
  index("lazada_im_sessions_sync_due_idx")
    .on(table.syncNextAttemptAt, table.syncRequestedAt)
    .where(sql`${table.syncRequestedAt} is not null`),
]);

export const insertLazadaImSessionSchema = createInsertSchema(lazadaImSessionsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertLazadaImSession = z.infer<typeof insertLazadaImSessionSchema>;
export type LazadaImSession = typeof lazadaImSessionsTable.$inferSelect;

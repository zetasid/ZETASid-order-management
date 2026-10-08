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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  unique("lazada_im_sessions_user_provider_uq").on(table.userId, table.lazadaSessionId),
  check("lazada_im_sessions_provider_id_not_blank", sql`length(btrim(${table.lazadaSessionId})) > 0`),
  check("lazada_im_sessions_unread_nonnegative", sql`${table.unreadCount} >= 0`),
  index("lazada_im_sessions_user_last_message_idx").on(table.userId, table.lastMessageAt),
]);

export const insertLazadaImSessionSchema = createInsertSchema(lazadaImSessionsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertLazadaImSession = z.infer<typeof insertLazadaImSessionSchema>;
export type LazadaImSession = typeof lazadaImSessionsTable.$inferSelect;

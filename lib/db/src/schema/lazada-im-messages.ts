import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { lazadaImSessionsTable } from "./lazada-im-sessions";

// Store only mapped fields needed for chat; never persist the raw provider payload.
export const lazadaImMessagesTable = pgTable("lazada_im_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionId: uuid("session_id").notNull().references(() => lazadaImSessionsTable.id, { onDelete: "cascade" }),
  lazadaMessageId: text("lazada_message_id").notNull(),
  fromAccountId: text("from_account_id"),
  toAccountId: text("to_account_id"),
  fromAccountType: integer("from_account_type"),
  toAccountType: integer("to_account_type"),
  content: text("content"),
  templateId: integer("template_id"),
  messageType: integer("message_type"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  providerStatus: text("provider_status"),
  autoReply: boolean("auto_reply"),
  isRead: boolean("is_read"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("lazada_im_messages_session_provider_uq").on(table.sessionId, table.lazadaMessageId),
  check("lazada_im_messages_provider_id_not_blank", sql`length(btrim(${table.lazadaMessageId})) > 0`),
  index("lazada_im_messages_session_sent_at_idx").on(table.sessionId, table.sentAt),
  index("lazada_im_messages_created_at_idx").on(table.createdAt),
]);

export const insertLazadaImMessageSchema = createInsertSchema(lazadaImMessagesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertLazadaImMessage = z.infer<typeof insertLazadaImMessageSchema>;
export type LazadaImMessage = typeof lazadaImMessagesTable.$inferSelect;

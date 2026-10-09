import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { lazadaImConnectionsTable } from "./lazada-im-connections";

// Stores only a ZETAS-internal deduplication key, not a Lazada event ID or payload.
export const lazadaImPushEventReceiptsTable = pgTable("lazada_im_push_event_receipts", {
  userId: uuid("user_id").notNull().references(() => lazadaImConnectionsTable.userId, { onDelete: "cascade" }),
  // HMAC-scoped digest of the exact raw body and item index; no raw callback data is stored.
  eventKey: text("event_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("lazada_im_push_event_receipts_user_event_uq").on(table.userId, table.eventKey),
  check("lazada_im_push_event_receipts_key_hex", sql`${table.eventKey} ~ '^[0-9a-f]{64}$'`),
  index("lazada_im_push_event_receipts_created_idx").on(table.createdAt),
]);

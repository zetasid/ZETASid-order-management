import { pgTable, uuid, text, timestamp, integer, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { usersTable } from "./users";

export const lazadaOrderPushTable = pgTable("lazada_order_push", {
  id: uuid("id").defaultRandom().primaryKey(),
  eventHash: text("event_hash").notNull().unique(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  appFingerprint: text("app_fingerprint").notNull(),
  orderId: text("order_id").notNull(),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  lastError: text("last_error"),
}, t => [
  index("lazada_order_push_due_idx").on(t.status, t.nextAttemptAt),
  check("lazada_order_push_status_check", sql`${t.status} in ('pending', 'done')`),
  check("lazada_order_push_attempts_check", sql`${t.attempts} >= 0`),
]);

export const lazadaOrderAutomationTable = pgTable("lazada_order_automation", {
  userId: uuid("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  appFingerprint: text("app_fingerprint").notNull(),
  lastPush: timestamp("last_push", { withTimezone: true }),
  lastProcessedPush: timestamp("last_processed_push", { withTimezone: true }),
  lastSync: timestamp("last_sync", { withTimezone: true }),
  lastError: text("last_error"),
  nextReconcileAt: timestamp("next_reconcile_at", { withTimezone: true }).notNull().defaultNow(),
  reconciledThrough: timestamp("reconciled_through", { withTimezone: true }),
  rangeStart: timestamp("range_start", { withTimezone: true }),
  rangeEnd: timestamp("range_end", { withTimezone: true }),
  offset: integer("offset").notNull().default(0),
});
export const insertLazadaOrderPushSchema = createInsertSchema(lazadaOrderPushTable);
export const insertLazadaOrderAutomationSchema = createInsertSchema(lazadaOrderAutomationTable);
export type LazadaOrderPush = typeof lazadaOrderPushTable.$inferSelect;
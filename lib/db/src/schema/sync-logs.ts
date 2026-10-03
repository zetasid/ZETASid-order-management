import { pgTable, uuid, text, timestamp, integer, jsonb, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Storage foundation only; no synchronization worker or external API is enabled.
export const syncLogsTable = pgTable("sync_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  source: text("source").notNull().default("lazada"),
  status: text("status").notNull().default("pending"),
  recordsCount: integer("records_count").notNull().default(0),
  message: text("message"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("sync_logs_created_at_idx").on(table.createdAt),
  check("sync_logs_status_valid", sql`${table.status} in ('pending', 'running', 'completed', 'failed')`),
  check("sync_logs_records_count_nonnegative", sql`${table.recordsCount} >= 0`),
  check("sync_logs_time_valid", sql`${table.finishedAt} is null or ${table.finishedAt} >= ${table.startedAt}`),
]);

export const insertSyncLogSchema = createInsertSchema(syncLogsTable).omit({ id: true, createdAt: true });
export type InsertSyncLog = z.infer<typeof insertSyncLogSchema>;
export type SyncLog = typeof syncLogsTable.$inferSelect;
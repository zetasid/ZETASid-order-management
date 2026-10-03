import { pgTable, uuid, text, jsonb, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const systemLogsTable = pgTable("system_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  level: text("level").notNull().default("info"),
  message: text("message").notNull(),
  context: jsonb("context").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("system_logs_created_at_idx").on(table.createdAt),
  check("system_logs_level_valid", sql`${table.level} in ('debug', 'info', 'warn', 'error')`),
]);

export const insertSystemLogSchema = createInsertSchema(systemLogsTable).omit({ id: true, createdAt: true });
export type InsertSystemLog = z.infer<typeof insertSystemLogSchema>;
export type SystemLog = typeof systemLogsTable.$inferSelect;
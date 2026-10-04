import { pgEnum, pgTable, text, numeric, jsonb, timestamp, uuid, check, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const orderStatus = pgEnum("order_status", ["pending", "processing", "completed", "cancelled"]);

export const ordersTable = pgTable("orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  lazadaOrderId: text("lazada_order_id").notNull().unique(),
  // Legacy header fields are retained to preserve existing data and the phase-one API.
  marketplaceOrderId: text("marketplace_order_id").unique(),
  productName: text("product_name").notNull().default(""),
  buyerName: text("buyer_name"),
  amount: numeric("amount", { precision: 18, scale: 2, mode: "number" }).default(0),
  // Only selected, original order fields; no credentials or unnecessary address data.
  lazadaData: jsonb("lazada_data").$type<Record<string, unknown>>(),
  syncedAt: timestamp("synced_at", { withTimezone: true }),
  status: orderStatus("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  check("orders_amount_nonnegative", sql`${table.amount} >= 0`),
  check("orders_lazada_id_not_blank", sql`length(btrim(${table.lazadaOrderId})) > 0`),
  index("orders_created_at_idx").on(table.createdAt),
]);

export const insertOrderSchema = createInsertSchema(ordersTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof ordersTable.$inferSelect;
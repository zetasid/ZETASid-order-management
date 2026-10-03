import { pgTable, uuid, text, jsonb, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { ordersTable, orderStatus } from "./orders";

export const orderItemsTable = pgTable("order_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  lazadaOrderItemId: text("lazada_order_item_id").notNull().unique(),
  orderId: uuid("order_id").notNull().references(() => ordersTable.id, { onDelete: "restrict" }),
  productName: text("product_name").notNull(),
  digitalDetail: jsonb("digital_detail").$type<Record<string, unknown>>(),
  status: orderStatus("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("order_items_order_id_idx").on(table.orderId),
  check("order_items_lazada_id_not_blank", sql`length(btrim(${table.lazadaOrderItemId})) > 0`),
]);

export const insertOrderItemSchema = createInsertSchema(orderItemsTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertOrderItem = z.infer<typeof insertOrderItemSchema>;
export type OrderItem = typeof orderItemsTable.$inferSelect;
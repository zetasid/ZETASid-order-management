import { relations } from "drizzle-orm";
import { ordersTable } from "./orders";
import { orderItemsTable } from "./order-items";
import { lazadaImConnectionsTable } from "./lazada-im-connections";
import { lazadaImMessagesTable } from "./lazada-im-messages";
import { lazadaImPushEventReceiptsTable } from "./lazada-im-push-event-receipts";
import { lazadaImSessionsTable } from "./lazada-im-sessions";

export const ordersRelations = relations(ordersTable, ({ many }) => ({
  items: many(orderItemsTable),
}));

export const orderItemsRelations = relations(orderItemsTable, ({ one }) => ({
  order: one(ordersTable, {
    fields: [orderItemsTable.orderId],
    references: [ordersTable.id],
  }),
}));

export const lazadaImConnectionsRelations = relations(lazadaImConnectionsTable, ({ many }) => ({
  sessions: many(lazadaImSessionsTable),
  pushEventReceipts: many(lazadaImPushEventReceiptsTable),
}));

export const lazadaImPushEventReceiptsRelations = relations(lazadaImPushEventReceiptsTable, ({ one }) => ({
  connection: one(lazadaImConnectionsTable, {
    fields: [lazadaImPushEventReceiptsTable.userId],
    references: [lazadaImConnectionsTable.userId],
  }),
}));

export const lazadaImSessionsRelations = relations(lazadaImSessionsTable, ({ many, one }) => ({
  connection: one(lazadaImConnectionsTable, {
    fields: [lazadaImSessionsTable.userId],
    references: [lazadaImConnectionsTable.userId],
  }),
  messages: many(lazadaImMessagesTable),
}));

export const lazadaImMessagesRelations = relations(lazadaImMessagesTable, ({ one }) => ({
  session: one(lazadaImSessionsTable, {
    fields: [lazadaImMessagesTable.sessionId],
    references: [lazadaImSessionsTable.id],
  }),
}));
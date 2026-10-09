import { sql } from "drizzle-orm";
import { pgTable, text, uuid, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// Isolated from Seller In-house APP tokens; never expose this row as an API DTO.
export const lazadaImConnectionsTable = pgTable("lazada_im_connections", {
  userId: uuid("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  // Nullable so existing connections remain usable until the seller reauthorizes.
  lazadaSellerId: text("lazada_seller_id"),
  encryptedTokens: text("encrypted_tokens").notNull(),
  appFingerprint: text("app_fingerprint").notNull(),
  country: text("country").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  refreshExpiresAt: timestamp("refresh_expires_at", { withTimezone: true }).notNull(),
}, (table) => [
  // appFingerprint scopes the provider ID; it is not itself a seller identity.
  uniqueIndex("lazada_im_connections_app_country_seller_uq")
    .on(table.appFingerprint, table.country, table.lazadaSellerId)
    .where(sql`${table.lazadaSellerId} IS NOT NULL`),
]);

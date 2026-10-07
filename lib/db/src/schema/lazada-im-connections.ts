import { pgTable, text, uuid, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// Isolated from Seller In-house APP tokens; never expose this row as an API DTO.
export const lazadaImConnectionsTable = pgTable("lazada_im_connections", {
  userId: uuid("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  encryptedTokens: text("encrypted_tokens").notNull(),
  appFingerprint: text("app_fingerprint").notNull(),
  country: text("country").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  refreshExpiresAt: timestamp("refresh_expires_at", { withTimezone: true }).notNull(),
});

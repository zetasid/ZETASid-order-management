import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// One private connection per authorized ZETAS user. Never expose this row as an API DTO.
export const lazadaConnectionsTable = pgTable("lazada_connections", {
  userId: uuid("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  encryptedTokens: text("encrypted_tokens").notNull(),
  appFingerprint: text("app_fingerprint").notNull(),
  country: text("country").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  refreshExpiresAt: timestamp("refresh_expires_at", { withTimezone: true }).notNull(),
  verified: text("verified").notNull().default("yes"),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
});
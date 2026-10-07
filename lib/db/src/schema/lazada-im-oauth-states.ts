import { pgTable, text, uuid, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { authSessionsTable } from "./auth";

export const lazadaImOauthStatesTable = pgTable("lazada_im_oauth_states", {
  stateHash: text("state_hash").primaryKey(),
  browserHash: text("browser_hash").notNull(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  sessionHash: text("session_hash").notNull().references(() => authSessionsTable.tokenHash, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => [index("lazada_im_oauth_expiry_idx").on(t.expiresAt)]);

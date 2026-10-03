import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { pool } from "@workspace/db";

// The production image places versioned SQL next to dist, not inside source.
const migrationsFolder = process.env.MIGRATIONS_DIR ??
  fileURLToPath(new URL("../migrations/", import.meta.url));
const migrationsSchema = process.env.MIGRATIONS_SCHEMA ?? "drizzle";

async function main() {
  const client = await pool.connect();
  try {
    // Serialize installers/updaters against the same DB, on the same connection.
    await client.query("SELECT pg_advisory_lock(726382510)");
    try {
      await migrate(drizzle(client), { migrationsFolder, migrationsSchema });
    } finally {
      await client.query("SELECT pg_advisory_unlock(726382510)");
    }
    process.stdout.write("Database migrations completed successfully.\n");
  } finally {
    client.release();
  }
}

try {
  await main();
} catch {
  // Raw driver errors can contain connection strings, SQL and credentials.
  process.stderr.write("Database migration failed. Application startup is blocked; check database access and versioned migrations privately.\n");
  process.exitCode = 1;
} finally {
  await pool.end();
}
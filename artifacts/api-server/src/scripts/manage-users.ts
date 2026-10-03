// Run only from a trusted operator console, never from an HTTP endpoint.
import { db, pool, usersTable, authSessionsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { hashPassword } from "../modules/auth/password";

try {
  const action = process.argv[2] ?? "create";
  if (!["create", "reset-password", "disable"].includes(action)) throw new Error("Invalid action");
  const email = process.env.AUTH_SETUP_EMAIL?.trim().toLowerCase();
  const password = process.env.AUTH_SETUP_PASSWORD;
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Invalid setup input");
  if (action !== "disable" && !password) throw new Error("Missing setup password");
  const hash = action === "disable" ? null : await hashPassword(password!);
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${email}))`);
    const rows = await tx.select().from(usersTable).where(sql`lower(${usersTable.email}) = ${email}`).limit(2);
    if (rows.length > 1) throw new Error("Ambiguous account");
    const user = rows[0];
    if (action === "disable") {
      if (!user) throw new Error("Account unavailable");
      await tx.update(usersTable).set({ isActive: false }).where(eq(usersTable.id, user.id));
      await tx.delete(authSessionsTable).where(eq(authSessionsTable.userId, user.id));
    } else if (user) {
      if (action === "create" && user.passwordHash) throw new Error("Account already configured");
      await tx.update(usersTable).set({ passwordHash: hash, isActive: true }).where(eq(usersTable.id, user.id));
      await tx.delete(authSessionsTable).where(eq(authSessionsTable.userId, user.id));
    } else {
      if (action !== "create") throw new Error("Account unavailable");
      await tx.insert(usersTable).values({ email, passwordHash: hash });
    }
  });
  console.log("Account operation completed.");
} catch {
  // Never print credentials, database errors, hashes, or connection strings.
  console.error("Account operation failed. Check action, setup secrets, password length (12–128), and account state.");
  process.exitCode = 1;
} finally { await pool.end(); }
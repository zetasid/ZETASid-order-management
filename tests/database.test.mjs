import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

const require = createRequire(new URL("../lib/db/package.json", import.meta.url));
const { Pool } = require("pg");
assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
after(() => pool.end());

const oldSql = await readFile(new URL("../lib/db/migrations/0000_volatile_mandarin.sql", import.meta.url), "utf8");
const upgradeSql = await readFile(new URL("../lib/db/migrations/0001_phase2_database.sql", import.meta.url), "utf8");
const authSql = await readFile(new URL("../lib/db/migrations/0003_phase4_local_auth.sql", import.meta.url), "utf8");

// Replay real migration SQL in a random, transaction-local schema. Rollback removes
// only test objects; no existing public table or application row is modified.
async function isolated(fn) {
  const client = await pool.connect();
  const schema = `zetas_test_${randomUUID().replaceAll("-", "")}`;
  assert.match(schema, /^[a-z_0-9]+$/);
  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}", public`);
    const scope = (sql) => sql.replaceAll('"public".', `"${schema}".`);
    await client.query(scope(oldSql));
    await fn(client, scope(upgradeSql), schema);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

async function rejectsWrite(client, statement, values, code) {
  await client.query("SAVEPOINT rejected_write");
  try {
    await assert.rejects(client.query(statement, values), (error) => error.code === code);
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT rejected_write");
    await client.query("RELEASE SAVEPOINT rejected_write");
  }
}

test("Schema aktif memuat lima tabel dan kolom order/item wajib", async () => {
  const { rows } = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE'",
    ["public"],
  );
  for (const name of ["users", "orders", "order_items", "sync_logs", "system_logs"]) {
    assert.ok(rows.some((row) => row.table_name === name), name);
  }
  for (const [table, columns] of [
    ["orders", ["id", "lazada_order_id", "status", "created_at", "updated_at"]],
    ["order_items", ["id", "lazada_order_item_id", "order_id", "product_name", "digital_detail", "status", "created_at", "updated_at"]],
  ]) {
    const result = await pool.query(
      "SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2",
      ["public", table],
    );
    for (const column of columns) {
      const record = result.rows.find((row) => row.column_name === column);
      assert.ok(record, `${table}.${column}`);
      if (column !== "digital_detail") assert.equal(record.is_nullable, "NO", `${table}.${column}`);
    }
  }
});

test("Migration dari fase awal mempertahankan data, relasi, keunikan dan timestamps", async () => {
  await isolated(async (client, migration) => {
    const legacyId = randomUUID();
    await client.query(
      `INSERT INTO orders (id, marketplace_order_id, product_name, buyer_name, amount, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [legacyId, "legacy-order-123", "Produk lama", "Fixture pembeli", 35000, "completed", "2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z"],
    );
    const before = (await client.query("SELECT * FROM orders WHERE id = $1", [legacyId])).rows[0];
    await client.query(migration);
    const upgraded = (await client.query("SELECT * FROM orders WHERE id = $1", [legacyId])).rows[0];
    const { lazada_order_id, ...preserved } = upgraded;
    assert.deepEqual(preserved, before);
    assert.equal(lazada_order_id, before.marketplace_order_id);

    const newOrderId = randomUUID();
    await client.query("INSERT INTO orders (id, lazada_order_id) VALUES ($1, $2)", [newOrderId, "new-order-456"]);
    const itemId = randomUUID();
    const detail = { target: "fixture-target", category: "digital" };
    await client.query(
      "INSERT INTO order_items (id, lazada_order_item_id, order_id, product_name, digital_detail) VALUES ($1, $2, $3, $4, $5)",
      [itemId, "item-001", legacyId, "Produk digital A", JSON.stringify(detail)],
    );
    await client.query(
      "INSERT INTO order_items (lazada_order_item_id, order_id, product_name) VALUES ($1, $2, $3)",
      ["item-002", legacyId, "Produk digital B"],
    );
    const children = (await client.query("SELECT * FROM order_items WHERE order_id = $1 ORDER BY lazada_order_item_id", [legacyId])).rows;
    assert.equal(children.length, 2);
    assert.deepEqual(children[0].digital_detail, detail);

    await rejectsWrite(client, "INSERT INTO orders (lazada_order_id) VALUES ($1)", ["legacy-order-123"], "23505");
    // Item IDs are unique globally, even if the attempted parent order differs.
    await rejectsWrite(client,
      "INSERT INTO order_items (lazada_order_item_id, order_id, product_name) VALUES ($1, $2, $3)",
      ["item-001", newOrderId, "Duplikat"], "23505");
    await rejectsWrite(client,
      "INSERT INTO order_items (lazada_order_item_id, order_id, product_name) VALUES ($1, $2, $3)",
      ["missing-parent-item", randomUUID(), "Yatim"], "23503");
    await rejectsWrite(client, "DELETE FROM orders WHERE id = $1", [legacyId], "23503");
    await rejectsWrite(client, "INSERT INTO orders (lazada_order_id) VALUES ($1)", [null], "23502");
    await rejectsWrite(client, "INSERT INTO orders (lazada_order_id) VALUES ($1)", ["  "], "23514");
    await rejectsWrite(client,
      "INSERT INTO order_items (lazada_order_item_id, order_id, product_name) VALUES ($1, $2, $3)",
      ["", legacyId, "Kosong"], "23514");
    await rejectsWrite(client, "UPDATE orders SET status = $1 WHERE id = $2", ["invalid", legacyId], "22P02");

    await client.query("UPDATE orders SET status = $1 WHERE id = $2", ["pending", legacyId]);
    const changedOrder = (await client.query("SELECT * FROM orders WHERE id = $1", [legacyId])).rows[0];
    assert.deepEqual(changedOrder.created_at, before.created_at);
    assert.ok(changedOrder.updated_at > before.updated_at);
    await client.query("SELECT pg_sleep(0.01)");
    await client.query("UPDATE order_items SET status = $1 WHERE id = $2", ["completed", itemId]);
    const changedItem = (await client.query("SELECT * FROM order_items WHERE id = $1", [itemId])).rows[0];
    assert.ok(changedItem.updated_at > changedItem.created_at);

    const user = (await client.query(
      "INSERT INTO users (email, display_name) VALUES ($1, $2) RETURNING *",
      ["fixture@example.invalid", "Fixture"],
    )).rows[0];
    await rejectsWrite(client, "INSERT INTO users (email) VALUES ($1)", ["fixture@example.invalid"], "23505");
    await client.query("SELECT pg_sleep(0.01)");
    await client.query("UPDATE users SET display_name = $1 WHERE id = $2", ["Updated fixture", user.id]);
    const changedUser = (await client.query("SELECT * FROM users WHERE id = $1", [user.id])).rows[0];
    assert.ok(changedUser.updated_at > user.updated_at);

    const syncLog = (await client.query(
      "INSERT INTO sync_logs (status, records_count, metadata) VALUES ($1, $2, $3) RETURNING *",
      ["completed", 2, JSON.stringify({ test: true })],
    )).rows[0];
    assert.equal(syncLog.records_count, 2);
    assert.deepEqual(syncLog.metadata, { test: true });
    await rejectsWrite(client, "INSERT INTO sync_logs (records_count) VALUES ($1)", [-1], "23514");
    await rejectsWrite(client, "INSERT INTO sync_logs (status) VALUES ($1)", ["invalid"], "23514");
    const log = (await client.query(
      "INSERT INTO system_logs (level, message, context) VALUES ($1, $2, $3) RETURNING *",
      ["info", "Fixture log", JSON.stringify({ test: true })],
    )).rows[0];
    assert.deepEqual(log.context, { test: true });
    await rejectsWrite(client, "INSERT INTO system_logs (level, message) VALUES ($1, $2)", ["invalid", "Fixture"], "23514");
  });
});

test("Data ID lama invalid menggagalkan migration secara atomik tanpa menghapus data", async () => {
  await isolated(async (client, migration, schema) => {
    const id = randomUUID();
    await client.query(
      "INSERT INTO orders (id, marketplace_order_id, product_name, amount) VALUES ($1, $2, $3, $4)",
      [id, "", "Fixture legacy invalid", 1234],
    );
    const before = (await client.query("SELECT * FROM orders WHERE id = $1", [id])).rows[0];
    await rejectsWrite(client, migration, [], "23514");
    assert.deepEqual((await client.query("SELECT * FROM orders WHERE id = $1", [id])).rows[0], before);
    const cols = await client.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2",
      [schema, "orders"],
    );
    assert.ok(!cols.rows.some((row) => row.column_name === "lazada_order_id"));
    const tables = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = $1",
      [schema],
    );
    assert.deepEqual(tables.rows.map((row) => row.table_name), ["orders"]);
  });
});

test("Migration autentikasi mempertahankan profil pengguna lama tanpa password default", async () => {
  await isolated(async (client, migration, schema) => {
    await client.query(migration);
    const id = randomUUID();
    await client.query("INSERT INTO users (id,email,display_name) VALUES ($1,$2,$3)", [id, "legacy-profile@example.invalid", "Legacy fixture"]);
    const before = (await client.query("SELECT * FROM users WHERE id=$1", [id])).rows[0];
    await client.query(authSql.replaceAll('"public".', `"${schema}".`));
    const { password_hash, is_active, ...after } = (await client.query("SELECT * FROM users WHERE id=$1", [id])).rows[0];
    assert.deepEqual(after, before);
    assert.equal(password_hash, null);
    assert.equal(is_active, true);
  });
});
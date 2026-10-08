import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(new URL("../lib/db/package.json", import.meta.url));
const { Pool } = require("pg");
const source = path.resolve("lib/db/migrations");
const runner = path.resolve("artifacts/api-server/dist/migrate.mjs");

async function run(folder, schema, connectionString, standaloneRunner) {
  const url = new URL(connectionString);
  url.searchParams.set("options", `-c search_path=${schema},public`);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [standaloneRunner], {
      env: {
        ...process.env,
        DATABASE_URL: url.toString(),
        MIGRATIONS_DIR: folder,
        MIGRATIONS_SCHEMA: `${schema}_journal`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("Production migration runner: install, data-preserving update, repeat/concurrent runs and atomic failure",
  { skip: !process.env.DATABASE_URL, timeout: 90_000 }, async (t) => {
    const schema = `deploy_test_${randomUUID().replaceAll("-", "")}`;
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const directory = await mkdtemp(path.join(tmpdir(), "zetas-migrations-"));
    // Simulate the slim migrate image: a single bundle, no node_modules/source.
    const standaloneRunner = path.join(directory, "migrate.mjs");
    await copyFile(runner, standaloneRunner);
    const journal = JSON.parse(await readFile(path.join(source, "meta/_journal.json"), "utf8"));
    const folder = path.join(directory, "sql");
    await mkdir(path.join(folder, "meta"), { recursive: true });

    async function prepare(entries) {
      for (const entry of entries) {
        const sql = await readFile(path.join(source, `${entry.tag}.sql`), "utf8");
        await writeFile(path.join(folder, `${entry.tag}.sql`), sql.replaceAll('"public".', `"${schema}".`));
      }
      await writeFile(path.join(folder, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
    }

    try {
      await pool.query(`CREATE SCHEMA "${schema}"`);
      await prepare(journal.entries.slice(0, 1));
      await t.test("Fresh installation applies journal and schema", async () => {
        const result = await run(folder, schema, process.env.DATABASE_URL, standaloneRunner);
        assert.equal(result.code, 0);
        assert.match(result.stdout, /completed successfully/);
        assert.equal(result.stderr, "");
      });

      const id = randomUUID();
      await pool.query(`INSERT INTO "${schema}".orders
        (id, marketplace_order_id, product_name, buyer_name, amount, status)
        VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, "deployment-retention-fixture", "Fixture", "Fixture", 12000, "completed"]);
      const before = (await pool.query(`SELECT * FROM "${schema}".orders WHERE id=$1`, [id])).rows[0];

      await t.test("Update retains legacy row, amount, status and timestamps", async () => {
        await prepare(journal.entries);
        const result = await run(folder, schema, process.env.DATABASE_URL, standaloneRunner);
        assert.equal(result.code, 0);
        const { lazada_order_id, lazada_data, synced_at, ...after } = (await pool.query(`SELECT * FROM "${schema}".orders WHERE id=$1`, [id])).rows[0];
        assert.equal(lazada_data, null);
        assert.equal(synced_at, null);
        assert.equal(Number(after.amount), before.amount, "Numeric upgrade preserves the legacy monetary value");
        assert.deepEqual({ ...after, amount: Number(after.amount) }, before);
        assert.equal(lazada_order_id, before.marketplace_order_id);
        const sellerColumn = await pool.query(
          `SELECT is_nullable FROM information_schema.columns
           WHERE table_schema=$1 AND table_name='lazada_im_connections' AND column_name='lazada_seller_id'`,
          [schema],
        );
        assert.equal(sellerColumn.rows[0]?.is_nullable, "YES",
          "the new seller identity must be nullable for existing IM connections");
        const sellerIndex = await pool.query(
          `SELECT i.indisunique, pg_get_expr(i.indpred, i.indrelid) AS predicate
           FROM pg_index i
           JOIN pg_class c ON c.oid=i.indexrelid
           JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname=$1 AND c.relname='lazada_im_connections_app_country_seller_uq'`,
          [schema],
        );
        assert.equal(sellerIndex.rows[0]?.indisunique, true);
        assert.match(sellerIndex.rows[0]?.predicate ?? "", /lazada_seller_id IS NOT NULL/);
      });

      await t.test("Repeated and concurrent migration tasks are safe no-ops", async () => {
        const results = await Promise.all([
          run(folder, schema, process.env.DATABASE_URL, standaloneRunner),
          run(folder, schema, process.env.DATABASE_URL, standaloneRunner),
        ]);
        assert.ok(results.every((result) => result.code === 0));
        const count = await pool.query(`SELECT count(*)::int AS n FROM "${schema}_journal".__drizzle_migrations`);
        assert.equal(count.rows[0].n, journal.entries.length);
        assert.equal((await pool.query(`SELECT count(*)::int AS n FROM "${schema}".orders`)).rows[0].n, 1);
      });

      await t.test("Lazada IM sessions/messages are unique and isolated by connection", async () => {
        const owners = [randomUUID(), randomUUID()];
        for (const [index, ownerId] of owners.entries()) {
          await pool.query(
            `INSERT INTO "${schema}".users (id, email) VALUES ($1, $2)`,
            [ownerId, `im-owner-${index}-${ownerId}@example.invalid`],
          );
          await pool.query(
            `INSERT INTO "${schema}".lazada_im_connections
              (user_id, encrypted_tokens, app_fingerprint, country, expires_at, refresh_expires_at)
             VALUES ($1, '', 'migration-test', 'id', now() + interval '1 day', now() + interval '2 days')`,
            [ownerId],
          );
        }

        await assert.rejects(
          pool.query(
            `INSERT INTO "${schema}".lazada_im_sessions (user_id, lazada_session_id)
             VALUES ($1, 'orphan-session-fixture')`,
            [randomUUID()],
          ),
          (error) => error.code === "23503",
          "a session must belong to an existing Lazada IM connection",
        );

        const sessionIds = [];
        for (const ownerId of owners) {
          const inserted = await pool.query(
            `INSERT INTO "${schema}".lazada_im_sessions
              (user_id, lazada_session_id, unread_count, last_message_id, last_message_at, site_id)
             VALUES ($1, 'provider-session-fixture', 1, 'provider-message-fixture', now(), 'id')
             RETURNING id`,
            [ownerId],
          );
          sessionIds.push(inserted.rows[0].id);
        }

        await assert.rejects(
          pool.query(
            `INSERT INTO "${schema}".lazada_im_sessions (user_id, lazada_session_id)
             VALUES ($1, 'provider-session-fixture')`,
            [owners[0]],
          ),
          (error) => error.code === "23505",
          "the same Lazada session is unique within one IM connection",
        );

        for (const sessionId of sessionIds) {
          await pool.query(
            `INSERT INTO "${schema}".lazada_im_messages
              (session_id, lazada_message_id, from_account_id, to_account_id, content, template_id,
               message_type, sent_at, provider_status, auto_reply)
             VALUES ($1, 'provider-message-fixture', 'sender-fixture', 'recipient-fixture',
               'message body fixture', 1, 1, now(), '0', false)`,
            [sessionId],
          );
        }

        await assert.rejects(
          pool.query(
            `INSERT INTO "${schema}".lazada_im_messages (session_id, lazada_message_id)
             VALUES ($1, 'provider-message-fixture')`,
            [sessionIds[0]],
          ),
          (error) => error.code === "23505",
          "the same Lazada message cannot be stored twice in one session",
        );

        for (const [index, ownerId] of owners.entries()) {
          const ownMessages = await pool.query(
            `SELECT m.session_id, s.user_id
               FROM "${schema}".lazada_im_messages m
               JOIN "${schema}".lazada_im_sessions s ON s.id = m.session_id
              WHERE s.user_id = $1`,
            [ownerId],
          );
          assert.equal(ownMessages.rows.length, 1, `owner ${index} sees only the message attached to their own session`);
          assert.deepEqual(ownMessages.rows[0], {
            session_id: sessionIds[index],
            user_id: owners[index],
          });
        }

        const newTableColumns = await pool.query(
          `SELECT table_name, column_name
             FROM information_schema.columns
            WHERE table_schema = $1
              AND table_name = ANY($2::text[])`,
          [schema, ["lazada_im_sessions", "lazada_im_messages"]],
        );
        assert.ok(newTableColumns.rows.length > 0);
        const imSessionColumns = new Set(newTableColumns.rows
          .filter(({ table_name }) => table_name === "lazada_im_sessions")
          .map(({ column_name }) => column_name));
        for (const column of [
          "sync_requested_at",
          "sync_request_version",
          "sync_next_attempt_at",
          "sync_attempts",
          "sync_lease_until",
          "sync_lease_token",
        ]) {
          assert.ok(imSessionColumns.has(column), `IM session sync queue requires ${column}`);
        }
        assert.ok(
          newTableColumns.rows.every(({ column_name }) => !/(access|refresh)_token|app_secret|credential|encrypted_tokens|encryption_key/i.test(column_name)),
          "IM chat tables must not contain credential columns",
        );
      });

      await t.test("Failing migration rolls back DDL and preserves data; errors do not echo credentials", async () => {
        const entry = {
          idx: journal.entries.length, version: "7",
          when: journal.entries.at(-1).when + 1,
          tag: "9999_failure_fixture", breakpoints: true,
        };
        await writeFile(path.join(folder, `${entry.tag}.sql`),
          `CREATE TABLE "${schema}".must_rollback (id integer);--> statement-breakpoint\nSELECT deployment_intentional_failure_fixture;`);
        await writeFile(path.join(folder, "meta/_journal.json"), JSON.stringify({ ...journal, entries: [...journal.entries, entry] }));
        const result = await run(folder, schema, process.env.DATABASE_URL, standaloneRunner);
        assert.equal(result.code, 1);
        assert.equal(result.stdout, "");
        assert.match(result.stderr, /^Database migration failed\./);
        assert.doesNotMatch(result.stderr, /postgresql:|deployment_intentional_failure_fixture|password|SELECT /);
        assert.equal((await pool.query("SELECT to_regclass($1) AS table_name", [`${schema}.must_rollback`])).rows[0].table_name, null);
        assert.equal((await pool.query(`SELECT count(*)::int AS n FROM "${schema}_journal".__drizzle_migrations`)).rows[0].n, journal.entries.length);
        assert.equal(Number((await pool.query(`SELECT amount FROM "${schema}".orders WHERE id=$1`, [id])).rows[0].amount), before.amount);
      });
    } finally {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}_journal" CASCADE`);
      await pool.end();
      await rm(directory, { recursive: true, force: true });
    }
  });
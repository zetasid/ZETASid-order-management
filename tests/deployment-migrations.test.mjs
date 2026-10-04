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
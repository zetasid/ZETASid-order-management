import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const { build } = require("esbuild");
const express = require("express");
const requireDb = createRequire(new URL("../lib/db/package.json", import.meta.url));
const { Pool } = requireDb("pg");

test("Lazada IM Session Update receiver durably queues and processes only seller-scoped mock messages",
  { skip: !process.env.DATABASE_URL, timeout: 90_000 }, async () => {
    const original = {
      databaseUrl: process.env.DATABASE_URL,
      nodeEnv: process.env.NODE_ENV,
      sessionSecret: process.env.SESSION_SECRET,
    };
    const schema = `im_push_${randomUUID().replaceAll("-", "")}`;
    const adminPool = new Pool({ connectionString: original.databaseUrl });
    const temporaryRoot = path.join(process.cwd(), "artifacts/api-server/node_modules/.cache");
    await mkdir(temporaryRoot, { recursive: true });
    const temporary = await mkdtemp(path.join(temporaryRoot, "zetas-im-push-"));
    let fixtureModule;
    let fixtureUsers = [];
    let apiPool;
    let schemaCreated = false;

    try {
      await adminPool.query(`CREATE SCHEMA "${schema}"`);
      schemaCreated = true;
      const testUrl = new URL(original.databaseUrl);
      testUrl.searchParams.set("options", `-c search_path=${schema},public`);

      const sourceMigrations = path.resolve("lib/db/migrations");
      const migrationFolder = path.join(temporary, "migrations");
      await mkdir(path.join(migrationFolder, "meta"), { recursive: true });
      const journal = JSON.parse(await readFile(path.join(sourceMigrations, "meta/_journal.json"), "utf8"));
      for (const entry of journal.entries) {
        const sql = await readFile(path.join(sourceMigrations, `${entry.tag}.sql`), "utf8");
        await writeFile(
          path.join(migrationFolder, `${entry.tag}.sql`),
          sql.replaceAll('"public".', `"${schema}".`),
        );
      }
      await writeFile(path.join(migrationFolder, "meta/_journal.json"), JSON.stringify(journal));

      const migrationResult = await new Promise(resolve => {
        const child = spawn(process.execPath, [path.resolve("artifacts/api-server/dist/migrate.mjs")], {
          env: {
            ...process.env,
            DATABASE_URL: testUrl.toString(),
            MIGRATIONS_DIR: migrationFolder,
            MIGRATIONS_SCHEMA: `${schema}_journal`,
          },
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", chunk => { stdout += chunk; });
        child.stderr.on("data", chunk => { stderr += chunk; });
        child.on("error", () => resolve({ ok: false, stdout: "", stderr: "" }));
        child.on("close", code => resolve({ ok: code === 0, stdout, stderr }));
      });
      assert.equal(migrationResult.ok, true,
        `isolated migration fixture must be created: ${migrationResult.stderr || migrationResult.stdout}`);

      process.env.DATABASE_URL = testUrl.toString();
      process.env.NODE_ENV = "test";
      process.env.SESSION_SECRET = randomBytes(32).toString("hex");
      const env = {
        LAZADA_MODE: "testing",
        LAZADA_COUNTRY: "id",
        LAZADA_APP_KEY: "999000",
        LAZADA_APP_SECRET: "test-only-order-app-secret",
        LAZADA_IM_APP_KEY: "999001",
        LAZADA_IM_APP_SECRET: "test-only-im-app-secret",
        LAZADA_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
        LAZADA_REDIRECT_URI: "https://testing.example.invalid/api/lazada/oauth/callback",
        APP_ORIGIN: "https://testing.example.invalid",
      };
      await build({
        stdin: {
          contents: `export { imConfiguration, seal } from "./artifacts/api-server/src/modules/lazada/security.ts";
            export { createLazadaImPushRouter } from "./artifacts/api-server/src/routes/lazada-im-push.ts";
            export { enqueueImSessionUpdate, processNextImSessionSync, startImSessionSyncWorker }
              from "./artifacts/api-server/src/modules/lazada/im-push.ts";
            export { pool } from "./lib/db/src/index.ts";`,
          resolveDir: process.cwd(),
          sourcefile: "lazada-im-push-test-loader.ts",
        },
        outfile: path.join(temporary, "im-push-loader.mjs"),
        bundle: true,
        external: ["express", "pg", "pino"],
        platform: "node",
        format: "esm",
        logLevel: "silent",
      });
      await mkdir(path.join(temporary, "node_modules"), { recursive: true });
      await symlink(path.resolve("lib/db/node_modules/pg"), path.join(temporary, "node_modules/pg"), "dir");
      const loaded = await import(pathToFileURL(path.join(temporary, "im-push-loader.mjs")));
      apiPool = loaded.pool;
      const config = loaded.imConfiguration(env);
      assert.ok(config);
      fixtureModule = await import("./auth-helper.mjs");

      const ownerA = await fixtureModule.createAuthorizedFixture();
      const ownerB = await fixtureModule.createAuthorizedFixture();
      fixtureUsers = [ownerA, ownerB];
      for (const [fixture, sellerId] of [[ownerA, "push-seller-a"], [ownerB, "push-seller-b"]]) {
        const encryptedTokens = loaded.seal(JSON.stringify({
          accessToken: "test-only-im-access-token",
          refreshToken: "test-only-im-refresh-token",
        }), config, fixture.id);
        await fixture.pool.query(
          `INSERT INTO lazada_im_connections
            (user_id, lazada_seller_id, encrypted_tokens, app_fingerprint, country, expires_at, refresh_expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            fixture.id, sellerId, encryptedTokens, config.fingerprint, config.country,
            new Date(Date.now() + 3_600_000), new Date(Date.now() + 7_200_000),
          ],
        );
      }

      const receivedRawBodies = [];
      let authentication = "valid";
      let scheduleCount = 0;
      const app = express();
      app.set("trust proxy", 1);
      app.use("/api/lazada/im/push", loaded.createLazadaImPushRouter({
        getConfig: () => config,
        verifySignature: async rawBody => {
          receivedRawBodies.push(Buffer.from(rawBody));
          return authentication;
        },
        enqueueSessionUpdate: loaded.enqueueImSessionUpdate,
        scheduleProcessing: () => { scheduleCount += 1; },
      }));
      const server = http.createServer(app);
      await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
      const url = `http://127.0.0.1:${server.address().port}/api/lazada/im/push`;
      const post = (payload, raw = false) => fetch(url, {
        method: "POST",
        headers: {
          "X-Forwarded-Proto": "https",
          "Content-Type": "application/json",
        },
        body: raw ? payload : JSON.stringify(payload),
      });
      const sessionId = "synthetic-shared-session";
      const makeEvent = (sellerId, eventSessionId, userAccountId) => ({
        message_type: 19,
        seller_id: sellerId,
        data: [{
          sync_type: "SESSION_UPDATE",
          session_id: eventSessionId,
          unread_count: 2,
          site_id: "lazada_id",
          user_account_id: userAccountId,
        }],
      });
      const eventA = makeEvent("push-seller-a", sessionId, ownerB.id);
      const eventB = makeEvent("push-seller-b", sessionId, ownerA.id);
      const fetchCalls = [];
      const mockFetchMessages = async (userId, requestedSessionId, input) => {
        fetchCalls.push({ userId, sessionId: requestedSessionId, input });
        assert.match(input.startTime, /^\d+$/);
        assert.equal(input.pageSize, 20);
        assert.equal(input.cursor, undefined);
        const message = {
          message_id: `synthetic-message-${userId}`,
          content: "synthetic-only message",
          from_account_type: 1,
          to_account_type: 2,
          template_id: null,
          type: 1,
          status: "sent",
          auto_reply: false,
        };
        return {
          has_more: false,
          next_start_time: null,
          last_message_id: `synthetic-message-${userId}`,
          message_list: [message, { ...message }],
        };
      };

      try {
        const raw = `{\n "message_type":19,"seller_id":"push-seller-a","data":[{"sync_type":"SESSION_UPDATE","session_id":"${sessionId}","unread_count":2,"site_id":"lazada_id","user_account_id":"${ownerB.id}"}]\n}`;
        const first = await post(raw, true);
        assert.equal(first.status, 200);
        assert.equal(await first.text(), "");
        assert.equal(scheduleCount, 1, "message retrieval is scheduled after durable ACK");
        assert.equal(receivedRawBodies.at(-1).toString("utf8"), raw,
          "verifier receives exact raw bytes");
        assert.equal(fetchCalls.length, 0, "the public ACK does not wait for GetMessages");

        assert.equal((await post(eventA)).status, 200);
        assert.equal((await post(eventB)).status, 200);
        const queuedA = await ownerA.pool.query(
          `SELECT id, sync_requested_at, sync_request_version FROM lazada_im_sessions
           WHERE user_id=$1 AND lazada_session_id=$2`,
          [ownerA.id, sessionId],
        );
        assert.equal(queuedA.rows.length, 1);
        assert.ok(queuedA.rows[0].sync_requested_at);
        assert.equal(queuedA.rows[0].sync_request_version, 2);
        const queuedB = await ownerB.pool.query(
          `SELECT id, sync_requested_at FROM lazada_im_sessions
           WHERE user_id=$1 AND lazada_session_id=$2`,
          [ownerB.id, sessionId],
        );
        assert.equal(queuedB.rows.length, 1, "same provider session ID remains seller-scoped");

        const firstJob = await loaded.processNextImSessionSync(mockFetchMessages);
        const secondJob = await loaded.processNextImSessionSync(mockFetchMessages);
        assert.deepEqual(new Set([firstJob.userId, secondJob.userId]), new Set([ownerA.id, ownerB.id]));
        assert.ok([firstJob, secondJob].every(result => result.kind === "processed"));
        assert.equal(fetchCalls.length, 2);
        assert.ok(fetchCalls.every(call => call.sessionId === sessionId));
        for (const [fixture, session] of [[ownerA, queuedA.rows[0]], [ownerB, queuedB.rows[0]]]) {
          const messages = await fixture.pool.query(
            "SELECT count(*)::int AS count FROM lazada_im_messages WHERE session_id=$1",
            [session.id],
          );
          assert.equal(messages.rows[0].count, 1);
          const pending = await fixture.pool.query(
            "SELECT sync_requested_at FROM lazada_im_sessions WHERE id=$1",
            [session.id],
          );
          assert.equal(pending.rows[0].sync_requested_at, null);
        }
        assert.equal((await loaded.processNextImSessionSync(mockFetchMessages)).kind, "empty");

        const failedSessionId = "synthetic-failed-session";
        const failedEvent = makeEvent("push-seller-a", failedSessionId, ownerB.id);
        assert.equal((await post(failedEvent)).status, 200);
        let failedFetchCount = 0;
        const failedJob = await loaded.processNextImSessionSync(async () => {
          failedFetchCount += 1;
          throw new Error("synthetic provider failure");
        });
        assert.equal(failedJob.kind, "failed");
        assert.equal(failedFetchCount, 1);
        assert.equal((await loaded.processNextImSessionSync(mockFetchMessages)).kind, "empty",
          "a failed item must observe its backoff before retry");
        const failedQueue = await ownerA.pool.query(
          `SELECT id, sync_requested_at, sync_attempts, sync_next_attempt_at
           FROM lazada_im_sessions
           WHERE user_id=$1 AND lazada_session_id=$2`,
          [ownerA.id, failedSessionId],
        );
        assert.ok(failedQueue.rows[0].sync_requested_at, "failure remains visible as pending work");
        assert.equal(failedQueue.rows[0].sync_attempts, 1);
        assert.ok(new Date(failedQueue.rows[0].sync_next_attempt_at).getTime() > Date.now(),
          "retry is persisted for a future due time");

        // Simulate the backoff period passing, then let the periodic queue worker
        // recover the failed durable item without another webhook or IM polling.
        await ownerA.pool.query(
          `UPDATE lazada_im_sessions
           SET sync_next_attempt_at = now() + interval '40 milliseconds'
           WHERE id=$1`,
          [failedQueue.rows[0].id],
        );
        const waitForQueueClear = async (fixture, sessionId) => {
          const deadline = Date.now() + 3_000;
          while (Date.now() < deadline) {
            const pending = await fixture.pool.query(
              `SELECT sync_requested_at FROM lazada_im_sessions
               WHERE user_id=$1 AND lazada_session_id=$2`,
              [fixture.id, sessionId],
            );
            if (pending.rows[0]?.sync_requested_at === null) return;
            await new Promise(resolve => setTimeout(resolve, 10));
          }
          assert.fail("IM durable queue item was not recovered in time");
        };
        const stopRetryWorker = loaded.startImSessionSyncWorker(mockFetchMessages, 10);
        try {
          await waitForQueueClear(ownerA, failedSessionId);
        } finally {
          stopRetryWorker();
        }
        const retriedMessages = await ownerA.pool.query(
          `SELECT count(*)::int AS count FROM lazada_im_messages WHERE session_id=$1`,
          [failedQueue.rows[0].id],
        );
        assert.equal(retriedMessages.rows[0].count, 1,
          "retry inserts duplicate provider message IDs only once");

        // Simulate a prior worker crashing with a live lease. A restarted worker
        // scans the durable queue until the lease expires, then processes it.
        const strandedSessionId = "synthetic-worker-restart-session";
        assert.equal((await post(makeEvent("push-seller-a", strandedSessionId, ownerB.id))).status, 200);
        const stranded = await ownerA.pool.query(
          `SELECT id FROM lazada_im_sessions
           WHERE user_id=$1 AND lazada_session_id=$2`,
          [ownerA.id, strandedSessionId],
        );
        assert.equal(stranded.rows.length, 1);
        await ownerA.pool.query(
          `UPDATE lazada_im_sessions
           SET sync_lease_until = now() + interval '50 milliseconds',
               sync_lease_token = $2
           WHERE id=$1`,
          [stranded.rows[0].id, randomUUID()],
        );
        const stopRestartedWorker = loaded.startImSessionSyncWorker(mockFetchMessages, 10);
        try {
          await waitForQueueClear(ownerA, strandedSessionId);
        } finally {
          stopRestartedWorker();
        }
        const recoveredMessages = await ownerA.pool.query(
          `SELECT count(*)::int AS count FROM lazada_im_messages WHERE session_id=$1`,
          [stranded.rows[0].id],
        );
        assert.equal(recoveredMessages.rows[0].count, 1);

        assert.equal((await post({ ...eventA, seller_id: "unmapped-seller" })).status, 404);
        assert.equal((await post({ ...eventA, seller_id: undefined })).status, 400);

        authentication = "invalid";
        assert.equal((await post(eventA)).status, 401);
        authentication = "unavailable";
        assert.equal((await post(eventA)).status, 503);
        authentication = "valid";
        assert.equal((await post({ ...eventA, message_type: 2 })).status, 200);
        assert.equal((await post({
          ...eventA,
          data: [{ ...eventA.data[0], sync_type: "OTHER" }],
        })).status, 200);
        assert.equal((await post("{ malformed", true)).status, 400);
        assert.ok(!receivedRawBodies.some(body => body.toString("utf8").includes(env.LAZADA_IM_APP_SECRET)));
      } finally {
        await new Promise(resolve => server.close(resolve));
      }
    } finally {
      for (const fixture of fixtureUsers) await fixture.cleanup();
      await apiPool?.end();
      process.env.DATABASE_URL = original.databaseUrl;
      if (original.nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = original.nodeEnv;
      if (original.sessionSecret === undefined) delete process.env.SESSION_SECRET;
      else process.env.SESSION_SECRET = original.sessionSecret;
      await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}_journal" CASCADE`);
      if (schemaCreated) await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
      await adminPool.end();
      await rm(temporary, { recursive: true, force: true });
    }
  });

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
  { skip: !process.env.DATABASE_URL || process.env.ZETAS_SKIP_DB_INTEGRATION === "true", timeout: 90_000 }, async () => {
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
          contents: `export { imConfiguration, seal, sealImMessageContent, unsealImMessageContent } from "./artifacts/api-server/src/modules/lazada/security.ts";
            export { createLazadaImPushRouter } from "./artifacts/api-server/src/routes/lazada-im-push.ts";
            export { enqueueImSessionUpdate, processNextImSessionSync, requeueImSessionSync,
              purgeExpiredImMessages, startImSessionSyncWorker }
              from "./artifacts/api-server/src/modules/lazada/im-push.ts";
            export { LazadaError } from "./artifacts/api-server/src/modules/lazada/client.ts";
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
      const processNextImSessionSync = (fetcher, options = {}) => loaded.processNextImSessionSync(fetcher, {
        sealContent: (userId, content) => loaded.sealImMessageContent(content, config, userId),
        ...options,
      });
      const syncTestOptions = {
        sealContent: (userId, content) => loaded.sealImMessageContent(content, config, userId),
      };
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
      const firstEventOrder = [];
      const mockGetMessages = () => firstEventOrder.push("mock-get-messages-start");
      const app = express();
      app.set("trust proxy", 1);
      app.use((_req, res, next) => {
        res.once("finish", () => firstEventOrder.push("ack-finished"));
        next();
      });
      app.use("/api/lazada/im/push", loaded.createLazadaImPushRouter({
        getConfig: () => config,
        verifySignature: async rawBody => {
          receivedRawBodies.push(Buffer.from(rawBody));
          return authentication;
        },
        enqueueSessionUpdate: async (...args) => {
          const result = await loaded.enqueueImSessionUpdate(...args);
          if (result.kind === "queued") firstEventOrder.push("durable-enqueue");
          return result;
        },
        scheduleProcessing: () => {
          scheduleCount += 1;
          if (scheduleCount === 1) {
            firstEventOrder.push("worker-start");
            // This mock is the worker's first provider-fetch boundary.
            // Recording it synchronously makes the ordering assertion
            // deterministic rather than dependent on a later event-loop turn.
            mockGetMessages();
          }
        },
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
        assert.deepEqual(firstEventOrder.slice(0, 4), [
          "durable-enqueue",
          "ack-finished",
          "worker-start",
          "mock-get-messages-start",
        ], "durable enqueue must precede completed HTTP ACK, then worker/provider fetch may start");
        assert.equal(receivedRawBodies.at(-1).toString("utf8"), raw,
          "verifier receives exact raw bytes");
        assert.equal(fetchCalls.length, 0, "the public ACK does not wait for GetMessages");

        assert.equal((await post(raw, true)).status, 200);
        assert.equal(scheduleCount, 1, "an identical raw callback is ACKed without another sync job");
        assert.equal((await post(`${raw} `, true)).status, 200);
        assert.equal(scheduleCount, 2,
          "a byte-different callback is not collapsed by a lossy metadata projection");
        const changedEventA = makeEvent("push-seller-a", sessionId, ownerB.id);
        changedEventA.data[0].unread_count = 3;
        assert.equal((await post(changedEventA)).status, 200);
        assert.equal(scheduleCount, 3, "a changed event creates a new durable sync request");
        assert.equal((await post(eventB)).status, 200);
        assert.equal(scheduleCount, 4);
        assert.equal((await post(raw, true)).status, 200,
          "a replay is deduplicated even after a later, distinct event");
        assert.equal(scheduleCount, 4, "replaying an older receipt does not enqueue work");
        const queuedA = await ownerA.pool.query(
          `SELECT id, sync_requested_at, sync_request_version FROM lazada_im_sessions
           WHERE user_id=$1 AND lazada_session_id=$2`,
          [ownerA.id, sessionId],
        );
        assert.equal(queuedA.rows.length, 1);
        assert.ok(queuedA.rows[0].sync_requested_at);
        assert.equal(queuedA.rows[0].sync_request_version, 3);
        const queuedB = await ownerB.pool.query(
          `SELECT id, sync_requested_at FROM lazada_im_sessions
           WHERE user_id=$1 AND lazada_session_id=$2`,
          [ownerB.id, sessionId],
        );
        assert.equal(queuedB.rows.length, 1, "same provider session ID remains seller-scoped");

        const firstJob = await processNextImSessionSync(mockFetchMessages);
        const secondJob = await processNextImSessionSync(mockFetchMessages);
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
          const storedContent = await fixture.pool.query(
            "SELECT content FROM lazada_im_messages WHERE session_id=$1",
            [session.id],
          );
          assert.match(storedContent.rows[0].content, /^imc1\./,
            "message content is encrypted before it is persisted");
          assert.notEqual(storedContent.rows[0].content, "synthetic-only message");
          assert.equal(loaded.unsealImMessageContent(
            storedContent.rows[0].content, config, fixture.id,
          ), "synthetic-only message");
          const pending = await fixture.pool.query(
            "SELECT sync_requested_at FROM lazada_im_sessions WHERE id=$1",
            [session.id],
          );
          assert.equal(pending.rows[0].sync_requested_at, null);
        }
        assert.equal((await processNextImSessionSync(mockFetchMessages)).kind, "empty");

        const failedSessionId = "synthetic-failed-session";
        const failedEvent = makeEvent("push-seller-a", failedSessionId, ownerB.id);
        assert.equal((await post(failedEvent)).status, 200);
        let failedFetchCount = 0;
        const failedJob = await processNextImSessionSync(async () => {
          failedFetchCount += 1;
          throw new Error("synthetic provider failure");
        });
        assert.equal(failedJob.kind, "failed");
        assert.equal(failedFetchCount, 1);
        assert.equal((await processNextImSessionSync(mockFetchMessages)).kind, "empty",
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
        const stopRetryWorker = loaded.startImSessionSyncWorker(mockFetchMessages, 10, syncTestOptions);
        try {
          await waitForQueueClear(ownerA, failedSessionId);
        } finally {
          await stopRetryWorker();
        }
        const retriedMessages = await ownerA.pool.query(
          `SELECT count(*)::int AS count FROM lazada_im_messages WHERE session_id=$1`,
          [failedQueue.rows[0].id],
        );
        assert.equal(retriedMessages.rows[0].count, 1,
          "retry inserts duplicate provider message IDs only once");

        const drainingStopSessionId = "synthetic-worker-stop-waits-for-drain";
        assert.equal((await post(makeEvent("push-seller-a", drainingStopSessionId, ownerB.id))).status, 200);
        let notifyDrainFetchStarted;
        const drainFetchStarted = new Promise(resolve => { notifyDrainFetchStarted = resolve; });
        let releaseDrainFetch;
        const deferredDrainPage = new Promise(resolve => { releaseDrainFetch = resolve; });
        const stopDrainingWorker = loaded.startImSessionSyncWorker(async () => {
          notifyDrainFetchStarted();
          return deferredDrainPage;
        }, 60_000, syncTestOptions);
        await drainFetchStarted;
        const drainStopped = stopDrainingWorker();
        assert.equal(typeof drainStopped?.then, "function",
          "worker stop returns a completion promise");
        let drainStopResolved = false;
        void drainStopped.then(() => { drainStopResolved = true; });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(drainStopResolved, false,
          "worker stop waits for an in-flight provider request");
        releaseDrainFetch({
          has_more: false,
          next_start_time: null,
          last_message_id: "synthetic-drain-stop-message",
          message_list: [{ message_id: "synthetic-drain-stop-message" }],
        });
        await drainStopped;
        assert.equal(drainStopResolved, true);
        const stoppedDrainSession = await ownerA.pool.query(
          `SELECT sync_requested_at FROM lazada_im_sessions
           WHERE user_id=$1 AND lazada_session_id=$2`,
          [ownerA.id, drainingStopSessionId],
        );
        assert.equal(stoppedDrainSession.rows[0].sync_requested_at, null,
          "worker stop resolves after its active durable job has settled");

        const retryLimitSessionId = "synthetic-retry-limit";
        assert.equal((await post(makeEvent("push-seller-a", retryLimitSessionId, ownerB.id))).status, 200);
        for (let attempt = 1; attempt <= 5; attempt += 1) {
          if (attempt > 1) {
            await ownerA.pool.query(
              `UPDATE lazada_im_sessions
                  SET sync_next_attempt_at=now() - interval '1 second'
                WHERE user_id=$1 AND lazada_session_id=$2`,
              [ownerA.id, retryLimitSessionId],
            );
          }
          assert.equal((await processNextImSessionSync(async () => {
            throw new Error("synthetic transient provider failure");
          })).kind, "failed");
        }
        const exhaustedRetry = await ownerA.pool.query(
          `SELECT sync_attempts, sync_blocked_at, sync_requested_at
             FROM lazada_im_sessions WHERE user_id=$1 AND lazada_session_id=$2`,
          [ownerA.id, retryLimitSessionId],
        );
        assert.equal(exhaustedRetry.rows[0].sync_attempts, 5);
        assert.ok(exhaustedRetry.rows[0].sync_blocked_at, "transient retries stop at the configured attempt limit");
        assert.ok(exhaustedRetry.rows[0].sync_requested_at, "blocked work remains durable for owner recovery");
        assert.equal((await processNextImSessionSync(mockFetchMessages)).kind, "empty");
        assert.equal(await loaded.requeueImSessionSync(ownerB.id, retryLimitSessionId), "not_found");
        assert.equal(await loaded.requeueImSessionSync(ownerA.id, retryLimitSessionId), "queued");
        const manuallyRecovered = await processNextImSessionSync(mockFetchMessages);
        assert.equal(manuallyRecovered.kind, "processed", "owner requeue resumes failed provider work");

        const permanentFailureSessionId = "synthetic-permanent-provider-error";
        assert.equal((await post(makeEvent("push-seller-a", permanentFailureSessionId, ownerB.id))).status, 200);
        assert.equal((await processNextImSessionSync(async () => {
          throw new loaded.LazadaError("permission_denied");
        })).kind, "failed");
        const permanentQueue = await ownerA.pool.query(
          `SELECT sync_attempts, sync_blocked_at FROM lazada_im_sessions
            WHERE user_id=$1 AND lazada_session_id=$2`,
          [ownerA.id, permanentFailureSessionId],
        );
        assert.equal(permanentQueue.rows[0].sync_attempts, 1);
        assert.ok(permanentQueue.rows[0].sync_blocked_at,
          "permission/auth/configuration errors do not retry automatically");

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
        const stopRestartedWorker = loaded.startImSessionSyncWorker(mockFetchMessages, 10, syncTestOptions);
        try {
          await waitForQueueClear(ownerA, strandedSessionId);
        } finally {
          await stopRestartedWorker();
        }
        const recoveredMessages = await ownerA.pool.query(
          `SELECT count(*)::int AS count FROM lazada_im_messages WHERE session_id=$1`,
          [stranded.rows[0].id],
        );
        assert.equal(recoveredMessages.rows[0].count, 1);

        const heartbeatSessionId = "synthetic-heartbeat-protects-lease";
        assert.equal((await post(makeEvent("push-seller-a", heartbeatSessionId, ownerB.id))).status, 200);
        let notifyFetchStarted;
        const fetchStarted = new Promise(resolve => { notifyFetchStarted = resolve; });
        let releaseFetch;
        const deferredPage = new Promise(resolve => { releaseFetch = resolve; });
        const longRunningJob = processNextImSessionSync(async () => {
          notifyFetchStarted();
          return deferredPage;
        }, { leaseMs: 300, heartbeatIntervalMs: 75 });
        await fetchStarted;
        await new Promise(resolve => setTimeout(resolve, 650));
        const competingWorker = await processNextImSessionSync(mockFetchMessages, {
          leaseMs: 300, heartbeatIntervalMs: 75,
        });
        assert.equal(competingWorker.kind, "empty",
          "lease heartbeat prevents another worker from duplicating a slow provider fetch");
        releaseFetch({
          has_more: false,
          next_start_time: null,
          last_message_id: "synthetic-heartbeat-message",
          message_list: [{ message_id: "synthetic-heartbeat-message", content: "synthetic heartbeat content" }],
        });
        assert.equal((await longRunningJob).kind, "processed");
        const heartbeatSession = await ownerA.pool.query(
          `SELECT id FROM lazada_im_sessions
            WHERE user_id=$1 AND lazada_session_id=$2`,
          [ownerA.id, heartbeatSessionId],
        );
        const heartbeatMessageCount = await ownerA.pool.query(
          "SELECT count(*)::int AS count FROM lazada_im_messages WHERE session_id=$1",
          [heartbeatSession.rows[0].id],
        );
        assert.equal(heartbeatMessageCount.rows[0].count, 1);

        const oldMessageId = "synthetic-expired-retention-message";
        const recentMessageId = "synthetic-recent-retention-message";
        await ownerA.pool.query(
          `INSERT INTO lazada_im_messages (session_id, lazada_message_id, content, created_at)
           VALUES ($1, $2, $3, $4), ($1, $5, $6, $7)`,
          [
            heartbeatSession.rows[0].id,
            oldMessageId,
            loaded.sealImMessageContent("synthetic old content", config, ownerA.id),
            new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
            recentMessageId,
            loaded.sealImMessageContent("synthetic recent content", config, ownerA.id),
            new Date(),
          ],
        );
        assert.equal(await loaded.purgeExpiredImMessages(30), 1,
          "configured retention removes old message records in a bounded cleanup");
        const retentionState = await ownerA.pool.query(
          `SELECT lazada_message_id FROM lazada_im_messages
            WHERE session_id=$1 AND lazada_message_id=ANY($2::text[])`,
          [heartbeatSession.rows[0].id, [oldMessageId, recentMessageId]],
        );
        assert.deepEqual(retentionState.rows.map(row => row.lazada_message_id), [recentMessageId]);

        // Persist every page together with its next cursor. After one committed
        // page, the local worker is stopped and started again to prove recovery
        // resumes from the stored provider cursor rather than a fresh timestamp.
        const paginatedSessionId = "synthetic-more-than-ten-pages";
        assert.equal((await post(makeEvent("push-seller-a", paginatedSessionId, ownerB.id))).status, 200);
        const pageRequests = [];
        const fetchPaginatedPage = async (userId, requestedSessionId, input) => {
          assert.equal(userId, ownerA.id);
          assert.equal(requestedSessionId, paginatedSessionId);
          const pageIndex = pageRequests.length;
          pageRequests.push({ ...input });
          assert.equal(input.pageSize, 20);
          if (pageIndex === 0) assert.equal(input.cursor, undefined);
          else {
            assert.equal(input.startTime, String(50_000 + pageIndex));
            assert.equal(input.cursor, `cursor-${pageIndex}`);
          }
          const nextPageId = pageIndex + 1;
          const message = { message_id: `page-message-${pageIndex}` };
          return {
            has_more: pageIndex < 11,
            next_start_time: pageIndex < 11 ? String(50_000 + nextPageId) : null,
            last_message_id: `cursor-${nextPageId}`,
            message_list: pageIndex === 6
              ? [message, { message_id: "page-message-1" }]
              : [message],
          };
        };
        const firstPage = await processNextImSessionSync(fetchPaginatedPage);
        assert.equal(firstPage.kind, "processed");
        const paginatedSession = await ownerA.pool.query(
          `SELECT id, sync_cursor_start_time, sync_cursor_message_id, sync_cursor_request_version,
                  sync_cursor_history, sync_start_at
             FROM lazada_im_sessions
            WHERE user_id=$1 AND lazada_session_id=$2`,
          [ownerA.id, paginatedSessionId],
        );
        assert.equal(paginatedSession.rows[0].sync_cursor_start_time, "50001");
        assert.equal(paginatedSession.rows[0].sync_cursor_message_id, "cursor-1");
        assert.equal(paginatedSession.rows[0].sync_cursor_history.length, 1);
        assert.ok(paginatedSession.rows[0].sync_start_at);

        const stopFirstWorker = loaded.startImSessionSyncWorker(fetchPaginatedPage, 10, syncTestOptions);
        try {
          await waitForQueueClear(ownerA, paginatedSessionId);
        } finally {
          await stopFirstWorker();
        }
        await new Promise(resolve => setTimeout(resolve, 20));
        const schedulingCountAfterWorkerRestart = scheduleCount;
        assert.equal((await post(raw, true)).status, 200);
        assert.equal(scheduleCount, schedulingCountAfterWorkerRestart,
          "a persisted receipt still deduplicates after the worker has restarted");
        assert.equal(pageRequests.length, 12, "all pages beyond the former ten-page cap are retrieved");
        assert.equal(pageRequests[0].cursor, undefined);
        assert.equal(pageRequests[1].startTime, "50001");
        assert.equal(pageRequests[1].cursor, "cursor-1",
          "restarted worker resumes from the durable cursor");
        for (let pageIndex = 1; pageIndex < pageRequests.length; pageIndex += 1) {
          assert.equal(pageRequests[pageIndex].startTime, String(50_000 + pageIndex));
          assert.equal(pageRequests[pageIndex].cursor, `cursor-${pageIndex}`);
        }
        const paginatedMessageCount = await ownerA.pool.query(
          `SELECT count(*)::int AS count FROM lazada_im_messages WHERE session_id=$1`,
          [paginatedSession.rows[0].id],
        );
        assert.equal(paginatedMessageCount.rows[0].count, 12,
          "duplicate IDs across pages are stored once");
        const completedPagination = await ownerA.pool.query(
          `SELECT sync_requested_at, sync_cursor_start_time, sync_cursor_message_id,
                  sync_cursor_request_version, sync_cursor_history
             FROM lazada_im_sessions WHERE id=$1`,
          [paginatedSession.rows[0].id],
        );
        assert.equal(completedPagination.rows[0].sync_requested_at, null);
        assert.equal(completedPagination.rows[0].sync_cursor_start_time, null);
        assert.equal(completedPagination.rows[0].sync_cursor_message_id, null);
        assert.equal(completedPagination.rows[0].sync_cursor_request_version, null);
        assert.deepEqual(completedPagination.rows[0].sync_cursor_history, []);

        const repeatedCursorSessionId = "synthetic-repeated-cursor";
        assert.equal((await post(makeEvent("push-seller-a", repeatedCursorSessionId, ownerB.id))).status, 200);
        const repeatedCursorRequests = [];
        const repeatedCursorResult = async (_userId, _requestedSessionId, input) => {
          repeatedCursorRequests.push({ ...input });
          return {
            has_more: true,
            next_start_time: "70001",
            last_message_id: "loop-cursor",
            message_list: [{ message_id: `loop-message-${repeatedCursorRequests.length}` }],
          };
        };
        assert.equal((await processNextImSessionSync(repeatedCursorResult)).kind, "processed");
        assert.equal((await processNextImSessionSync(repeatedCursorResult)).kind, "failed",
          "a cursor that points to itself is rejected and left for delayed retry");
        assert.equal(repeatedCursorRequests.length, 2, "cursor detection is bounded, not an in-process loop");
        assert.equal((await processNextImSessionSync(repeatedCursorResult)).kind, "empty",
          "the invalid cursor is paused rather than retried in an automatic loop");
        const pausedCursor = await ownerA.pool.query(
          `SELECT sync_blocked_at, sync_cursor_start_time, sync_cursor_message_id
             FROM lazada_im_sessions
            WHERE user_id=$1 AND lazada_session_id=$2`,
          [ownerA.id, repeatedCursorSessionId],
        );
        assert.ok(pausedCursor.rows[0].sync_blocked_at);
        assert.equal(pausedCursor.rows[0].sync_cursor_start_time, "70001");
        assert.equal(pausedCursor.rows[0].sync_cursor_message_id, "loop-cursor");
        const resumedEvent = makeEvent("push-seller-a", repeatedCursorSessionId, ownerB.id);
        resumedEvent.data[0].unread_count = 4;
        assert.equal((await post(resumedEvent)).status, 200);
        const stillPausedCursor = await ownerA.pool.query(
          `SELECT sync_blocked_at, sync_cursor_start_time, sync_cursor_message_id
             FROM lazada_im_sessions
            WHERE user_id=$1 AND lazada_session_id=$2`,
          [ownerA.id, repeatedCursorSessionId],
        );
        assert.ok(stillPausedCursor.rows[0].sync_blocked_at,
          "a new webhook cannot silently clear a permanent cursor failure");
        assert.equal(stillPausedCursor.rows[0].sync_cursor_start_time, "70001");
        assert.equal(await loaded.requeueImSessionSync(ownerB.id, repeatedCursorSessionId), "not_found",
          "a different ZETAS user cannot requeue another seller's session");
        assert.equal(await loaded.requeueImSessionSync(ownerA.id, repeatedCursorSessionId), "queued",
          "manual owner-scoped recovery is required for a blocked session");
        const resumedCursor = await ownerA.pool.query(
          `SELECT sync_blocked_at, sync_cursor_start_time, sync_cursor_message_id, sync_attempts
             FROM lazada_im_sessions
            WHERE user_id=$1 AND lazada_session_id=$2`,
          [ownerA.id, repeatedCursorSessionId],
        );
        assert.equal(resumedCursor.rows[0].sync_blocked_at, null);
        assert.equal(resumedCursor.rows[0].sync_cursor_start_time, null,
          "manual recovery starts from the saved run start rather than reusing a bad cursor");
        assert.equal(resumedCursor.rows[0].sync_cursor_message_id, null);
        assert.equal(resumedCursor.rows[0].sync_attempts, 0);
        let resumedInput;
        assert.equal((await processNextImSessionSync(async (_userId, _sessionId, input) => {
          resumedInput = input;
          return {
            has_more: false,
            next_start_time: null,
            last_message_id: "loop-cursor",
            message_list: [{ message_id: "loop-message-1" }],
          };
        })).kind, "processed");
        assert.equal(resumedInput.cursor, undefined);
        const deduplicatedAfterCursorResume = await ownerA.pool.query(
          `SELECT count(*)::int AS count FROM lazada_im_messages
            WHERE session_id=(SELECT id FROM lazada_im_sessions
                               WHERE user_id=$1 AND lazada_session_id=$2)`,
          [ownerA.id, repeatedCursorSessionId],
        );
        assert.equal(deduplicatedAfterCursorResume.rows[0].count, 1);

        const invalidCursorSessionId = "synthetic-invalid-cursor";
        assert.equal((await post(makeEvent("push-seller-a", invalidCursorSessionId, ownerB.id))).status, 200);
        let invalidCursorCalls = 0;
        const invalidCursorResult = async () => {
          invalidCursorCalls += 1;
          return {
            has_more: true,
            next_start_time: null,
            last_message_id: null,
            message_list: [],
          };
        };
        assert.equal((await processNextImSessionSync(invalidCursorResult)).kind, "failed");
        assert.equal(invalidCursorCalls, 1);
        assert.equal((await processNextImSessionSync(invalidCursorResult)).kind, "empty",
          "an invalid provider cursor is paused rather than repeatedly requested");
        const invalidCursorQueue = await ownerA.pool.query(
          `SELECT sync_blocked_at, sync_requested_at FROM lazada_im_sessions
            WHERE user_id=$1 AND lazada_session_id=$2`,
          [ownerA.id, invalidCursorSessionId],
        );
        assert.ok(invalidCursorQueue.rows[0].sync_blocked_at);
        assert.ok(invalidCursorQueue.rows[0].sync_requested_at);

        const concurrentCursorSessionId = "synthetic-event-during-cursor-error";
        assert.equal((await post(makeEvent("push-seller-a", concurrentCursorSessionId, ownerB.id))).status, 200);
        const concurrentEvent = makeEvent("push-seller-a", concurrentCursorSessionId, ownerB.id);
        concurrentEvent.data[0].unread_count = 9;
        assert.equal((await processNextImSessionSync(async () => {
          assert.equal((await post(concurrentEvent)).status, 200);
          return {
            has_more: true,
            next_start_time: null,
            last_message_id: null,
            message_list: [],
          };
        })).kind, "failed");
        const concurrentCursorState = await ownerA.pool.query(
          `SELECT sync_blocked_at, sync_requested_at, sync_cursor_start_time
             FROM lazada_im_sessions
            WHERE user_id=$1 AND lazada_session_id=$2`,
          [ownerA.id, concurrentCursorSessionId],
        );
        assert.equal(concurrentCursorState.rows[0].sync_blocked_at, null,
          "an invalid old cursor cannot block a newer event arriving during the fetch");
        assert.ok(concurrentCursorState.rows[0].sync_requested_at);
        assert.equal(concurrentCursorState.rows[0].sync_cursor_start_time, null);
        let concurrentResumeInput;
        assert.equal((await processNextImSessionSync(async (_userId, _sessionId, input) => {
          concurrentResumeInput = input;
          return {
            has_more: false,
            next_start_time: null,
            last_message_id: "concurrent-cursor-message",
            message_list: [{ message_id: "concurrent-cursor-message" }],
          };
        })).kind, "processed");
        assert.equal(concurrentResumeInput.cursor, undefined);

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

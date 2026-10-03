#!/bin/sh
# Requires built frontend/API, migrated disposable DB, and a private test secret.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${SESSION_SECRET:?SESSION_SECRET is required}"
CI_API_PORT=${CI_API_PORT:-5000}
CI_WEB_PORT=${CI_WEB_PORT:-5173}
TEST_API_URL=${TEST_API_URL:-http://127.0.0.1:$CI_API_PORT/api}
TEST_BASE_URL=${TEST_BASE_URL:-http://127.0.0.1:$CI_WEB_PORT}
APP_ORIGIN=${APP_ORIGIN:-http://127.0.0.1:$CI_API_PORT}
export TEST_API_URL TEST_BASE_URL APP_ORIGIN

LOG_DIR=$(mktemp -d)
API_PID=
WEB_PID=
cleanup() {
  [ -z "$WEB_PID" ] || kill "$WEB_PID" 2>/dev/null || true
  [ -z "$API_PID" ] || kill "$API_PID" 2>/dev/null || true
  [ -z "$WEB_PID" ] || wait "$WEB_PID" 2>/dev/null || true
  [ -z "$API_PID" ] || wait "$API_PID" 2>/dev/null || true
  rm -rf "$LOG_DIR"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Test mode permits HTTP cookies only in this isolated job, never in production.
PORT="$CI_API_PORT" NODE_ENV=test node artifacts/api-server/dist/index.mjs > "$LOG_DIR/api.log" 2>&1 &
API_PID=$!
(
  cd artifacts/zetas-id
  # exec the real process, so cleanup does not leave a child dev server behind.
  PORT="$CI_WEB_PORT" BASE_PATH=/ NODE_ENV=production \
    exec node node_modules/vite/bin/vite.js preview --config vite.config.ts --strictPort
) > "$LOG_DIR/web.log" 2>&1 &
WEB_PID=$!

# Wait for actual HTTP/DB readiness; never use a fixed sleep as a readiness check.
node --input-type=module <<'JS'
import { setTimeout } from "node:timers/promises";
const endpoints = [`${process.env.TEST_API_URL}/healthz`, `${process.env.TEST_BASE_URL}/login`];
for (let attempt = 0; attempt < 60; attempt++) {
  const ready = await Promise.all(endpoints.map(async url => {
    try {
      return (await fetch(url, { signal: AbortSignal.timeout(2000) })).ok;
    } catch { return false; }
  }));
  if (ready.every(Boolean)) process.exit(0);
  await setTimeout(500);
}
throw new Error("CI test services did not become ready; inspect startup privately, without exposing environment.");
JS

pnpm test
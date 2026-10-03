import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

test("CI includes locked install, real checks, test DB and both Docker platforms without deployment", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  for (const command of [
    "pnpm install --frozen-lockfile",
    "pnpm run typecheck",
    "pnpm --filter @workspace/zetas-id run build",
    "pnpm --filter @workspace/api-server run build",
    "pnpm --filter @workspace/db run migrate",
    "sh scripts/ci-tests.sh",
    "docker compose --env-file /dev/null -f docker-compose.yml config --quiet",
    "pnpm audit --prod --audit-level high",
    "pnpm audit --json",
  ]) assert.ok(workflow.includes(command), command);
  assert.match(workflow, /target: \[api, web, migrate\]/);
  assert.match(workflow, /platforms: linux\/amd64,linux\/arm64/);
  assert.match(workflow, /needs: checks/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /push: false/);
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(workflow, /pull_request_target|secrets\.|docker\/login-action|ssh-action|packages: write/);
  for (const match of workflow.matchAll(/uses:\s*([^\s]+)/g)) {
    assert.match(match[1], /^[\w-]+\/[\w-]+@[a-f0-9]{40}$/, "Actions must be pinned to a reviewed commit");
  }
});

test("CI test runner validates shell syntax and waits for services before testing", () => {
  execFileSync("sh", ["-n", "scripts/ci-tests.sh"]);
  const script = readFileSync("scripts/ci-tests.sh", "utf8");
  assert.match(script, /NODE_ENV=test node artifacts\/api-server\/dist\/index\.mjs/);
  assert.match(script, /vite\.js preview/);
  assert.match(script, /trap cleanup EXIT/);
  assert.ok(script.indexOf("ready.every(Boolean)") < script.indexOf("pnpm test"));
});
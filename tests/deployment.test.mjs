import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const env = {
  ...process.env,
  POSTGRES_DB: "zetas",
  POSTGRES_USER: "zetas",
  POSTGRES_PASSWORD: "configuration-test-only",
  DATABASE_URL: "postgresql://zetas:configuration-test-only@database:5432/zetas",
  SESSION_SECRET: "configuration-test-only-not-a-real-secret",
  APP_ORIGIN: "https://configuration.example.invalid",
  APP_BIND: "127.0.0.1",
  APP_PORT: "8080",
  TRUST_PROXY: "loopback,172.20.0.2/32",
};
const cli = (() => {
  try { execFileSync("docker-compose", ["version"], { stdio: "ignore" }); return ["docker-compose", []]; }
  catch { return ["docker", ["compose"]]; }
})();
const hasCompose = (() => {
  try { execFileSync(cli[0], [...cli[1], "version"], { stdio: "ignore" }); return true; }
  catch { return false; }
})();

test("Compose valid; persistence, startup gate, health and private ports are enforced", { skip: !hasCompose }, () => {
  const config = JSON.parse(execFileSync(cli[0], [
    ...cli[1], "--env-file", "/dev/null", "-f", "docker-compose.yml", "config", "--format", "json",
  ], { env, encoding: "utf8" }));
  assert.equal(config.name, "zetas-id");
  assert.equal(config.volumes.postgres_data.name, "zetas-id_postgres_data");
  assert.equal(config.services.database.volumes[0].source, "postgres_data");
  assert.equal(config.services.database.volumes[0].target, "/var/lib/postgresql/data");
  assert.equal(config.services.database.ports, undefined);
  assert.equal(config.services.api.ports, undefined);
  assert.equal(config.services.api.environment.TRUST_PROXY, env.TRUST_PROXY);
  assert.equal(config.services.migrate.restart, "no");
  assert.equal(config.services.api.depends_on.migrate.condition, "service_completed_successfully");
  assert.equal(config.services.web.depends_on.api.condition, "service_healthy");
  assert.equal(config.services.migrate.depends_on.database.condition, "service_healthy");
  assert.equal(config.services.web.ports[0].host_ip, "127.0.0.1");
  assert.equal(config.networks.data.internal, true);
  for (const service of ["api", "web", "migrate"]) {
    assert.equal(config.services[service].read_only, true);
    assert.deepEqual(config.services[service].cap_drop, ["ALL"]);
    assert.ok(!config.services[service].platform, "must not force amd64");
  }
  for (const service of ["database", "api", "web"]) {
    assert.ok(config.services[service].healthcheck.test.length);
  }
});

test("Compose rejects missing secrets before startup", { skip: !hasCompose }, () => {
  assert.throws(() => execFileSync(cli[0], [
    ...cli[1], "--env-file", "/dev/null", "-f", "docker-compose.yml", "config", "--quiet",
  ], { env: { ...env, POSTGRES_PASSWORD: "", DATABASE_URL: "", SESSION_SECRET: "" }, stdio: "pipe" }));
});

test("Production build and safe update configuration", () => {
  const dockerfile = readFileSync("Dockerfile", "utf8");
  assert.match(dockerfile, /pnpm install --frozen-lockfile/);
  assert.match(dockerfile, /FROM runtime AS migrate/);
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /USER nginx/);
  assert.doesNotMatch(dockerfile, /COPY \. \./);
  assert.doesNotMatch(dockerfile, /ARG (SESSION_SECRET|DATABASE_URL|POSTGRES_PASSWORD)/);
  execFileSync("sh", ["-n", "deploy/stack.sh"]);
  const update = readFileSync("deploy/stack.sh", "utf8");
  assert.ok(update.indexOf("pg_dump") < update.indexOf("dc run --rm --no-deps migrate"));
  assert.match(update, /dc stop web api/);
  assert.doesNotMatch(update, /down -v|volume prune/);
  const nginx = readFileSync("deploy/nginx.conf", "utf8");
  assert.match(nginx, /resolver 127\.0\.0\.11/);
  assert.match(nginx, /proxy_set_header X-Forwarded-For \$zetas_client_ip/);
});

test("Update script stops before migration and never restarts app after backup/migration failure", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "zetas-update-"));
  try {
    await mkdir(path.join(directory, "deploy"));
    await mkdir(path.join(directory, "bin"));
    await copyFile("deploy/stack.sh", path.join(directory, "deploy/stack.sh"));
    const log = path.join(directory, "commands");
    // Mock only the Docker command, not the script's decision logic.
    await writeFile(path.join(directory, "bin/docker"), `#!/bin/sh
printf '%s\\n' "$*" >> "$COMMAND_LOG"
case "$*" in
  *"build --pull"*) [ "$FAIL_STAGE" != build ] || exit 1 ;;
  *"exec -T database"*) [ "$FAIL_STAGE" != backup ] || exit 1; printf 'backup-fixture' ;;
  *"run --rm --no-deps migrate"*) [ "$FAIL_STAGE" != migrate ] || exit 1 ;;
esac
exit 0
`, { mode: 0o700 });
    for (const failure of ["build", "backup", "migrate", "none"]) {
      await writeFile(log, "");
      await rm(path.join(directory, "backups"), { recursive: true, force: true });
      const options = {
        env: { ...env, PATH: `${directory}/bin:${process.env.PATH}`, COMMAND_LOG: log, FAIL_STAGE: failure },
        stdio: "pipe",
      };
      if (failure === "none") execFileSync("sh", [path.join(directory, "deploy/stack.sh"), "update"], options);
      else assert.throws(() => execFileSync("sh", [path.join(directory, "deploy/stack.sh"), "update"], options));
      const commands = await readFile(log, "utf8");
      assert.doesNotMatch(commands, /down -v|volume prune/);
      if (failure === "build") {
        assert.doesNotMatch(commands, /stop web api/);
      } else {
        assert.ok(commands.indexOf("stop web api") < commands.indexOf("exec -T database"));
      }
      if (failure === "backup") {
        assert.doesNotMatch(commands, /run --rm --no-deps migrate/);
        assert.deepEqual(await readdir(path.join(directory, "backups")), []);
      }
      if (failure !== "none") assert.doesNotMatch(commands, /up -d --wait --wait-timeout 180 api web/);
      else {
        assert.ok(commands.indexOf("exec -T database") < commands.indexOf("run --rm --no-deps migrate"));
        assert.match(commands, /up -d --wait --wait-timeout 180 api web/);
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
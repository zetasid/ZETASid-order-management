// Read only: checks Docker Hub's live multi-platform indexes, never runs Docker.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const dockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");
const compose = await readFile(new URL("../docker-compose.yml", import.meta.url), "utf8");
const images = new Set([
  ...Array.from(dockerfile.matchAll(/^FROM ([^\s]+)/gm), (match) => match[1])
    .filter((name) => name.includes(":")),
  ...Array.from(compose.matchAll(/^\s+image:\s*([^\s]+)/gm), (match) => match[1]),
]);

async function getJson(url, headers = {}) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Registry check failed: HTTP ${response.status}`);
  return response.json();
}

for (const image of images) {
  const [name, tag] = image.split(":");
  const repository = `library/${name}`;
  const auth = await getJson(`https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repository}:pull`);
  const index = await getJson(`https://registry-1.docker.io/v2/${repository}/manifests/${tag}`, {
    Authorization: `Bearer ${auth.token}`,
    Accept: "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json",
  });
  const platforms = (index.manifests ?? [])
    .map(({ platform }) => `${platform?.os}/${platform?.architecture}`);
  for (const architecture of ["amd64", "arm64"]) {
    assert.ok(platforms.includes(`linux/${architecture}`), `${image} lacks linux/${architecture}`);
  }
  console.log(`${image}: linux/amd64 + linux/arm64 verified`);
}

const lockfile = await readFile(new URL("../pnpm-lock.yaml", import.meta.url), "utf8");
for (const dependency of [
  "@esbuild/linux-x64", "@esbuild/linux-arm64",
  "@rollup/rollup-linux-x64-gnu", "@rollup/rollup-linux-arm64-gnu",
  "@tailwindcss/oxide-linux-x64-gnu", "@tailwindcss/oxide-linux-arm64-gnu",
  "lightningcss-linux-x64-gnu", "lightningcss-linux-arm64-gnu",
]) {
  assert.ok(lockfile.includes(`${dependency}@`), `${dependency} missing from lockfile`);
}
console.log("Linux glibc native build dependencies: amd64 + arm64 retained");
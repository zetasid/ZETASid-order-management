// Regenerate icons from the approved logo. Requires ImageMagick's convert command.
import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const convert = promisify(execFile);
const source = fileURLToPath(new URL("../artifacts/zetas-id/src/assets/zetas-logo.png", import.meta.url));
const output = new URL("../artifacts/zetas-id/public/icons/", import.meta.url);
await mkdir(output, { recursive: true });

for (const [name, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["favicon.png", 64]]) {
  await convert("convert", [
    source, "-resize", `${size}x${size}`,
    fileURLToPath(new URL(name, output)),
  ]);
}
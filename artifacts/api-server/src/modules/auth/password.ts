import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const N = 65536;
const r = 8;
const p = 2;
const LENGTH = 64;
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, LENGTH, { N, r, p, maxmem: 128 * 1024 * 1024 }, (error, key) => {
      if (error) reject(new Error("Password verification unavailable"));
      else resolve(key);
    });
  });
}
export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12 || password.length > 128) throw new Error("Password must contain 12–128 characters");
  const salt = randomBytes(16).toString("hex");
  const key = await derive(password, salt);
  return `scrypt$${N}$${r}$${p}$${salt}$${key.toString("hex")}`;
}
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (password.length > 128 || !/^scrypt\$65536\$8\$2\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(hash)) return false;
  const parts = hash.split("$");
  return timingSafeEqual(await derive(password, parts[4]), Buffer.from(parts[5], "hex"));
}
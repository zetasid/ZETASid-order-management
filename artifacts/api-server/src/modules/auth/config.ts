import { createHmac, timingSafeEqual } from "node:crypto";

const secret = process.env.SESSION_SECRET;
if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must be configured with at least 32 characters");
export const IDLE_MS = 30 * 60 * 1000;
export const ABSOLUTE_MS = 8 * 60 * 60 * 1000;
export function digest(purpose: string, value: string) {
  return createHmac("sha256", secret!).update(`${purpose}:${value}`).digest("hex");
}
export function secureEqual(a: string, b: string) {
  return /^[a-f0-9]{64}$/.test(a) && /^[a-f0-9]{64}$/.test(b)
    && timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}
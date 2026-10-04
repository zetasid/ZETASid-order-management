import { createHmac, timingSafeEqual } from "node:crypto";
import { ReceiveLazadaOrderPushBody } from "@workspace/api-zod";
import { providerId } from "./order-mapping";
import { hash, type LazadaConfig } from "./security";

// Official LPM: HEX(HMAC-SHA256(AppKey + exact message body, AppSecret)).
// Never JSON.stringify a parsed body before verifying its signature.
export function validPushSignature(raw: Buffer, authorization: unknown, config: LazadaConfig) {
  if (typeof authorization !== "string" || !/^[a-fA-F0-9]{64}$/.test(authorization)) return false;
  const expected = createHmac("sha256", config.appSecret).update(config.appKey, "utf8").update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(authorization, "hex"));
}
export function parsePush(raw: Buffer, config: LazadaConfig) {
  const parsed = ReceiveLazadaOrderPushBody.safeParse(JSON.parse(raw.toString("utf8")));
  if (!parsed.success || parsed.data.site !== `lazada_${config.country}`) throw new Error("invalid_push");
  const p = parsed.data;
  // Official examples use both seconds and milliseconds for notification timestamps.
  const timestamp = p.timestamp < 100_000_000_000 ? p.timestamp * 1000 : p.timestamp;
  const orderId = providerId(p.data.trade_order_id);
  // Delivery retry may change notification timestamp, not the underlying item transition.
  const eventHash = hash(JSON.stringify([config.fingerprint, providerId(p.seller_id), p.site, orderId,
    providerId(p.data.trade_order_line_id), p.data.order_status, p.data.status_update_time]));
  return { orderId, eventHash, timestamp };
}
export function freshPush(timestamp: number, now = Date.now()) {
  // LPM retries every 30 min up to 12 times; a five-minute window would drop genuine retries.
  return timestamp >= now - 7 * 3600000 && timestamp <= now + 5 * 60000;
}
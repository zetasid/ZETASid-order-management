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
const sampleSchema = ReceiveLazadaOrderPushBody.strict().extend({
  data: ReceiveLazadaOrderPushBody.shape.data.strict(),
});
export function isDocumentedPushSample(raw: Buffer) {
  // LPM publishes a static trade sample (Vietnam, 2020), and requires a genuinely
  // signed self-test ACK. It does not document a generic "verify" discriminator.
  // Recognize ONLY the complete published sample, never merely an old timestamp,
  // foreign site, test flag, message type or status. Caller must validate HMAC first.
  // https://open.lazada.com/apps/doc/doc?nodeId=29524&docId=120168&lang=en_US
  try {
    const parsed = sampleSchema.safeParse(JSON.parse(raw.toString("utf8")));
    if (!parsed.success) return false;
    const p = parsed.data;
    return p.seller_id === "1234567" && p.message_type === 0 && p.site === "lazada_vn"
      && p.timestamp === 1603766859530 && p.data.order_status === "unpaid"
      && p.data.status_update_time === 1603698638
      && p.data.trade_order_id === "260422900198363"
      && p.data.trade_order_line_id === "260422900298363";
  } catch {
    return false;
  }
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
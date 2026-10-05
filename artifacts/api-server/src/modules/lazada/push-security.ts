import { createHmac, timingSafeEqual } from "node:crypto";
import { ReceiveLazadaOrderPushBody } from "@workspace/api-zod";
import { providerId } from "./order-mapping";
import { hash, type LazadaConfig } from "./security";

type PushPayloadReason = "invalid_json" | "invalid_schema" | "site_mismatch" | "invalid_timestamp";
const safeFieldPaths = new Set(["seller_id", "message_type", "site", "timestamp", "data",
  "data.trade_order_id", "data.trade_order_line_id", "data.order_status", "data.status_update_time"]);

export class PushPayloadError extends Error {
  constructor(readonly reason: PushPayloadReason, readonly fields: string[] = []) {
    super("invalid_push");
  }
}

export function normalizePushTimestamp(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new PushPayloadError("invalid_timestamp", ["timestamp"]);
  }
  // Current Unix seconds have 10 digits, milliseconds have 13. Do not coerce
  // arbitrary strings, fractions or unsafe numbers into valid notification dates.
  const milliseconds = value < 100_000_000_000 ? value * 1000 : value;
  if (!Number.isSafeInteger(milliseconds)) throw new PushPayloadError("invalid_timestamp", ["timestamp"]);
  return milliseconds;
}

// Official LPM: HEX(HMAC-SHA256(AppKey + exact message body, AppSecret)).
// Never JSON.stringify a parsed body before verifying its signature.
export function validPushSignature(raw: Buffer, authorization: unknown, config: LazadaConfig) {
  if (typeof authorization !== "string" || !/^[a-fA-F0-9]{64}$/.test(authorization)) return false;
  const expected = createHmac("sha256", config.appSecret).update(config.appKey, "utf8").update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(authorization, "hex"));
}
type PushDiagnostic = { site?: string; message_type?: number };
export function parsePush(raw: Buffer, config: LazadaConfig, diagnostic?: (fields: PushDiagnostic) => void) {
  let body: unknown;
  try { body = JSON.parse(raw.toString("utf8")); }
  catch { throw new PushPayloadError("invalid_json"); }
  // TEMPORARY: inspect authenticated JSON before validation, without forwarding
  // the payload or object-valued fields to the logger. Remove after diagnosis.
  if (diagnostic) {
    const fields: PushDiagnostic = {};
    if (body !== null && typeof body === "object" && !Array.isArray(body)) {
      const record = body as Record<string, unknown>;
      if (typeof record.site === "string") fields.site = record.site;
      if (typeof record.message_type === "number") fields.message_type = record.message_type;
    }
    diagnostic(fields);
  }
  // Zod's non-strict objects accept extra top-level/data fields from Lazada.
  // Keep the documented order fields required; do not invent a Verify contract.
  const parsed = ReceiveLazadaOrderPushBody.safeParse(body);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map(issue => issue.path.join("."))
      .filter(path => safeFieldPaths.has(path)))];
    throw new PushPayloadError("invalid_schema", fields);
  }
  if (parsed.data.site !== `lazada_${config.country}`) throw new PushPayloadError("site_mismatch", ["site"]);
  const p = parsed.data;
  const timestamp = normalizePushTimestamp(p.timestamp);
  const orderId = providerId(p.data.trade_order_id);
  // Delivery retry may change notification timestamp, not the underlying item transition.
  const eventHash = hash(JSON.stringify([config.fingerprint, providerId(p.seller_id), p.site, orderId,
    providerId(p.data.trade_order_line_id), p.data.order_status, p.data.status_update_time]));
  return { orderId, eventHash, timestamp };
}
export function freshPush(timestamp: number, now = Date.now()) {
  // LPM retries every 30 min up to 12 times; a five-minute window would drop genuine retries.
  // Seven hours covers the six-hour retry schedule with transport/clock grace.
  return Number.isSafeInteger(timestamp) && timestamp > 0
    && timestamp >= now - 7 * 3600000 && timestamp <= now + 5 * 60000;
}
import type { Order } from "@workspace/db";
import { LazadaError } from "./client";

export type ProviderRecord = Record<string, unknown>;
export const orderKeys = ["order_id", "order_number", "price", "statuses", "created_at", "updated_at"];
export const itemKeys = ["order_id", "order_item_id", "name", "item_price", "paid_price", "currency",
  "variation", "sku", "shop_sku", "digital_delivery_info", "extra_attributes", "status", "created_at", "updated_at", "is_digital"];
export const pick = (value: ProviderRecord, keys: string[]) =>
  Object.fromEntries(keys.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]));

export function providerId(value: unknown): string {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === "string" && /^[1-9]\d{0,39}$/.test(value)) return value;
  throw new LazadaError("invalid_response");
}
export const sourceText = (value: unknown): string | null =>
  typeof value === "string" ? value : typeof value === "number" && Number.isFinite(value) ? String(value) : null;

export function providerDate(value: unknown): Date {
  if (typeof value !== "string" || !/(?:Z|[+-]\d{2}:?\d{2})$/.test(value.trim())) throw new LazadaError("invalid_response");
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new LazadaError("invalid_response");
  return date;
}
export function providerMoney(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const text = sourceText(value);
  if (!text || !/^\d{1,13}(?:\.\d{1,2})?$/.test(text)) throw new LazadaError("invalid_response");
  const amount = Number(text);
  if (!Number.isFinite(amount) || amount < 0) throw new LazadaError("invalid_response");
  return amount;
}
// Compatibility grouping only; the original Lazada statuses are always displayed separately.
export function localStatus(values: string[]): Order["status"] {
  if (values.length && values.every(value => value === "delivered")) return "completed";
  if (values.length && values.every(value => value === "canceled" || value === "cancelled")) return "cancelled";
  if (values.some(value => ["ready_to_ship", "shipped", "shipping", "topack", "toship", "packed"].includes(value))) return "processing";
  return "pending";
}
export function mapOrder(raw: ProviderRecord, items: ProviderRecord[]) {
  const id = providerId(raw.order_id);
  if (!Array.isArray(raw.statuses) || raw.statuses.some(value => typeof value !== "string"))
    throw new LazadaError("invalid_response");
  const statuses = raw.statuses as string[];
  if (Number.isSafeInteger(raw.items_count) && raw.items_count !== items.length) throw new LazadaError("invalid_response");
  const seen = new Set<string>();
  const mappedItems = items.map(item => {
    const itemId = providerId(item.order_item_id);
    if (providerId(item.order_id) !== id || seen.has(itemId)
      || typeof item.name !== "string" || !item.name || typeof item.status !== "string")
      throw new LazadaError("invalid_response");
    seen.add(itemId);
    // No extra_attributes guessing: use only the documented digital_delivery_info field.
    const digital = Object.hasOwn(item, "digital_delivery_info") ? item.digital_delivery_info : null;
    return { lazadaOrderItemId: itemId, productName: item.name, digitalDetail: digital,
      lazadaData: pick(item, itemKeys), status: localStatus([item.status]),
      createdAt: providerDate(item.created_at), updatedAt: providerDate(item.updated_at) };
  });
  return { header: { lazadaOrderId: id, marketplaceOrderId: sourceText(raw.order_number) ?? id,
    productName: mappedItems.map(item => item.productName).join(", "), amount: providerMoney(raw.price),
    status: localStatus(statuses), createdAt: providerDate(raw.created_at), updatedAt: providerDate(raw.updated_at),
    lazadaData: pick(raw, orderKeys) }, items: mappedItems };
}
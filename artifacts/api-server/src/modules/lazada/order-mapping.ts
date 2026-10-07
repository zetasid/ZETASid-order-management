import type { Order } from "@workspace/db";
import { LazadaError } from "./client";
import { groupStatuses } from "../orders/order-status";

export type ProviderRecord = Record<string, unknown>;
export const orderKeys = ["order_id", "order_number", "price", "statuses", "created_at", "updated_at"];
export const itemKeys = ["order_id", "order_item_id", "name", "item_price", "paid_price", "currency",
  "variation", "sku", "shop_sku", "digital_delivery_info", "extra_attributes", "product_main_image",
  "status", "created_at", "updated_at", "is_digital", "payment_time", "stage_pay_status"];
export const pick = (value: ProviderRecord, keys: string[]) =>
  Object.fromEntries(keys.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]));

export function httpsProductImageUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value || value.length > 4096) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

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
  const group = groupStatuses(values);
  if (!group) throw new LazadaError("invalid_response");
  return group;
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
const lazadaData = pick(item, itemKeys);

if (Object.hasOwn(lazadaData, "is_digital")
  && typeof lazadaData.is_digital === "number"
  && (lazadaData.is_digital === 0 || lazadaData.is_digital === 1)) {
  lazadaData.is_digital = lazadaData.is_digital === 1;
}

if (Object.hasOwn(lazadaData, "product_main_image"))
      lazadaData.product_main_image = httpsProductImageUrl(lazadaData.product_main_image);
    return { lazadaOrderItemId: itemId, productName: item.name, digitalDetail: digital,
      lazadaData, status: localStatus([item.status]),
      createdAt: providerDate(item.created_at), updatedAt: providerDate(item.updated_at) };
  });
  return { header: { lazadaOrderId: id, marketplaceOrderId: sourceText(raw.order_number) ?? id,
    productName: mappedItems.map(item => item.productName).join(", "), amount: providerMoney(raw.price),
    status: localStatus(items.length ? items.map(item => item.status as string) : statuses),
    createdAt: providerDate(raw.created_at), updatedAt: providerDate(raw.updated_at),
    lazadaData: pick(raw, orderKeys) }, items: mappedItems };
}

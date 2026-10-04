import type { Order, OrderItem } from "@workspace/db";

export type StatusGroup = Order["status"];
// Source: official Lazada Order Status Flow, plus GetOrders' documented aliases.
// These are ZETAS display groups, never replacements for the original API status.
export const LAZADA_STATUS_GROUPS: Record<StatusGroup, readonly string[]> = {
  pending: ["unpaid", "pending"],
  processing: ["repacked", "packed", "ready_to_ship_pending", "ready_to_ship", "shipped", "topack", "toship", "shipping"],
  completed: ["delivered", "confirmed"],
  cancelled: ["canceled"],
};

export function itemStatusGroup(value: unknown): StatusGroup | null {
  if (typeof value !== "string") return null;
  return (Object.entries(LAZADA_STATUS_GROUPS) as [StatusGroup, readonly string[]][])
    .find(([, statuses]) => statuses.includes(value))?.[0] ?? null;
}

export function groupStatuses(values: readonly unknown[]): StatusGroup | null {
  if (!values.length) return null;
  const groups = values.map(itemStatusGroup);
  if (groups.includes(null)) return null; // Unknown values never silently become "Menunggu".
  if (groups.every(group => group === "cancelled")) return "cancelled";
  if (groups.every(group => group === "completed" || group === "cancelled")) return "completed";
  if (groups.includes("processing") || (groups.includes("completed") && groups.includes("pending"))) return "processing";
  return "pending";
}

export function readOrderStatus(order: Order & { items: OrderItem[] }): StatusGroup | null {
  if (order.lazadaData === null) return order.status; // Retain legacy, non-Lazada behavior.
  // GetOrderItems is authoritative, not a synthetic stored enum or header label.
  const statuses = order.items.length
    ? order.items.map(item => item.lazadaData?.status)
    : Array.isArray(order.lazadaData?.statuses) ? order.lazadaData.statuses : [];
  return groupStatuses(statuses);
}
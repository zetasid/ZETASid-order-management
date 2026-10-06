import type { Order, OrderItem } from "@workspace/db";

export type StatusGroup = Order["status"];
export type PaymentStatus = "unpaid" | "pending" | "confirmed" | "cancelled" | "unknown";
// Source: official Lazada Order Status Flow, plus GetOrders' documented aliases.
// These are ZETAS display groups, never replacements for the original API status.
export const LAZADA_STATUS_GROUPS: Record<StatusGroup, readonly string[]> = {
  pending: ["unpaid", "pending"],
  processing: ["repacked", "packed", "ready_to_ship_pending", "ready_to_ship", "shipped", "topack", "to_pack", "toship", "to_ship", "shipping"],
  completed: ["delivered", "confirmed"],
  cancelled: ["canceled", "cancelled"],
};

export function itemStatusGroup(value: unknown): StatusGroup | null {
  if (typeof value !== "string") return null;
  return (Object.entries(LAZADA_STATUS_GROUPS) as [StatusGroup, readonly string[]][])
    .find(([, statuses]) => statuses.includes(value))?.[0] ?? null;
}

// Payment eligibility comes from the order-header status returned by Lazada.
// Item status remains a separate signal for digital fulfillment progress.
export function readOrderPaymentStatus(order: Pick<Order, "lazadaData">): PaymentStatus {
  const data = order.lazadaData;
  const statuses = data && Array.isArray(data.statuses) ? data.statuses : null;
  if (!statuses?.length || statuses.some(status => typeof status !== "string")) return "unknown";
  if (statuses.includes("canceled") || statuses.includes("cancelled")) return "cancelled";
  if (statuses.includes("unpaid")) return "unpaid";
  if (statuses.includes("pending")) return "pending";
  if (statuses.every(status => {
    const group = itemStatusGroup(status);
    return group === "processing" || group === "completed";
  })) return "confirmed";
  return "unknown";
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
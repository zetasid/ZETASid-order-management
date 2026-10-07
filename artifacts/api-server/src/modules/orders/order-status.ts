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

function validPaymentTime(value: unknown): boolean {
  const text = typeof value === "string"
    ? value
    : typeof value === "number" && Number.isSafeInteger(value) ? String(value) : "";
  if (!/^\d{13}$/.test(text)) return false;
  const timestamp = Number(text);
  return Number.isSafeInteger(timestamp) && timestamp >= 1_000_000_000_000 && timestamp <= Date.now();
}

function paymentStage(item: Pick<OrderItem, "lazadaData">): "unpaid" | "pending" | "unknown" | null {
  const value = item.lazadaData?.stage_pay_status;
  if (value === undefined || value === null || value === "") return null;
  if (value === "unpaid") return "unpaid";
  if (value === "unpaid final payment") return "pending";
  return "unknown";
}

// Workflow statuses never confirm payment. Lazada's GetOrderItems payment_time
// is the payment evidence; missing, malformed, or incomplete evidence fails closed.
export function readOrderPaymentStatus(
  order: Pick<Order, "lazadaData"> & { items?: readonly Pick<OrderItem, "lazadaData">[] },
): PaymentStatus {
  const items = order.items ?? [];
  if (!items.length) return "unknown";
  const stages = items.map(paymentStage);
  if (stages.includes("unknown")) return "unknown";
  if (stages.includes("unpaid")) return "unpaid";
  if (stages.includes("pending")) return "pending";
  if (items.every(item => validPaymentTime(item.lazadaData?.payment_time))) return "confirmed";
  return "unknown";
}

function combineWorkflowGroups(itemGroup: StatusGroup | null, headerGroup: StatusGroup | null): StatusGroup | null {
  if (itemGroup === null || headerGroup === null) return null;
  if (itemGroup === "cancelled" || headerGroup === "cancelled") return "cancelled";
  if (itemGroup === "processing" || headerGroup === "processing") return "processing";
  if (itemGroup === headerGroup) return itemGroup;
  return "processing";
}

export function groupStatuses(values: readonly unknown[]): StatusGroup | null {
  if (!values.length) return null;
  const groups = values.map(itemStatusGroup);
  if (groups.includes(null)) return null; // Unknown values never silently become "Menunggu".
  if (groups.includes("cancelled")) return "cancelled";
  if (groups.every(group => group === "completed")) return "completed";
  if (groups.includes("processing") || (groups.includes("completed") && groups.includes("pending"))) return "processing";
  return "pending";
}

export function readOrderStatus(order: Order & { items: OrderItem[] }): StatusGroup | null {
  if (order.lazadaData === null) return order.status; // Retain legacy, non-Lazada behavior.
  const headerStatuses = Array.isArray(order.lazadaData.statuses) ? order.lazadaData.statuses : [];
  if (!order.items.length) return groupStatuses(headerStatuses);
  const itemGroup = groupStatuses(order.items.map(item => item.lazadaData?.status));
  if (!headerStatuses.length) return itemGroup;
  // A stale "pending" header does not override newer item progress. Other
  // header workflow signals remain part of the order gate.
  const progressingHeaderStatuses = headerStatuses.filter(status => status !== "pending" && status !== "unpaid");
  if (!progressingHeaderStatuses.length) return itemGroup;
  return combineWorkflowGroups(itemGroup, groupStatuses(progressingHeaderStatuses));
}
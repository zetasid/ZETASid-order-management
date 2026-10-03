import type { Order, OrderItem } from "@workspace/db";

function digitalText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  const text = JSON.stringify(value, null, 2);
  if (text === undefined) throw new Error("Invalid PostgreSQL digital detail");
  return text;
}

export function presentOrder(order: Order & { items: OrderItem[] }) {
  return {
    id: order.id,
    lazadaOrderId: order.lazadaOrderId,
    marketplaceOrderId: order.lazadaOrderId,
    productName: order.items.length ? order.items.map((item) => item.productName).join(", ") : order.productName,
    buyerName: order.buyerName,
    amount: order.amount,
    status: order.status,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    items: order.items.map((item) => ({
      id: item.id,
      lazadaOrderItemId: item.lazadaOrderItemId,
      orderId: item.orderId,
      productName: item.productName,
      digitalDetail: digitalText(item.digitalDetail),
      status: item.status,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    })),
  };
}
import type { Order, OrderItem } from "@workspace/db";
import { sourceText } from "../lazada/order-mapping";

function digitalText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  const text = JSON.stringify(value, null, 2);
  if (text === undefined) throw new Error("Invalid PostgreSQL digital detail");
  return text;
}

export function presentOrder(order: Order & { items: OrderItem[] }) {
  const data = order.lazadaData;
  const currencies = [...new Set(order.items.map(item => sourceText(item.lazadaData?.currency)).filter(Boolean))];
  return {
    id: order.id,
    lazadaOrderId: order.lazadaOrderId,
    marketplaceOrderId: order.lazadaOrderId,
    productName: order.items.length ? order.items.map((item) => item.productName).join(", ") : order.productName,
    buyerName: order.buyerName,
    amount: order.amount,
    lazadaStatuses: data && Array.isArray(data.statuses) ? data.statuses : null,
    sourceCreatedAt: sourceText(data?.created_at),
    sourceUpdatedAt: sourceText(data?.updated_at),
    sourcePrice: sourceText(data?.price),
    currency: currencies.length === 1 ? currencies[0] : null,
    syncedAt: order.syncedAt?.toISOString() ?? null,
    status: order.status,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    items: order.items.map((item) => ({
      id: item.id,
      lazadaOrderItemId: item.lazadaOrderItemId,
      orderId: item.orderId,
      productName: item.productName,
      digitalDetail: digitalText(item.digitalDetail),
      digitalDetailSource: item.lazadaData && Object.hasOwn(item.lazadaData, "digital_delivery_info") ? "digital_delivery_info" : null,
      sourceStatus: sourceText(item.lazadaData?.status),
      sourceCreatedAt: sourceText(item.lazadaData?.created_at),
      sourceUpdatedAt: sourceText(item.lazadaData?.updated_at),
      itemPrice: sourceText(item.lazadaData?.item_price),
      paidPrice: sourceText(item.lazadaData?.paid_price),
      currency: sourceText(item.lazadaData?.currency),
      variation: sourceText(item.lazadaData?.variation),
      sku: sourceText(item.lazadaData?.sku),
      shopSku: sourceText(item.lazadaData?.shop_sku),
      extraAttributes: digitalText(item.lazadaData?.extra_attributes),
      status: item.status,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    })),
  };
}
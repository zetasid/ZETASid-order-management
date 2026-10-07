import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import {
  db,
  lazadaConnectionsTable,
  orderItemsTable,
  ordersTable,
  syncLogsTable,
  type OrderItem,
} from "@workspace/db";
import { presentOrder } from "../orders/orders.presenter";
import { activeSession } from "./connection";
import { createClient, LazadaError, type DigitalDeliveryItemResult } from "./client";
import { configuration, unseal } from "./security";
import { mapOrder, providerId } from "./order-mapping";
import type { OrderTx } from "./order-store";
import { storeOrder } from "./order-store";

const AUDIT_SOURCE = "lazada-manual-delivery";
const auditMessage = {
  running: "Manual Lazada digital delivery in progress.",
  completed: "Manual Lazada digital delivery confirmed.",
  failed: "Manual Lazada digital delivery failed.",
} as const;

type PresentedOrder = ReturnType<typeof presentOrder>;
type RefreshedOrder = { order: PresentedOrder; allItemsDigital: boolean };
export type ManualDeliveryOutcome =
  | { ok: true; order: PresentedOrder }
  | { ok: false; status: number; error: string };

type ItemRef = { recordId: string; providerId: string };
type AuditMetadata = {
  action: "deliver_digital";
  orderRecordId: string;
  operatorId: string;
  itemCount: number;
  successfulItemRecordIds: string[];
  nonRetryableItemRecordIds: string[];
  result: string;
};

const failure = (status: number, error: string): ManualDeliveryOutcome => ({ ok: false, status, error });

function paymentBlockedMessage(status: string) {
  if (status === "unpaid") return "Pembayaran Lazada belum selesai. Pesanan belum dapat dikirim.";
  if (status === "pending") return "Pembayaran masih menunggu konfirmasi Lazada. Pesanan belum dapat dikirim.";
  if (status === "cancelled") return "Pesanan telah dibatalkan di Lazada dan tidak dapat dikirim.";
  return "Status pembayaran Lazada belum dapat dipastikan. Pesanan tidak dikirim.";
}

function metadataStringArray(value: unknown, key: string): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const items = (value as Record<string, unknown>)[key];
  return Array.isArray(items) ? items.filter((item): item is string => typeof item === "string") : [];
}

function metadataFor(orderId: string, operatorId: string, itemCount: number, result: string,
  successfulItemRecordIds: string[] = [], nonRetryableItemRecordIds: string[] = []): AuditMetadata {
  return { action: "deliver_digital", orderRecordId: orderId, operatorId, itemCount,
    successfulItemRecordIds, nonRetryableItemRecordIds, result };
}

async function recordAttempt(tx: OrderTx, status: "running" | "completed" | "failed",
  metadata: AuditMetadata, recordsCount: number, startedAt = new Date()) {
  const [row] = await tx.insert(syncLogsTable).values({
    source: AUDIT_SOURCE,
    status,
    recordsCount,
    message: auditMessage[status],
    metadata,
    startedAt,
    ...(status === "running" ? {} : { finishedAt: new Date() }),
  }).returning({ id: syncLogsTable.id });
  return row;
}

async function finishAttempt(tx: OrderTx, attemptId: string, status: "completed" | "failed" | "running",
  metadata: AuditMetadata, recordsCount: number) {
  await tx.update(syncLogsTable).set({
    status,
    recordsCount,
    message: auditMessage[status],
    metadata,
    finishedAt: status === "running" ? null : new Date(),
  }).where(and(eq(syncLogsTable.id, attemptId), eq(syncLogsTable.source, AUDIT_SOURCE)));
}

async function findOrder(tx: OrderTx, orderId: string) {
  return tx.query.ordersTable.findFirst({
    where: eq(ordersTable.id, orderId),
    with: { items: { orderBy: [asc(orderItemsTable.createdAt), asc(orderItemsTable.id)] } },
  });
}

function allItemsExplicitlyDigital(items: readonly { lazadaData: OrderItem["lazadaData"] }[]) {
  return items.length > 0 && items.every(item =>
  item.lazadaData?.is_digital === true ||
  item.lazadaData?.is_digital === 1
);

async function refreshOrderFromLazada(tx: OrderTx, order: Awaited<ReturnType<typeof findOrder>>,
  accessToken: string, client: ReturnType<typeof createClient>): Promise<RefreshedOrder> {
  if (!order?.lazadaOrderId) throw new LazadaError("invalid_response");
  const providerOrderId = providerId(order.lazadaOrderId);
  const [header, itemResponse] = await Promise.all([
    client.getOrder(accessToken, providerOrderId),
    client.getOrderItems(accessToken, providerOrderId),
  ]);
  const refreshed = mapOrder(header, itemResponse.items);
  const expectedItemIds = new Set(order.items.map(item => item.lazadaOrderItemId));
  if (refreshed.header.lazadaOrderId !== providerOrderId
    || refreshed.items.length !== expectedItemIds.size
    || refreshed.items.some(item => !expectedItemIds.has(item.lazadaOrderItemId))) {
    throw new LazadaError("invalid_response");
  }
  await storeOrder(tx, refreshed);
  const saved = await findOrder(tx, order.id);
  if (!saved) throw new LazadaError("invalid_response");
  return { order: presentOrder(saved), allItemsDigital: allItemsExplicitlyDigital(saved.items) };
}

function responseMatches(responseItems: DigitalDeliveryItemResult[], orderId: string, expected: ItemRef[]) {
  if (responseItems.length !== expected.length) return false;
  const expectedIds = new Set(expected.map(item => item.providerId));
  const received = new Set<string>();
  for (const item of responseItems) {
    if (item.orderId !== orderId || !expectedIds.has(item.orderItemId) || received.has(item.orderItemId)) return false;
    received.add(item.orderItemId);
  }
  return received.size === expectedIds.size;
}

export async function deliverDigitalOrder(operatorId: string, sessionHash: string, orderId: string): Promise<ManualDeliveryOutcome> {
  const config = configuration();
  if (!config) return failure(503, "Konfigurasi Lazada belum tersedia.");

  type Claim = { attemptId: string; itemRefs: ItemRef[]; successfulItemRecordIds: string[];
    nonRetryableItemRecordIds: string[] } | ManualDeliveryOutcome;
  const claim: Claim = await db.transaction(async tx => {
    const locked = await tx.execute<{ locked: boolean }>(
      sql`select pg_try_advisory_xact_lock(hashtext(${`lazada-orders:${config.fingerprint}`})) as locked`,
    );
    if (!locked.rows[0]?.locked)
      return failure(409, "Operasi Lazada lain sedang berjalan. Tunggu sebentar sebelum mencoba lagi.");

    await tx.select({ id: ordersTable.id }).from(ordersTable)
      .where(eq(ordersTable.id, orderId)).for("update");
    const order = await findOrder(tx, orderId);
    if (!order) return failure(404, "Pesanan tidak ditemukan.");

    const itemRefs = order.items.map(item => ({ recordId: item.id, providerId: providerId(item.lazadaOrderItemId) }));
    const detail = presentOrder(order);
    if (detail.paymentStatus !== "confirmed") {
      await recordAttempt(tx, "failed", metadataFor(orderId, operatorId, itemRefs.length,
        `payment_not_confirmed_${detail.paymentStatus}`), 0);
      return failure(409, paymentBlockedMessage(detail.paymentStatus));
    }
    if (detail.status !== "pending" || !detail.items.length
      || detail.items.some(item => item.sourceStatus !== "pending")) {
      await recordAttempt(tx, "failed", metadataFor(orderId, operatorId, itemRefs.length, "rejected_not_pending"), 0);
      return failure(409, "Hanya pesanan berstatus Menunggu yang dapat dikirim.");
    }
    if (!order.syncedAt || !order.lazadaOrderId || !itemRefs.length) {
      await recordAttempt(tx, "failed", metadataFor(orderId, operatorId, itemRefs.length, "not_deliverable"), 0);
      return failure(409, "Pesanan Lazada ini belum memiliki item yang dapat dikirim.");
    }
    if (!allItemsExplicitlyDigital(order.items)) {
      await recordAttempt(tx, "failed", metadataFor(orderId, operatorId, itemRefs.length, "item_not_digital"), 0);
      return failure(409, "Semua item harus dikonfirmasi sebagai digital oleh Lazada sebelum dikirim.");
    }

    const history = await tx.select({ status: syncLogsTable.status, metadata: syncLogsTable.metadata })
      .from(syncLogsTable)
      .where(and(eq(syncLogsTable.source, AUDIT_SOURCE),
        sql`${syncLogsTable.metadata}->>'orderRecordId' = ${orderId}`))
      .orderBy(desc(syncLogsTable.startedAt));
    const successfulItemRecordIds = new Set(history.flatMap(row =>
      metadataStringArray(row.metadata, "successfulItemRecordIds")));
    const nonRetryableItemRecordIds = new Set(history.flatMap(row =>
      metadataStringArray(row.metadata, "nonRetryableItemRecordIds")));

    if (history.some(row => row.status === "completed")) {
      await recordAttempt(tx, "failed", metadataFor(orderId, operatorId, itemRefs.length, "previous_delivery_confirmed",
        [...successfulItemRecordIds], [...nonRetryableItemRecordIds]), 0);
      return failure(409, "Pengiriman sebelumnya sudah dikonfirmasi. Muat ulang status pesanan sebelum mencoba lagi.");
    }
    if (history.some(row => row.status === "running"))
      return failure(409, "Hasil pengiriman sebelumnya belum dapat dipastikan. Periksa status di Lazada sebelum mencoba lagi.");

    if (itemRefs.every(item => successfulItemRecordIds.has(item.recordId)))
      return failure(409, "Lazada telah mengonfirmasi seluruh item. Sinkronkan status pesanan sebelum mencoba lagi.");

    const retryableItems = itemRefs.filter(item =>
      !successfulItemRecordIds.has(item.recordId) && !nonRetryableItemRecordIds.has(item.recordId));
    if (!retryableItems.length) {
      await recordAttempt(tx, "failed", metadataFor(orderId, operatorId, itemRefs.length,
        "no_retryable_items", [...successfulItemRecordIds], [...nonRetryableItemRecordIds]), 0);
      return failure(409, "Lazada menandai item yang tersisa tidak dapat dicoba ulang.");
    }

    const audit = await recordAttempt(tx, "running", metadataFor(orderId, operatorId, itemRefs.length,
      "in_progress", [...successfulItemRecordIds], [...nonRetryableItemRecordIds]), retryableItems.length);
    return { attemptId: audit.id, itemRefs: retryableItems,
      successfulItemRecordIds: [...successfulItemRecordIds], nonRetryableItemRecordIds: [...nonRetryableItemRecordIds] };
  });

  if ("ok" in claim) return claim;

  try {
    return await db.transaction(async tx => {
      const locked = await tx.execute<{ locked: boolean }>(
        sql`select pg_try_advisory_xact_lock(hashtext(${`lazada-orders:${config.fingerprint}`})) as locked`,
      );
      if (!locked.rows[0]?.locked) {
        await finishAttempt(tx, claim.attemptId, "failed",
          metadataFor(orderId, operatorId, claim.itemRefs.length, "lazada_operation_busy",
            claim.successfulItemRecordIds, claim.nonRetryableItemRecordIds), 0);
        return failure(409, "Operasi Lazada lain sedang berjalan. Coba lagi setelah operasi selesai.");
      }
      await tx.select({ id: ordersTable.id }).from(ordersTable)
        .where(eq(ordersTable.id, orderId)).for("update");
      const order = await findOrder(tx, orderId);
      if (!order) {
        await finishAttempt(tx, claim.attemptId, "failed",
          metadataFor(orderId, operatorId, claim.itemRefs.length, "order_missing"), 0);
        return failure(404, "Pesanan tidak ditemukan.");
      }
      const detail = presentOrder(order);
      if (detail.paymentStatus !== "confirmed") {
        await finishAttempt(tx, claim.attemptId, "failed",
          metadataFor(orderId, operatorId, claim.itemRefs.length,
            `payment_not_confirmed_${detail.paymentStatus}`), 0);
        return failure(409, paymentBlockedMessage(detail.paymentStatus));
      }
      if (detail.status !== "pending" || !detail.items.length
        || detail.items.some(item => item.sourceStatus !== "pending")) {
        await finishAttempt(tx, claim.attemptId, "failed",
          metadataFor(orderId, operatorId, claim.itemRefs.length, "order_no_longer_pending"), 0);
        return failure(409, "Hanya pesanan berstatus Menunggu yang dapat dikirim.");
      }
      if (!allItemsExplicitlyDigital(order.items)) {
        await finishAttempt(tx, claim.attemptId, "failed",
          metadataFor(orderId, operatorId, claim.itemRefs.length, "item_not_digital"), 0);
        return failure(409, "Semua item harus dikonfirmasi sebagai digital oleh Lazada sebelum dikirim.");
      }

      if (!await activeSession(tx, operatorId, sessionHash)) {
        await finishAttempt(tx, claim.attemptId, "failed",
          metadataFor(orderId, operatorId, claim.itemRefs.length, "session_inactive"), 0);
        return failure(401, "Sesi operator sudah tidak aktif.");
      }
      const [connection] = await tx.select().from(lazadaConnectionsTable).where(and(
        eq(lazadaConnectionsTable.userId, operatorId),
        eq(lazadaConnectionsTable.appFingerprint, config.fingerprint),
        eq(lazadaConnectionsTable.country, config.country),
        eq(lazadaConnectionsTable.verified, "yes"),
        gt(lazadaConnectionsTable.expiresAt, new Date()),
      ));
      if (!connection) {
        await finishAttempt(tx, claim.attemptId, "failed",
          metadataFor(orderId, operatorId, claim.itemRefs.length, "connection_unavailable"), 0);
        return failure(409, "Koneksi Lazada tidak aktif. Hubungkan ulang di Pengaturan.");
      }

      let accessToken: unknown;
      try { accessToken = JSON.parse(unseal(connection.encryptedTokens, config, operatorId)).accessToken; }
      catch {
        await finishAttempt(tx, claim.attemptId, "failed",
          metadataFor(orderId, operatorId, claim.itemRefs.length, "connection_unavailable"), 0);
        return failure(409, "Koneksi Lazada tidak aktif. Hubungkan ulang di Pengaturan.");
      }
      if (typeof accessToken !== "string" || !accessToken) {
        await finishAttempt(tx, claim.attemptId, "failed",
          metadataFor(orderId, operatorId, claim.itemRefs.length, "connection_unavailable"), 0);
        return failure(409, "Koneksi Lazada tidak aktif. Hubungkan ulang di Pengaturan.");
      }

      let freshOrder: PresentedOrder;
      let freshItemsAreDigital = false;
      try {
        const refreshed = await refreshOrderFromLazada(tx, order, accessToken, createClient(config));
        freshOrder = refreshed.order;
        freshItemsAreDigital = refreshed.allItemsDigital;
      } catch {
        await finishAttempt(tx, claim.attemptId, "failed",
          metadataFor(orderId, operatorId, claim.itemRefs.length, "payment_preflight_unavailable"), 0);
        return failure(409, "Status pembayaran terbaru tidak dapat diverifikasi dari Lazada. Pesanan tidak dikirim.");
      }
      if (freshOrder.paymentStatus !== "confirmed") {
        await finishAttempt(tx, claim.attemptId, "failed",
          metadataFor(orderId, operatorId, claim.itemRefs.length,
            `live_payment_not_confirmed_${freshOrder.paymentStatus}`), 0);
        return failure(409, paymentBlockedMessage(freshOrder.paymentStatus));
      }
      if (freshOrder.status !== "pending" || !freshOrder.items.length
        || freshOrder.items.some(item => item.sourceStatus !== "pending")) {
        await finishAttempt(tx, claim.attemptId, "failed",
          metadataFor(orderId, operatorId, claim.itemRefs.length, "live_order_no_longer_pending"), 0);
        return failure(409, "Status proses pesanan berubah di Lazada. Muat ulang pesanan sebelum mengirim.");
      }
      if (!freshItemsAreDigital) {
        await finishAttempt(tx, claim.attemptId, "failed",
          metadataFor(orderId, operatorId, claim.itemRefs.length, "live_item_not_digital"), 0);
        return failure(409, "Semua item harus dikonfirmasi sebagai digital oleh Lazada sebelum dikirim.");
      }

      let providerResult;
      try {
        providerResult = await createClient(config).deliverDigital(
          accessToken,
          providerId(order.lazadaOrderId),
          claim.itemRefs.map(item => item.providerId),
        );
      } catch (error) {
        if (error instanceof LazadaError && error.reason === "api_unavailable") {
          try {
            const observed = (await refreshOrderFromLazada(tx, order, accessToken, createClient(config))).order;
            if (observed.paymentStatus === "confirmed" && observed.items.length > 0
              && observed.items.every(item => item.status === "completed")) {
              const allItemIds = order.items.map(item => item.id);
              await finishAttempt(tx, claim.attemptId, "completed",
                metadataFor(orderId, operatorId, allItemIds.length, "status_confirmed_after_api_error",
                  allItemIds, claim.nonRetryableItemRecordIds), claim.itemRefs.length);
              return { ok: true, order: observed };
            }
            if (observed.paymentStatus === "confirmed" && observed.status === "pending"
              && observed.items.length > 0 && observed.items.every(item => item.sourceStatus === "pending")) {
              await finishAttempt(tx, claim.attemptId, "failed",
                metadataFor(orderId, operatorId, claim.itemRefs.length, "provider_error_order_still_pending",
                  claim.successfulItemRecordIds, claim.nonRetryableItemRecordIds), 0);
              return failure(502, "Lazada gagal memproses pengiriman digital. Pesanan masih Menunggu dan dapat dicoba lagi.");
            }
            await finishAttempt(tx, claim.attemptId, "failed",
              metadataFor(orderId, operatorId, claim.itemRefs.length, "provider_error_status_changed",
                claim.successfulItemRecordIds, claim.nonRetryableItemRecordIds), 0);
            return failure(409, "Status pesanan berubah di Lazada. Muat ulang pesanan sebelum mengambil tindakan berikutnya.");
          } catch {
            await finishAttempt(tx, claim.attemptId, "running",
              metadataFor(orderId, operatorId, claim.itemRefs.length, "delivery_result_unresolved",
                claim.successfulItemRecordIds, claim.nonRetryableItemRecordIds), 0);
            return failure(409, "Hasil pengiriman belum dapat dipastikan. Periksa status pesanan di Lazada sebelum mencoba lagi.");
          }
        }
        const unresolved = error instanceof LazadaError && error.reason === "invalid_response";
        await finishAttempt(tx, claim.attemptId, unresolved ? "running" : "failed",
          metadataFor(orderId, operatorId, claim.itemRefs.length, unresolved ? "provider_result_unresolved" : "provider_error",
            claim.successfulItemRecordIds, claim.nonRetryableItemRecordIds), 0);
        if (unresolved)
          return failure(409, "Respons Lazada tidak dapat diverifikasi. Periksa status pesanan di Lazada sebelum mencoba lagi.");
        if (error instanceof LazadaError && error.reason === "authorization_failed")
          return failure(409, "Koneksi Lazada tidak valid atau kedaluwarsa. Hubungkan ulang di Pengaturan.");
        if (error instanceof LazadaError && error.reason === "permission_denied")
          return failure(502, "Lazada menolak izin DeliverDigital. Periksa izin aplikasi di Lazada.");
        return failure(502, "Lazada gagal memproses pengiriman digital. Pesanan belum ditandai selesai; silakan coba lagi.");
      }

      if (!providerResult.success) {
        await finishAttempt(tx, claim.attemptId, "failed",
          metadataFor(orderId, operatorId, claim.itemRefs.length, "provider_rejected",
            claim.successfulItemRecordIds, claim.nonRetryableItemRecordIds), 0);
        return failure(502, "Lazada menolak pengiriman digital. Pesanan belum ditandai selesai; silakan coba lagi.");
      }
      if (!responseMatches(providerResult.items, providerId(order.lazadaOrderId), claim.itemRefs)) {
        await finishAttempt(tx, claim.attemptId, "running",
          metadataFor(orderId, operatorId, claim.itemRefs.length, "provider_result_unresolved",
            claim.successfulItemRecordIds, claim.nonRetryableItemRecordIds), 0);
        return failure(409, "Respons Lazada tidak cocok dengan item pesanan. Periksa status pesanan di Lazada sebelum mencoba lagi.");
      }

      const byProviderId = new Map(claim.itemRefs.map(item => [item.providerId, item.recordId]));
      const newlySuccessful = providerResult.items.filter(item => item.itemErrorCode === "0")
        .map(item => byProviderId.get(item.orderItemId)!)
        .filter((itemId): itemId is string => !!itemId);
      const newlyNonRetryable = providerResult.items.filter(item => item.itemErrorCode !== "0" && !item.retry)
        .map(item => byProviderId.get(item.orderItemId)!)
        .filter((itemId): itemId is string => !!itemId);
      const allSuccessful = new Set([...claim.successfulItemRecordIds, ...newlySuccessful]);
      const nonRetryable = new Set([...claim.nonRetryableItemRecordIds, ...newlyNonRetryable]);
      const allItemIds = order.items.map(item => item.id);
      if (allItemIds.every(itemId => allSuccessful.has(itemId))) {
        let refreshed;
        try {
          refreshed = (await refreshOrderFromLazada(tx, order, accessToken, createClient(config))).order;
          if (refreshed.paymentStatus !== "confirmed" || refreshed.items.length !== allItemIds.length
            || !refreshed.items.every(item => item.status === "completed")) {
            throw new LazadaError("invalid_response");
          }
        } catch {
          await finishAttempt(tx, claim.attemptId, "running",
            metadataFor(orderId, operatorId, allItemIds.length, "post_delivery_status_unresolved",
              [...allSuccessful], [...nonRetryable]), claim.itemRefs.length);
          return failure(409, "Lazada menerima pengiriman, tetapi status terbaru belum dapat diverifikasi. Sinkronkan pesanan sebelum mencoba lagi.");
        }
        await finishAttempt(tx, claim.attemptId, "completed",
          metadataFor(orderId, operatorId, allItemIds.length, "confirmed",
            [...allSuccessful], [...nonRetryable]), claim.itemRefs.length);
        return { ok: true, order: refreshed };
      }

      await finishAttempt(tx, claim.attemptId, "failed",
        metadataFor(orderId, operatorId, allItemIds.length, "item_failure",
          [...allSuccessful], [...nonRetryable]), claim.itemRefs.length);
      return failure(502, "Lazada belum mengonfirmasi semua item. Status pesanan tidak diubah; item yang dapat dicoba ulang tetap tersedia.");
    });
  } catch (error) {
    // If the provider accepted delivery but persistence failed, keep the durable running record.
    // A later attempt must not risk sending the same digital order twice.
    if (error instanceof LazadaError && error.reason === "authorization_failed")
      return failure(409, "Koneksi Lazada tidak valid atau kedaluwarsa. Hubungkan ulang di Pengaturan.");
    return failure(502, "Hasil pengiriman tidak dapat disimpan dengan aman. Periksa pesanan di Lazada sebelum mencoba lagi.");
  }
}

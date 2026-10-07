const LAZADA_STATUS_LABELS: Readonly<Record<string, string>> = {
  unpaid: 'Belum Dibayar',
  pending: 'Belum Dibayar',
  repacked: 'Dikemas',
  packed: 'Dikemas',
  topack: 'Dikemas',
  to_pack: 'Dikemas',
  ready_to_ship_pending: 'Dikemas',
  ready_to_ship: 'Dikemas',
  toship: 'Dikirim',
  to_ship: 'Dikirim',
  shipped: 'Dikirim',
  shipping: 'Dikirim',
  delivered: 'Selesai',
  confirmed: 'Selesai',
  canceled: 'Dibatalkan',
  cancelled: 'Dibatalkan',
};

export function isKnownLazadaStatus(status: string): boolean {
  return Object.hasOwn(LAZADA_STATUS_LABELS, status);
}

export function lazadaStatusLabel(status: string, paymentStatus?: string | null): string {
  if (paymentStatus === 'cancelled') return 'Dibatalkan';
  if (status === 'pending') {
    if (paymentStatus === 'confirmed') return 'Menunggu Proses';
    if (paymentStatus === 'unknown') return 'Status tidak diketahui';
  }
  return LAZADA_STATUS_LABELS[status] ?? status;
}

export function lazadaStatusesLabel(
  source: string | readonly (string | null | undefined)[] | null | undefined,
  paymentStatus?: string | null,
): string | null {
  const statuses = (Array.isArray(source) ? source : [source])
    .filter((status): status is string => typeof status === 'string' && status.length > 0);
  if (!statuses.length) return null;
  return [...new Set(statuses.map(status => lazadaStatusLabel(status, paymentStatus)))].join(', ');
}

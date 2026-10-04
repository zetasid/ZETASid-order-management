export const rupiah = (n: number | null) =>
  n === null ? 'Tidak tersedia' : new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n);

export const providerMoney = (value?: string | null, currency?: string | null) =>
  value === null || value === undefined || value === '' ? 'Tidak tersedia' : `${value}${currency ? ` ${currency}` : ''}`;

export const tanggal = (iso: string) =>
  new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

export const STATUS_LABEL = { pending: 'Menunggu', processing: 'Diproses', completed: 'Selesai', cancelled: 'Dibatalkan' } as const;

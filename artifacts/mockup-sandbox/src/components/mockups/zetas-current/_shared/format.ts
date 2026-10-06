export const rupiah = (n: number | null) => n === null ? 'Tidak tersedia' : new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n);
export const providerMoney = (value?: string | null, currency?: string | null) => value === null || value === undefined || value === '' ? 'Tidak tersedia' : `${value}${currency ? ` ${currency}` : ''}`;
export const orderMoney = (value?: string | null, currency?: string | null, fallback?: number | null) => {
  if (value === null || value === undefined || value.trim() === '') return fallback === null || fallback === undefined ? 'Tidak tersedia' : rupiah(fallback);
  if (currency?.toUpperCase() === 'IDR') {
    const amount = Number(value);
    if (Number.isFinite(amount)) return rupiah(amount);
  }
  if (!currency && fallback !== null && fallback !== undefined) return rupiah(fallback);
  return providerMoney(value, currency);
};
const wibDateTime = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export const waktuWib = (value?: string | null) => {
  if (!value) return 'Tidak tersedia';
  const normalized = value.trim().replace(/^(\d{4}-\d{2}-\d{2}) /, '$1T').replace(/(\d{2}:\d{2}:\d{2})\s+([+-]\d{2}:?\d{2})$/, '$1$2').replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return 'Tidak tersedia';
  const parts = Object.fromEntries(wibDateTime.formatToParts(date).map(({ type, value: part }) => [type, part]));
  return `${parts.day} ${parts.month} ${parts.year} • ${parts.hour}:${parts.minute} WIB`;
};
export const tanggal = (iso: string) => new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
export const STATUS_LABEL = { pending: 'Menunggu', processing: 'Diproses', completed: 'Selesai', cancelled: 'Dibatalkan' } as const;

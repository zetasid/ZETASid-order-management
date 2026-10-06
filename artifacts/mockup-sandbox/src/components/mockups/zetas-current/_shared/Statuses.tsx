import { STATUS_LABEL } from './format';
import type { Order } from './fixtures';

export function StatusBadge({ status }: { status: keyof typeof STATUS_LABEL }) {
  const tones = {
    pending: 'bg-accent/25 text-foreground',
    processing: 'bg-primary/10 text-primary',
    completed: 'bg-[hsl(160_40%_35%/0.15)] text-[hsl(160_45%_24%)]',
    cancelled: 'bg-destructive/10 text-destructive',
  };
  return <span data-testid={`status-${status}`} className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[status]}`}>{STATUS_LABEL[status]}</span>;
}

const paymentLabels: Record<Order['paymentStatus'], string> = {
  unpaid: 'Belum dibayar', pending: 'Menunggu konfirmasi', confirmed: 'Dikonfirmasi', cancelled: 'Dibatalkan', unknown: 'Tidak diketahui',
};
const paymentTones: Record<Order['paymentStatus'], string> = {
  unpaid: 'border-[#FED7AA] bg-[#FFF7ED] text-[#C2410C]',
  pending: 'border-[#FED7AA] bg-[#FFF7ED] text-[#C2410C]',
  confirmed: 'border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]',
  cancelled: 'border-[#FECACA] bg-[#FEF2F2] text-[#DC2626]',
  unknown: 'border-[#CBD5E1] bg-[#F1F5F9] text-[#475569]',
};
export const paymentStatusLabel = (status: Order['paymentStatus']) => paymentLabels[status];
export function PaymentStatusBadge({ status }: { status: Order['paymentStatus'] }) {
  return <span data-testid={`payment-status-${status}`} className={`inline-flex max-w-40 items-center justify-center rounded-md border px-2 py-1 text-[10px] font-medium leading-3 ${paymentTones[status]}`}>Pembayaran: {paymentStatusLabel(status)}</span>;
}
export function ProviderStatus({ status, source }: { status: Order['status']; source?: string | string[] | null }) {
  const text = Array.isArray(source) ? source.join(', ') : source;
  return text ? <span className="max-w-full break-words rounded-md border bg-background px-2 py-1 font-mono text-xs text-foreground">{text}</span> : <StatusBadge status={status} />;
}

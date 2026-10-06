import type { Order } from '@workspace/api-client-react';

type PaymentStatus = Order['paymentStatus'];

export function paymentStatusLabel(status: PaymentStatus) {
  switch (status) {
    case 'unpaid': return 'Belum Dibayar';
    case 'pending': return 'Menunggu konfirmasi';
    case 'confirmed': return 'Dikonfirmasi';
    case 'cancelled': return 'Dibatalkan';
    case 'unknown': return 'Tidak diketahui';
  }
}

const PAYMENT_STATUS_TONE: Record<PaymentStatus, string> = {
  unpaid: 'border-[#FED7AA] bg-[#FFF7ED] text-[#C2410C]',
  pending: 'border-[#FED7AA] bg-[#FFF7ED] text-[#C2410C]',
  confirmed: 'border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]',
  cancelled: 'border-[#FECACA] bg-[#FEF2F2] text-[#DC2626]',
  unknown: 'border-[#CBD5E1] bg-[#F1F5F9] text-[#475569]',
};

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return (
    <span data-testid={`payment-status-${status}`}
      className={`inline-flex max-w-40 items-center justify-center rounded-full border px-2.5 py-1 text-[10px] font-semibold leading-3 ${PAYMENT_STATUS_TONE[status]}`}>
      Pembayaran: {paymentStatusLabel(status)}
    </span>
  );
}

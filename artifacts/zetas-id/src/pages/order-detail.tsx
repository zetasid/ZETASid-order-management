import { useParams } from 'wouter';
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { BadgeCheck, CalendarClock, CircleX, ClipboardList, Clock3, CreditCard, Info, Loader2, Package, PackageOpen, ReceiptText, Send, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ApiError, useDeliverDigitalOrder, useGetOrder, getGetOrderQueryKey } from '@workspace/api-client-react';
import { usePageMeta } from '@/hooks/use-page-meta';
import { orderMoney, waktuWib } from '@/lib/format';
import { ErrorState, ListSkeleton } from '@/components/states';
import { CopyValue, DigitalDetail } from '@/components/copy-detail';
import { paymentStatusLabel } from '@/components/payment-status';
import { ProductImage } from '@/components/product-image';
import { lazadaStatusesLabel } from '@/lib/lazada-status-label';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

function deliveryErrorText(error: unknown) {
  if (error instanceof ApiError && typeof error.data === 'object' && error.data
    && 'error' in error.data && typeof error.data.error === 'string') return error.data.error;
  return 'Lazada tidak mengonfirmasi semua item. Periksa status pesanan di Lazada sebelum mencoba lagi.';
}

const STATUS_VIEW = {
  pending: { title: 'Pesanan Belum Dibayar', description: 'Pembayaran belum terkonfirmasi. Pesanan tidak dapat diproses.', icon: Clock3, tone: 'border-[#FED7AA] bg-[#FFF3E8] text-[#B45309]', iconTone: 'bg-[#F97316] text-white' },
  processing: { title: 'Pesanan Diproses', description: 'Pesanan sedang diproses.', icon: Clock3, tone: 'border-[#BFDBFE] bg-[#EFF6FF] text-[#1D4ED8]', iconTone: 'bg-[#3B82F6] text-white' },
  completed: { title: 'Pesanan Selesai', description: 'Pesanan telah selesai diproses.', icon: BadgeCheck, tone: 'border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]', iconTone: 'bg-[#22C55E] text-white' },
  cancelled: { title: 'Pesanan Dibatalkan', description: 'Pesanan ini telah dibatalkan oleh sistem Lazada.', icon: CircleX, tone: 'border-[#FECACA] bg-[#FEF0F0] text-[#B91C1C]', iconTone: 'bg-[#EF4444] text-white' },
  unknown: { title: 'Status Pesanan', description: 'Status pesanan belum tersedia.', icon: Info, tone: 'border-[#CBD5E1] bg-[#F1F5F9] text-[#475569]', iconTone: 'bg-[#64748B] text-white' },
} as const;
const CONFIRMED_PENDING_VIEW = {
  ...STATUS_VIEW.pending,
  title: 'Pesanan Menunggu Proses',
  description: 'Pembayaran terkonfirmasi; pesanan menunggu pengiriman digital.',
};

function InfoRow({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <div className="grid min-h-11 grid-cols-[16px_72px_minmax(0,1fr)] items-center gap-2 border-b border-[#EEF0F4] py-1.5 last:border-b-0">
      <Icon aria-hidden="true" className="size-3.5 text-[#64748B]" />
      <dt className="text-xs leading-4 text-[#64748B]">{label}</dt>
      <dd className="min-w-0 text-[13px] font-medium text-[#0F172A]">{children}</dd>
    </div>
  );
}

export default function OrderDetail() {
  usePageMeta('Detail Pesanan', 'Item dan Digital Detail satu pesanan.');
  const { orderId = '' } = useParams<{ orderId: string }>();
  const queryClient = useQueryClient();
  const delivery = useDeliverDigitalOrder();
  const submitLock = useRef(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deliveryError, setDeliveryError] = useState('');
  const [deliveryNotice, setDeliveryNotice] = useState('');
  const q = useGetOrder(orderId, {
    query: { enabled: !!orderId, queryKey: getGetOrderQueryKey(orderId), staleTime: 15000, refetchOnWindowFocus: true, refetchOnMount: true },
  });
  const o = q.data;
  const items = o?.items ?? [];
  const workflowLabel = lazadaStatusesLabel(items.map(item => item.sourceStatus), o?.paymentStatus);
  const processingView = workflowLabel === 'Dikemas' || workflowLabel === 'Dikirim'
    ? { ...STATUS_VIEW.processing, title: `Pesanan ${workflowLabel}` }
    : STATUS_VIEW.processing;
  const statusView = !o ? STATUS_VIEW.unknown
    : o.status === 'cancelled' || o.paymentStatus === 'cancelled' ? STATUS_VIEW.cancelled
      : o.status === 'completed' ? STATUS_VIEW.completed
        : o.status === 'processing' ? processingView
          : o.status === 'pending'
            ? o.paymentStatus === 'confirmed' ? CONFIRMED_PENDING_VIEW
              : o.paymentStatus === 'unknown' ? STATUS_VIEW.unknown : STATUS_VIEW.pending
            : STATUS_VIEW.unknown;
  const StatusIcon = statusView.icon;
  const canDeliverDigital = !!o?.syncedAt && o.paymentStatus === 'confirmed' && o.status === 'pending'
    && items.length > 0 && items.every(item => item.sourceStatus === 'pending');
  const submitDelivery = () => {
    if (submitLock.current || delivery.isPending) return;
    submitLock.current = true;
    setDeliveryError('');
    delivery.mutate({ orderId }, {
      onSuccess: async updated => {
        queryClient.setQueryData(getGetOrderQueryKey(orderId), updated);
        await queryClient.invalidateQueries({ predicate: query =>
          typeof query.queryKey[0] === 'string'
          && (query.queryKey[0].startsWith('/api/orders') || query.queryKey[0].startsWith('/api/dashboard')),
        });
        setDeliveryNotice('Semua item diterima Lazada sebagai terkirim.');
        setConfirmOpen(false);
        submitLock.current = false;
      },
      onError: error => {
        setDeliveryError(deliveryErrorText(error));
        submitLock.current = false;
      },
    });
  };
  return (
    <div className="page-enter -mx-4 -my-4 bg-[#F4F6F9] px-4 py-3 pb-[calc(5rem+env(safe-area-inset-bottom))] md:mx-0 md:my-0 md:bg-transparent md:px-0 md:py-1 md:pb-8">
      <div className="mx-auto max-w-4xl space-y-4">

        {q.isLoading && <ListSkeleton rows={3} />}
        {q.isError && <ErrorState text="Pesanan tidak ditemukan atau server tidak merespons." onRetry={() => q.refetch()} />}
        {o && (
          <div className="space-y-3">
            <section aria-labelledby="order-status-heading" style={{ animationDelay: '0ms' }} className={`stagger-in flex items-center gap-3 rounded-2xl border px-4 py-4 shadow-[0_2px_10px_rgba(24,39,75,.04)] ${statusView.tone}`}>
              <span className={`grid size-10 shrink-0 place-items-center rounded-full ${statusView.iconTone}`}>
                <StatusIcon aria-hidden="true" className="size-5" />
              </span>
              <div className="min-w-0">
                <h2 id="order-status-heading" className="text-sm font-semibold">{statusView.title}</h2>
                <p className="mt-0.5 text-xs leading-4 opacity-90">{statusView.description}</p>
              </div>
            </section>

            {deliveryNotice && (
              <p role="status" data-testid="status-delivery-success"
                className="rounded-xl border border-[#BBF7D0] bg-[#F0FDF4] p-4 text-sm font-medium text-[#166534]">
                {deliveryNotice}
              </p>
            )}
            {deliveryError && !confirmOpen && (
              <p role="alert" data-testid="error-deliver-digital"
                className="rounded-xl border border-[#FECACA] bg-white p-4 text-sm text-[#DC2626]">
                {deliveryError}
              </p>
            )}

            <section aria-labelledby="order-info-heading" style={{ animationDelay: '45ms' }} className="surface-card stagger-in rounded-2xl px-4 py-4 sm:px-5">
              <h2 id="order-info-heading" className="mb-2 text-[15px] font-bold tracking-[-.01em] text-[#14213A]">Informasi Pesanan</h2>
              <dl>
                <InfoRow icon={ClipboardList} label="Order ID">
                  <CopyValue id="order-id" label="Order ID" value={o.marketplaceOrderId} />
                </InfoRow>
                <InfoRow icon={CreditCard} label="Pembayaran">{paymentStatusLabel(o.paymentStatus)}</InfoRow>
                {items.map((item, index) => (
                  <InfoRow key={`info-${item.id}`} icon={Package} label={items.length > 1 ? `Item ID ${index + 1}` : 'Item ID'}>
                    <CopyValue id={`item-info-${item.id}`} label="Item ID" value={item.lazadaOrderItemId} />
                  </InfoRow>
                ))}
                <InfoRow icon={CalendarClock} label="Waktu order">{waktuWib(o.sourceCreatedAt ?? o.createdAt)}</InfoRow>
                <InfoRow icon={ReceiptText} label="Nilai transaksi">{orderMoney(o.sourcePrice, o.currency, o.amount)}</InfoRow>
              </dl>
              {(o.paymentStatus !== 'confirmed' || (o.status !== 'completed' && items.some(item => item.sourceStatus !== 'pending'))) && (
                <p role="note" className="mt-2 rounded-lg border border-[#FED7AA] bg-[#FFF7ED] px-3 py-2 text-xs leading-4 text-[#9A3412]">
                  {o.paymentStatus !== 'confirmed'
                    ? 'Pengiriman digital dinonaktifkan sampai status pembayaran dikonfirmasi oleh Lazada.'
                    : 'Status item Lazada belum memenuhi syarat untuk pengiriman digital.'}
                </p>
              )}
            </section>

            <section aria-labelledby="order-products-heading" style={{ animationDelay: '90ms' }} className="stagger-in space-y-2">
              <h2 id="order-products-heading" className="px-0.5 text-[15px] font-bold tracking-[-.01em] text-[#14213A]">Produk</h2>
              {items.length === 0 ? (
                <div data-testid="state-no-items" className="rounded-xl border border-dashed border-[#CBD5E1] bg-white px-4 py-5 text-sm text-[#64748B]">
                  {o.productName?.trim() || 'Produk tidak tersedia'}
                </div>
              ) : (
                <ul className="space-y-2">
                  {items.map((i) => (
                    <li key={i.id} data-testid={`item-${i.id}`} className="surface-card rounded-2xl p-4">
                      <div className="flex min-w-0 items-center gap-3">
                        <ProductImage
                          src={i.productMainImage}
                          alt={`Foto produk: ${i.productName || 'produk'}`}
                          testId={`img-product-${i.id}`}
                          imageClassName="size-12 shrink-0 rounded-lg border border-[#E5E7EB] object-cover"
                          fallbackClassName="grid size-12 shrink-0 place-items-center rounded-lg border border-[#E5E7EB] bg-[#F8FAFC] text-[#64748B]"
                        />
                        <div className="min-w-0 flex-1">
                          <h3 className="break-words text-xs font-semibold leading-4 text-[#0F172A]">{i.productName}</h3>
                          <p className="mt-1 inline-flex max-w-full rounded-md bg-[#FFF4E9] px-2 py-1 text-[11px] leading-4 text-[#7C4A24]">
                            <span className="truncate">Variasi: {i.variation?.trim() || 'Tidak tersedia'}</span>
                          </p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="digital-detail-heading" style={{ animationDelay: '135ms' }} className="surface-card stagger-in rounded-2xl px-4 py-4 sm:px-5">
              <h2 id="digital-detail-heading" className="mb-3 text-[15px] font-bold tracking-[-.01em] text-[#14213A]">Detail Digital</h2>
              {items.length === 0 ? (
                <p className="py-2 text-xs text-[#64748B]">Tidak tersedia.</p>
              ) : (
                <div className="space-y-2">
                  {items.map(i => (
                    <div key={`digital-${i.id}`} className="min-w-0">
                      {items.length > 1 && <p className="mb-1 text-xs font-medium text-[#64748B]">{i.productName}</p>}
                      <DigitalDetail id={i.id} value={i.digitalDetail} />
                    </div>
                  ))}
                </div>
              )}
              {o.status === 'cancelled' && items.length > 0 && items.every(i => !i.digitalDetail?.trim()) && (
                <div className="mt-3 flex items-start gap-2 rounded-lg bg-[#EEF6FF] px-3 py-2.5 text-xs leading-4 text-[#315B85]">
                  <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[#3B82F6]" />
                  <p>Data detail digital tidak tersedia karena pesanan dibatalkan.</p>
                </div>
              )}
              {canDeliverDigital && (
                <Button onClick={() => { setDeliveryError(''); setDeliveryNotice(''); setConfirmOpen(true); }}
                  disabled={delivery.isPending} data-testid="button-deliver-digital"
                  className="mt-3 min-h-11 w-full rounded-lg border-[#F97316] bg-[#F97316] px-5 font-semibold text-white hover:bg-[#EA580C]">
                  <Send aria-hidden="true" className="size-4" /> {delivery.isPending ? 'Mengirim…' : 'Kirim Digital'}
                </Button>
              )}
            </section>

            {items.some(i => o.syncedAt && i.extraAttributes) && (
              <details style={{ animationDelay: '180ms' }} className="stagger-in rounded-xl border border-[#E5E7EB] bg-white">
                <summary className="flex min-h-11 cursor-pointer items-center px-3.5 text-xs font-medium text-[#64748B]">Informasi tambahan</summary>
                <div className="space-y-3 px-3.5 pb-3.5">
                  {items.filter(i => i.extraAttributes).map(i => (
                    <pre key={`extra-${i.id}`} className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-[#F8FAFC] p-2 font-mono text-[10px] text-[#64748B]">{i.extraAttributes}</pre>
                  ))}
                </div>
              </details>
            )}

            <AlertDialog open={confirmOpen} onOpenChange={open => {
              if (!delivery.isPending) {
                setConfirmOpen(open);
                if (open) setDeliveryError('');
              }
            }}>
              <AlertDialogContent className="fixed inset-x-0 bottom-0 left-0 top-auto z-50 grid max-h-[88dvh] w-full max-w-none translate-x-0 translate-y-0 gap-4 overflow-y-auto rounded-t-2xl border-[#E2E8F0] bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-[0_-8px_30px_rgba(15,23,42,0.16)] md:left-1/2 md:top-1/2 md:bottom-auto md:w-[calc(100%-2rem)] md:max-w-lg md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl md:p-6">
                <AlertDialogCancel disabled={delivery.isPending} data-testid="button-close-deliver-confirmation"
                  aria-label="Tutup konfirmasi" className="absolute right-3 top-3 z-10 grid size-10 min-h-0 place-items-center border-0 bg-transparent p-0 text-[#64748B] shadow-none hover:bg-[#F1F5F9]">
                  <X aria-hidden="true" className="size-4" />
                </AlertDialogCancel>
                <AlertDialogHeader className="pr-9 text-left">
                  <AlertDialogTitle className="text-sm font-semibold text-[#0F172A]">Konfirmasi Pesanan</AlertDialogTitle>
                  <AlertDialogDescription className="text-xs leading-5 text-[#64748B]">
                    Pastikan data berikut sudah benar sebelum mengirim.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <section aria-label="Ringkasan data yang akan dikirim" className="max-h-[40dvh] space-y-2 overflow-y-auto">
                  {items.map((i) => (
                    <article key={`confirm-${i.id}`} className="min-w-0 rounded-xl border border-[#E5E7EB] bg-[#F8FAFC] p-3">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white text-[#64748B]">
                          <PackageOpen aria-hidden="true" className="size-4" />
                        </span>
                        <h3 className="min-w-0 break-words text-xs font-semibold leading-4 text-[#0F172A]">{i.productName}</h3>
                      </div>
                      <div className="mt-2.5">
                        <DigitalDetail id={`confirm-${i.id}`} value={i.digitalDetail} />
                      </div>
                      <div className="mt-2 flex items-start justify-between gap-3 border-t border-[#E5E7EB] pt-2 text-xs">
                        <span className="shrink-0 text-[#64748B]">Variasi</span>
                        <span className="text-right font-medium text-[#0F172A]">{i.variation?.trim() || 'Tidak tersedia'}</span>
                      </div>
                    </article>
                  ))}
                </section>
                {deliveryError && <p role="alert" data-testid="error-deliver-digital-confirm" className="text-sm text-[#DC2626]">{deliveryError}</p>}
                <AlertDialogFooter className="grid w-full grid-cols-2 gap-2 sm:flex sm:flex-row sm:justify-end">
                  <AlertDialogCancel disabled={delivery.isPending} data-testid="button-cancel-deliver-digital" className="min-h-11 w-full rounded-lg border-0 bg-[#EFF1F4] font-semibold text-[#334155] hover:bg-[#E5E7EB]">
                    Batal
                  </AlertDialogCancel>
                  <AlertDialogAction onClick={event => { event.preventDefault(); submitDelivery(); }}
                    disabled={delivery.isPending} data-testid="button-confirm-deliver-digital"
                    className="min-h-11 w-full rounded-lg border-[#F97316] bg-[#F97316] font-semibold text-white hover:bg-[#EA580C]">
                    {delivery.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
                    {delivery.isPending ? 'Mengirim…' : 'Kirim Digital'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </div>
    </div>
  );
}

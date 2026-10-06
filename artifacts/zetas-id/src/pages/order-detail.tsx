import { Link, useParams, useSearch } from 'wouter';
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, PackageOpen, Send } from 'lucide-react';
import { ApiError, useDeliverDigitalOrder, useGetOrder, getGetOrderQueryKey } from '@workspace/api-client-react';
import { usePageMeta } from '@/hooks/use-page-meta';
import { orderMoney, waktuWib } from '@/lib/format';
import { ErrorState, ListSkeleton } from '@/components/states';
import { CopyValue, DigitalDetail } from '@/components/copy-detail';
import { ProviderStatus } from '@/components/provider-status';
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

export default function OrderDetail() {
  usePageMeta('Detail Pesanan', 'Item dan Digital Detail satu pesanan.');
  const { orderId = '' } = useParams<{ orderId: string }>();
  const from = new URLSearchParams(useSearch()).get('from') ?? '';
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
  const rows = o && [
    ['Waktu order', waktuWib(o.sourceCreatedAt ?? o.createdAt)],
    ['Nilai transaksi', orderMoney(o.sourcePrice, o.currency, o.amount)],
    ['Pembeli', o.buyerName?.trim() || 'Tidak tersedia'],
  ];
  return (
    <div className="relative left-1/2 -my-6 w-screen -translate-x-1/2 bg-[#F8FAFC]">
      <div className="mx-auto max-w-4xl space-y-5 px-4 py-4 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:px-6 sm:py-6 md:pb-8">
        <header className="flex min-h-12 items-center gap-3">
          <Link href={`/orders${from ? `?${from}` : ''}`} data-testid="link-back"
            aria-label="Kembali ke halaman sebelumnya"
            onClick={event => {
              if (window.history.length > 1) {
                event.preventDefault();
                window.history.back();
              }
            }}
            className="grid size-11 shrink-0 place-items-center rounded-xl border border-[#E2E8F0] bg-white text-[#1E293B] shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:bg-[#F8FAFC]">
            <ArrowLeft aria-hidden="true" className="size-4" />
          </Link>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#F97316]">Pesanan</p>
            <h1 className="text-xl font-bold tracking-tight text-[#0F172A] sm:text-2xl">Detail Pesanan</h1>
          </div>
        </header>

        {q.isLoading && <ListSkeleton rows={3} />}
        {q.isError && <ErrorState text="Pesanan tidak ditemukan atau server tidak merespons." onRetry={() => q.refetch()} />}
        {o && rows && (
          <div className="space-y-5">
            <section aria-labelledby="order-status-heading" className="overflow-hidden rounded-2xl border border-[#E2E8F0] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <div className="min-w-0">
                  <h2 id="order-status-heading" className="text-xs font-semibold uppercase tracking-[0.12em] text-[#64748B]">Status pesanan</h2>
                  <p className="mt-1 text-sm leading-5 text-[#1E293B]">Status terbaru dari data Lazada.</p>
                </div>
                <div className="shrink-0 [&_[data-testid=status-pending]]:bg-[#FFF7ED] [&_[data-testid=status-pending]]:text-[#C2410C] [&_[data-testid=status-processing]]:bg-[#EFF6FF] [&_[data-testid=status-processing]]:text-[#2563EB] [&_[data-testid=status-completed]]:bg-[#F0FDF4] [&_[data-testid=status-completed]]:text-[#15803D] [&_[data-testid=status-cancelled]]:bg-[#FEF2F2] [&_[data-testid=status-cancelled]]:text-[#DC2626]">
                  <ProviderStatus status={o.status} />
                </div>
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

            <section aria-labelledby="order-info-heading" className="overflow-hidden rounded-2xl border border-[#E2E8F0] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <div className="border-b border-[#E2E8F0] px-4 py-3.5 sm:px-5">
                <h2 id="order-info-heading" className="font-semibold text-[#0F172A]">Informasi pesanan</h2>
              </div>
              <dl className="grid grid-cols-1 sm:grid-cols-2">
                <div className="min-w-0 border-b border-[#E2E8F0] px-4 py-3.5 sm:border-r">
                  <dt className="text-xs font-medium text-[#64748B]">Order ID</dt>
                  <dd className="mt-1"><CopyValue id="order-id" label="Order ID" value={o.marketplaceOrderId} /></dd>
                </div>
                {rows.map(([k, v]) => (
                  <div key={k} className="min-w-0 border-b border-[#E2E8F0] px-4 py-3.5 last:border-b-0 sm:odd:border-r">
                    <dt className="text-xs font-medium text-[#64748B]">{k}</dt>
                    <dd data-testid={`text-${k}`} className="mt-1 break-words font-mono text-sm text-[#0F172A]">{v}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section aria-labelledby="order-items-heading" className="space-y-3">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <h2 id="order-items-heading" className="text-lg font-semibold tracking-tight text-[#0F172A]">Item pesanan</h2>
                  <p className="mt-0.5 text-sm text-[#64748B]">{items.length} item dalam pesanan ini</p>
                </div>
              </div>
              {items.length === 0 ? (
                <div data-testid="state-no-items" className="rounded-2xl border border-dashed border-[#CBD5E1] bg-white px-4 py-7 text-center">
                  <p className="break-words font-semibold text-sm text-[#0F172A]">{o.productName || 'Produk belum tersedia'}</p>
                  <p className="mt-2 text-sm leading-5 text-[#64748B]">Item dan detail digital tidak tersedia dari data pesanan ini.</p>
                </div>
              ) : (
                <ul className="space-y-3">
                  {items.map((i) => (
                    <li key={i.id} data-testid={`item-${i.id}`} className="overflow-hidden rounded-2xl border border-[#E2E8F0] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                      <div className="flex items-start gap-3 border-b border-[#E2E8F0] bg-[#F8FAFC] px-4 py-4 sm:gap-4 sm:px-5">
                        <div role="img" aria-label="Foto produk tidak tersedia dari data pesanan"
                          className="grid size-14 shrink-0 place-items-center rounded-xl border border-[#E2E8F0] bg-white text-[#64748B] sm:size-16">
                          <PackageOpen aria-hidden="true" className="size-6" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#F97316]">Produk</p>
                          <h3 className="mt-1 break-words text-sm font-semibold leading-5 text-[#0F172A] sm:text-base">{i.productName}</h3>
                          <div className="mt-2">
                            <dt className="text-xs font-medium text-[#64748B]">Item ID</dt>
                            <dd className="mt-1"><CopyValue id={`item-${i.id}`} label="Item ID" value={i.lazadaOrderItemId} /></dd>
                          </div>
                        </div>
                        <div className="shrink-0 [&_[data-testid=status-pending]]:bg-[#FFF7ED] [&_[data-testid=status-pending]]:text-[#C2410C] [&_[data-testid=status-processing]]:bg-[#EFF6FF] [&_[data-testid=status-processing]]:text-[#2563EB] [&_[data-testid=status-completed]]:bg-[#F0FDF4] [&_[data-testid=status-completed]]:text-[#15803D] [&_[data-testid=status-cancelled]]:bg-[#FEF2F2] [&_[data-testid=status-cancelled]]:text-[#DC2626]">
                          <ProviderStatus status={i.status} />
                        </div>
                      </div>

                      <p className="border-b border-[#E2E8F0] px-4 py-2.5 text-xs leading-5 text-[#64748B] sm:px-5">
                        Waktu item {waktuWib(i.sourceCreatedAt ?? i.createdAt)}
                      </p>

                      {o.syncedAt && (
                        <dl className="grid grid-cols-1 gap-x-5 gap-y-4 border-b border-[#E2E8F0] px-4 py-4 sm:grid-cols-2 sm:px-5">
                          {[
                            ['Nominal/variasi', i.variation || 'Tidak tersedia'],
                            ['Harga item', orderMoney(i.itemPrice, i.currency ?? o.currency)],
                            ['Harga dibayar', orderMoney(i.paidPrice, i.currency ?? o.currency)],
                            ['SKU', i.sku || 'Tidak tersedia'],
                            ['Shop SKU', i.shopSku || 'Tidak tersedia'],
                          ].map(([key, value]) => (
                            <div key={key} className="min-w-0">
                              <dt className="text-xs font-medium text-[#64748B]">{key}</dt>
                              <dd className="mt-1 break-all font-mono text-sm text-[#0F172A]">{value}</dd>
                            </div>
                          ))}
                        </dl>
                      )}

                      <div className="px-4 py-4 sm:px-5">
                        <div className="mb-3">
                          <h3 className="text-sm font-semibold text-[#0F172A]">Detail Digital</h3>
                          {o.syncedAt && (
                            <p className="mt-1 text-xs leading-5 text-[#64748B]">
                              {i.digitalDetailSource ? 'Data tujuan yang tersedia dari Lazada.' : 'Data tujuan tidak tersedia dari Lazada.'}
                            </p>
                          )}
                        </div>
                        <DigitalDetail id={i.id} value={i.digitalDetail} />
                      </div>

                      {o.syncedAt && (
                        <details className="border-t border-[#E2E8F0]">
                          <summary className="flex min-h-11 cursor-pointer items-center px-4 py-3 text-xs font-medium text-[#64748B] transition-colors hover:bg-[#F8FAFC] sm:px-5">
                            Informasi tambahan
                          </summary>
                          <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all bg-[#F8FAFC] px-4 py-3 font-mono text-xs text-[#64748B] sm:px-5">{i.extraAttributes ?? 'Field tidak tersedia atau bernilai null.'}</pre>
                        </details>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {o.syncedAt && o.status === 'pending' && items.length > 0 && (
              <section aria-labelledby="order-action-heading" className="flex flex-col gap-4 rounded-2xl border border-[#E2E8F0] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <div>
                  <h2 id="order-action-heading" className="font-semibold text-[#0F172A]">Aksi pesanan</h2>
                  <p className="mt-1 text-sm leading-5 text-[#64748B]">Pastikan produk, tujuan, dan nominal benar sebelum diproses.</p>
                </div>
                <Button onClick={() => { setDeliveryError(''); setDeliveryNotice(''); setConfirmOpen(true); }}
                  disabled={delivery.isPending} data-testid="button-deliver-digital"
                  className="min-h-11 w-full shrink-0 rounded-xl border-[#F97316] bg-[#F97316] px-5 font-semibold text-[#0F172A] hover:bg-[#EA580C] sm:w-auto">
                  <Send aria-hidden="true" className="size-4" /> {delivery.isPending ? 'Mengirim…' : 'Proses / Kirim Digital'}
                </Button>
              </section>
            )}

            <AlertDialog open={confirmOpen} onOpenChange={open => {
              if (!delivery.isPending) {
                setConfirmOpen(open);
                if (open) setDeliveryError('');
              }
            }}>
              <AlertDialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] gap-5 overflow-y-auto rounded-2xl border-[#E2E8F0] bg-white p-4 sm:p-6">
                <AlertDialogHeader className="text-left">
                  <AlertDialogTitle className="text-[#0F172A]">Konfirmasi Pesanan</AlertDialogTitle>
                  <AlertDialogDescription className="leading-5 text-[#64748B]">
                    Pastikan data tujuan sudah benar. Periksa juga produk dan nominal sebelum mengirim seluruh item ke Lazada; tindakan ini tidak dapat dibatalkan.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <section aria-label="Ringkasan data yang akan dikirim" className="space-y-3">
                  <p className="break-all font-mono text-xs font-semibold text-[#64748B]">Pesanan #{o.marketplaceOrderId}</p>
                  {items.map((i) => (
                    <article key={`confirm-${i.id}`} className="min-w-0 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3.5">
                      <h3 className="break-words text-sm font-semibold leading-5 text-[#0F172A]">{i.productName}</h3>
                      <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <dt className="text-xs font-medium text-[#64748B]">Tujuan</dt>
                          <dd className="mt-1"><DigitalDetail id={`confirm-${i.id}`} value={i.digitalDetail} /></dd>
                        </div>
                        <div>
                          <dt className="text-xs font-medium text-[#64748B]">Nominal/variasi</dt>
                          <dd className="mt-1 break-words text-sm text-[#0F172A]">{i.variation?.trim() || 'Tidak tersedia'}</dd>
                          <dt className="mt-3 text-xs font-medium text-[#64748B]">Harga dibayar</dt>
                          <dd className="mt-1 break-all font-mono text-sm text-[#0F172A]">{orderMoney(i.paidPrice, i.currency ?? o.currency)}</dd>
                        </div>
                      </dl>
                    </article>
                  ))}
                </section>
                {deliveryError && <p role="alert" data-testid="error-deliver-digital-confirm" className="text-sm text-[#DC2626]">{deliveryError}</p>}
                <AlertDialogFooter className="gap-2 sm:gap-2">
                  <AlertDialogCancel disabled={delivery.isPending} data-testid="button-cancel-deliver-digital" className="min-h-11 rounded-xl border-[#E2E8F0]">
                    Batal
                  </AlertDialogCancel>
                  <AlertDialogAction onClick={event => { event.preventDefault(); submitDelivery(); }}
                    disabled={delivery.isPending} data-testid="button-confirm-deliver-digital"
                    className="min-h-11 rounded-xl border-[#F97316] bg-[#F97316] font-semibold text-[#0F172A] hover:bg-[#EA580C]">
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

import { Link, useParams, useSearch } from 'wouter';
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Send } from 'lucide-react';
import { ApiError, useDeliverDigitalOrder, useGetOrder, getGetOrderQueryKey } from '@workspace/api-client-react';
import { usePageMeta } from '@/hooks/use-page-meta';
import { rupiah, tanggal, providerMoney } from '@/lib/format';
import { ErrorState, ListSkeleton } from '@/components/states';
import { DigitalDetail } from '@/components/copy-detail';
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
    ['ID pesanan', o.marketplaceOrderId],
    ['ID Lazada', o.lazadaOrderId || 'Tidak tersedia'],
    ['Pembeli', o.buyerName ?? 'Tidak tersedia'],
    ['Jumlah', o.syncedAt ? providerMoney(o.sourcePrice, o.currency) : rupiah(o.amount)],
    ['Waktu order', o.sourceCreatedAt ?? tanggal(o.createdAt)],
    ['Diperbarui', o.sourceUpdatedAt ?? tanggal(o.updatedAt)],
    ...(o.syncedAt ? [['Terakhir dibaca', tanggal(o.syncedAt)]] : []),
  ];
  return (
    <>
      <div className="mb-4 md:mb-6">
        <Link href={`/orders${from ? `?${from}` : ''}`} data-testid="link-back" className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="size-4" /> Kembali
        </Link>
      </div>

      {q.isLoading && <ListSkeleton rows={3} />}
      {q.isError && <ErrorState text="Pesanan tidak ditemukan atau server tidak merespons." onRetry={() => q.refetch()} />}
      {o && rows && (
        <>
          <div className="mb-4 md:mb-6 overflow-hidden rounded-xl border bg-card">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 bg-primary px-4 py-3 md:py-4 text-primary-foreground">
              <div className="min-w-0">
                <p className="text-xs md:text-sm opacity-90">Status pesanan</p>
                <p className="text-sm md:text-base font-semibold mt-0.5 break-all">#{o.marketplaceOrderId}</p>
              </div>
              <div className="shrink-0">
                <ProviderStatus status={o.status} source={o.lazadaStatuses} />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-1 divide-y md:divide-y-0 md:divide-x">
              {rows.slice(0, 4).map(([k, v]) => (
                <div key={k} className="px-4 py-3 md:py-3">
                  <dt className="text-xs text-muted-foreground font-medium">{k}</dt>
                  <dd data-testid={`text-${k}`} className="mt-1 break-all font-mono text-sm">{v}</dd>
                </div>
              ))}
            </div>
          </div>

          <div className="mb-4 md:mb-6 overflow-hidden rounded-xl border bg-card">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-1 divide-y md:divide-y-0 md:divide-x">
              {rows.slice(4).map(([k, v]) => (
                <div key={k} className="px-4 py-3">
                  <dt className="text-xs text-muted-foreground font-medium">{k}</dt>
                  <dd data-testid={`text-${k}`} className="mt-1 break-all font-mono text-sm">{v}</dd>
                </div>
              ))}
            </div>
          </div>

          {o.syncedAt && o.status === 'pending' && items.length > 0 && (
            <div className="mb-4 md:mb-6">
              <Button onClick={() => { setDeliveryError(''); setDeliveryNotice(''); setConfirmOpen(true); }}
                disabled={delivery.isPending} data-testid="button-deliver-digital"
                className="w-full md:w-auto min-h-11">
                <Send className="mr-2 size-4" /> {delivery.isPending ? 'Mengirim…' : 'Proses / Kirim Digital'}
              </Button>
            </div>
          )}

          {deliveryNotice && <p role="status" data-testid="status-delivery-success" className="mb-4 p-3 rounded-lg text-sm text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950">{deliveryNotice}</p>}
          {deliveryError && !confirmOpen && <p role="alert" data-testid="error-deliver-digital" className="mb-4 p-3 rounded-lg text-sm text-destructive bg-destructive/5">{deliveryError}</p>}

          <div className="mb-6">
            <h2 className="text-lg md:text-xl font-semibold mb-4">Item pesanan ({items.length})</h2>
            {items.length === 0 ? (
              <div data-testid="state-no-items" className="rounded-xl border border-dashed border-input bg-card px-4 py-6 text-center">
                <p className="break-words font-semibold text-sm md:text-base">{o.productName || 'Produk belum tersedia'}</p>
                <p className="mt-2 text-xs md:text-sm text-muted-foreground">Item dan Digital Detail belum tersedia untuk pesanan ini.</p>
              </div>
            ) : (
              <ul className="space-y-3 md:space-y-4">
                {items.map((i) => (
                  <li key={i.id} data-testid={`item-${i.id}`} className="rounded-xl border bg-card overflow-hidden">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 px-4 py-3 md:py-4 border-b bg-muted/30">
                      <div className="min-w-0 flex-1">
                        <p className="min-w-0 break-words font-semibold text-sm md:text-base line-clamp-2">{i.productName}</p>
                        <p className="mt-1 break-all font-mono text-xs text-muted-foreground">Item {i.lazadaOrderItemId}</p>
                      </div>
                      <div className="shrink-0">
                        <ProviderStatus status={i.status} source={i.sourceStatus} />
                      </div>
                    </div>

                    <div className="px-4 py-2 text-xs text-muted-foreground border-b">
                      Dibuat {i.sourceCreatedAt ?? tanggal(i.createdAt)} · Diperbarui {i.sourceUpdatedAt ?? tanggal(i.updatedAt)}
                    </div>

                    {o.syncedAt && (
                      <div className="px-4 py-3 border-b">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4 text-sm">
                          {[
                            ['Nominal/variasi', i.variation || 'Tidak tersedia'],
                            ['Harga item', providerMoney(i.itemPrice, i.currency)],
                            ['Harga dibayar', providerMoney(i.paidPrice, i.currency)],
                            ['SKU', i.sku || 'Tidak tersedia'],
                            ['Shop SKU', i.shopSku || 'Tidak tersedia'],
                          ].map(([key, value]) => (
                            <div key={key}>
                              <dt className="text-xs text-muted-foreground font-medium">{key}</dt>
                              <dd className="mt-1 break-all font-mono text-sm">{value}</dd>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="px-4 py-4">
                      <p className="text-xs font-medium text-muted-foreground mb-3">DIGITAL DETAIL</p>
                      {o.syncedAt && (
                        <p className="text-xs text-muted-foreground mb-3">
                          {i.digitalDetailSource ? 'Sumber: digital_delivery_info dari Lazada' : 'Field digital_delivery_info tidak tersedia di response API'}
                        </p>
                      )}
                      <DigitalDetail id={i.id} value={i.digitalDetail} />
                    </div>

                    {o.syncedAt && (
                      <details className="border-t">
                        <summary className="cursor-pointer px-4 py-3 text-xs font-medium text-muted-foreground hover:bg-muted/50 transition-colors">extra_attributes — Response asli</summary>
                        <pre className="px-4 py-3 max-h-60 overflow-auto whitespace-pre-wrap break-all text-xs bg-muted/30 font-mono text-muted-foreground">{i.extraAttributes ?? 'Field tidak tersedia atau bernilai null.'}</pre>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <AlertDialog open={confirmOpen} onOpenChange={open => {
            if (!delivery.isPending) {
              setConfirmOpen(open);
              if (open) setDeliveryError('');
            }
          }}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Kirim item digital ke Lazada?</AlertDialogTitle>
                <AlertDialogDescription>
                  Lazada akan menandai seluruh item digital pada pesanan ini sebagai terkirim. Tindakan ini memanggil DeliverDigital dan tidak dapat dibatalkan.
                </AlertDialogDescription>
              </AlertDialogHeader>
              {deliveryError && <p role="alert" data-testid="error-deliver-digital-confirm" className="text-sm text-destructive">{deliveryError}</p>}
              <AlertDialogFooter>
                <AlertDialogCancel disabled={delivery.isPending} data-testid="button-cancel-deliver-digital">Batal</AlertDialogCancel>
                <AlertDialogAction onClick={event => { event.preventDefault(); submitDelivery(); }}
                  disabled={delivery.isPending} data-testid="button-confirm-deliver-digital" className="min-h-11">
                  {delivery.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
                  {delivery.isPending ? 'Mengirim…' : 'Konfirmasi kirim'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </>
  );
}

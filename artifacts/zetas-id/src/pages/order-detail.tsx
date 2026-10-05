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
      <Link href={`/orders${from ? `?${from}` : ''}`} data-testid="link-back" className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Kembali ke pesanan
      </Link>
      <h1 className="mb-5 text-2xl font-bold tracking-tight">Detail pesanan</h1>
      {q.isLoading && <ListSkeleton rows={3} />}
      {q.isError && <ErrorState text="Pesanan tidak ditemukan atau server tidak merespons." onRetry={() => q.refetch()} />}
      {o && rows && (
        <>
          <div className="overflow-hidden rounded-xl border bg-card">
            <div className="flex items-center justify-between bg-primary px-4 py-3 text-primary-foreground">
              <span className="text-sm">Status</span>
              <ProviderStatus status={o.status} source={o.lazadaStatuses} />
            </div>
            <dl className="divide-y">
              {rows.map(([k, v]) => (
                <div key={k} className="px-4 py-3">
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd data-testid={`text-${k}`} className="mt-0.5 break-all font-mono text-sm">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          {o.syncedAt && o.status === 'pending' && items.length > 0 && (
            <div className="mt-4">
              <Button onClick={() => { setDeliveryError(''); setDeliveryNotice(''); setConfirmOpen(true); }}
                disabled={delivery.isPending} data-testid="button-deliver-digital">
                <Send className="mr-2 size-4" /> Proses / Kirim Digital
              </Button>
            </div>
          )}
          {deliveryNotice && <p role="status" data-testid="status-delivery-success" className="mt-3 text-sm text-emerald-700 dark:text-emerald-400">{deliveryNotice}</p>}
          {deliveryError && !confirmOpen && <p role="alert" data-testid="error-deliver-digital" className="mt-3 text-sm text-destructive">{deliveryError}</p>}
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
                  disabled={delivery.isPending} data-testid="button-confirm-deliver-digital">
                  {delivery.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
                  {delivery.isPending ? 'Mengirim…' : 'Konfirmasi kirim'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <h2 className="mb-3 mt-6 font-semibold">Item pesanan ({items.length})</h2>
          {items.length === 0 ? (
            <div data-testid="state-no-items" className="rounded-xl border border-dashed border-input bg-card p-4">
              <p className="break-words font-semibold">{o.productName || 'Produk belum tersedia'}</p>
              <p className="mt-1 text-sm text-muted-foreground">Item dan Digital Detail belum tersedia untuk pesanan ini.</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {items.map((i) => (
                <li key={i.id} data-testid={`item-${i.id}`} className="rounded-xl border bg-card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 break-words font-semibold">{i.productName}</p>
                    <ProviderStatus status={i.status} source={i.sourceStatus} />
                  </div>
                  <p className="mt-1 break-all font-mono text-xs text-muted-foreground">Item {i.lazadaOrderItemId}</p>
                  <p className="mb-3 text-xs text-muted-foreground">Dibuat {i.sourceCreatedAt ?? tanggal(i.createdAt)} · Diperbarui {i.sourceUpdatedAt ?? tanggal(i.updatedAt)}</p>
                  {o.syncedAt && <dl className="mb-3 grid gap-2 text-sm">
                    {[
                      ['Nominal/variasi (variation)', i.variation || 'Tidak tersedia'],
                      ['Harga item (item_price)', providerMoney(i.itemPrice, i.currency)],
                      ['Harga dibayar (paid_price)', providerMoney(i.paidPrice, i.currency)],
                      ['SKU (sku)', i.sku || 'Tidak tersedia'],
                      ['Shop SKU (shop_sku)', i.shopSku || 'Tidak tersedia'],
                    ].map(([key, value]) => <div key={key}><dt className="text-xs text-muted-foreground">{key}</dt><dd className="break-all">{value}</dd></div>)}
                  </dl>}
                  <p className="mb-1 text-xs font-medium">Digital Detail</p>
                  {o.syncedAt && <p className="mb-2 text-xs text-muted-foreground">
                    {i.digitalDetailSource ? 'Sumber: digital_delivery_info, ditampilkan sesuai response API.' : 'Field digital_delivery_info tidak tersedia di response API.'}
                  </p>}
                  <DigitalDetail id={i.id} value={i.digitalDetail} />
                  {o.syncedAt && <details className="mt-3 text-xs"><summary className="cursor-pointer">extra_attributes — response asli, bukan asumsi Digital Detail</summary>
                    <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3">{i.extraAttributes ?? 'Field tidak tersedia atau bernilai null.'}</pre>
                  </details>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}

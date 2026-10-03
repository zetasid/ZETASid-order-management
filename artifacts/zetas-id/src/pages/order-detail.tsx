import { Link, useParams, useSearch } from 'wouter';
import { ArrowLeft } from 'lucide-react';
import { useGetOrder, getGetOrderQueryKey } from '@workspace/api-client-react';
import { usePageMeta } from '@/hooks/use-page-meta';
import { rupiah, tanggal } from '@/lib/format';
import { ErrorState, ListSkeleton, StatusBadge } from '@/components/states';
import { DigitalDetail } from '@/components/copy-detail';

export default function OrderDetail() {
  usePageMeta('Detail Pesanan', 'Item dan Digital Detail satu pesanan.');
  const { orderId = '' } = useParams<{ orderId: string }>();
  const from = new URLSearchParams(useSearch()).get('from') ?? '';
  const q = useGetOrder(orderId, {
    query: { enabled: !!orderId, queryKey: getGetOrderQueryKey(orderId), staleTime: 15000, refetchOnWindowFocus: true, refetchOnMount: true },
  });
  const o = q.data;
  const items = o?.items ?? [];
  const rows = o && [
    ['ID pesanan', o.marketplaceOrderId],
    ['ID Lazada', o.lazadaOrderId || 'Tidak tersedia'],
    ['Pembeli', o.buyerName ?? 'Tidak tersedia'],
    ['Jumlah', rupiah(o.amount)],
    ['Dibuat', tanggal(o.createdAt)],
    ['Diperbarui', tanggal(o.updatedAt)],
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
              <span className="rounded-full bg-background"><StatusBadge status={o.status} /></span>
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
                    <StatusBadge status={i.status} />
                  </div>
                  <p className="mt-1 break-all font-mono text-xs text-muted-foreground">Item {i.lazadaOrderItemId}</p>
                  <p className="mb-3 text-xs text-muted-foreground">Dibuat {tanggal(i.createdAt)} · Diperbarui {tanggal(i.updatedAt)}</p>
                  <p className="mb-1 text-xs font-medium">Digital Detail</p>
                  <DigitalDetail id={i.id} value={i.digitalDetail} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}

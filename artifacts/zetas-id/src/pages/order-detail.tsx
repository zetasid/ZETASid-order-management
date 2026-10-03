import { Link, useParams } from 'wouter';
import { ArrowLeft } from 'lucide-react';
import { useGetOrder, getGetOrderQueryKey } from '@workspace/api-client-react';
import { usePageMeta } from '@/hooks/use-page-meta';
import { rupiah, tanggal } from '@/lib/format';
import { ErrorState, ListSkeleton, StatusBadge } from '@/components/states';

export default function OrderDetail() {
  usePageMeta('Detail Pesanan', 'Rincian satu pesanan digital Lazada.');
  const { orderId = '' } = useParams<{ orderId: string }>();
  const q = useGetOrder(orderId, { query: { enabled: !!orderId, queryKey: getGetOrderQueryKey(orderId) } });
  const o = q.data;
  const rows = o && [
    ['ID pesanan Lazada', o.marketplaceOrderId, true],
    ['Produk', o.productName, false],
    ['Pembeli', o.buyerName ?? 'Tidak tersedia', false],
    ['Jumlah', rupiah(o.amount), true],
    ['Dibuat', tanggal(o.createdAt), false],
    ['ID internal', o.id, true],
  ] as const;
  return (
    <>
      <Link href="/orders" data-testid="link-back" className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Kembali ke pesanan
      </Link>
      <h1 className="mb-5 text-2xl font-bold tracking-tight">Detail pesanan</h1>
      {q.isLoading && <ListSkeleton rows={3} />}
      {q.isError && <ErrorState text="Pesanan tidak ditemukan atau server tidak merespons." onRetry={() => q.refetch()} />}
      {o && rows && (
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="flex items-center justify-between bg-primary px-4 py-3 text-primary-foreground">
            <span className="text-sm">Status</span>
            <span className="rounded-full bg-background"><StatusBadge status={o.status} /></span>
          </div>
          <dl className="divide-y">
            {rows.map(([k, v, mono]) => (
              <div key={k} className="px-4 py-3">
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd data-testid={`text-${k}`} className={`mt-0.5 break-words ${mono ? 'font-mono text-sm' : ''}`}>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </>
  );
}

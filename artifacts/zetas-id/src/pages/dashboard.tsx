import { Link } from 'wouter';
import { useGetDashboardSummary, getGetDashboardSummaryQueryKey } from '@workspace/api-client-react';
import { usePageMeta } from '@/hooks/use-page-meta';
import { rupiah } from '@/lib/format';
import { EmptyState, ErrorState, ListSkeleton, PageHeading } from '@/components/states';
import { OrderRow } from '@/components/order-row';
import { Skeleton } from '@/components/ui/skeleton';

export default function Dashboard() {
  usePageMeta('Ringkasan', 'Ringkasan pesanan digital Lazada Anda di ZETAS.id.');
  const q = useGetDashboardSummary({ query: { queryKey: getGetDashboardSummaryQueryKey() } });
  const d = q.data;
  const stats = d && [
    { k: 'total', l: 'Total pesanan', v: String(d.totalOrders) },
    { k: 'pending', l: 'Menunggu', v: String(d.pendingOrders) },
    { k: 'completed', l: 'Selesai', v: String(d.completedOrders) },
    { k: 'cancelled', l: 'Dibatalkan', v: String(d.cancelledOrders) },
  ];
  return (
    <>
      <PageHeading title="Ringkasan" sub="Pantau pesanan digital Lazada dari ponsel Anda." />
      {q.isLoading && (
        <div data-testid="state-loading" className="grid grid-cols-2 gap-3">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      )}
      {q.isError && <ErrorState text="Ringkasan belum bisa diambil dari server." onRetry={() => q.refetch()} />}
      {d && stats && (
        <>
          <div className="mb-3 rounded-xl bg-primary p-5 text-primary-foreground">
            <p className="text-sm text-primary-foreground/70">Total pendapatan</p>
            <p data-testid="text-revenue" className="mt-1 font-mono text-3xl font-medium">{rupiah(d.totalRevenue)}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {stats.map((s) => (
              <div key={s.k} className="rounded-xl border bg-card p-4">
                <p className="text-xs text-muted-foreground">{s.l}</p>
                <p data-testid={`text-stat-${s.k}`} className="mt-2 font-mono text-2xl font-medium">{s.v}</p>
              </div>
            ))}
          </div>
          <div className="mb-3 mt-8 flex items-baseline justify-between">
            <h2 className="font-semibold">Pesanan terbaru</h2>
            <Link href="/orders" data-testid="link-all-orders" className="text-sm underline underline-offset-4">Lihat semua</Link>
          </div>
          {d.recentOrders.length === 0 ? (
            <EmptyState title="Belum ada pesanan" text="Pesanan akan tampil di sini setelah data pesanan tersedia. Saat ini belum ada yang tercatat." />
          ) : (
            <div className="space-y-3">{d.recentOrders.map((o) => <OrderRow key={o.id} order={o} />)}</div>
          )}
        </>
      )}
      {!q.isLoading && !q.isError && !d && <ListSkeleton />}
    </>
  );
}

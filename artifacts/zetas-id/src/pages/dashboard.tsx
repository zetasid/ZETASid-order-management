import { useLayoutEffect, useState } from 'react';
import { Link } from 'wouter';
import { AlertTriangle, BadgeCheck, CircleX, Clock3, Inbox, PackageOpen, RefreshCw, Wallet } from 'lucide-react';
import { useGetDashboardSummary, getGetDashboardSummaryQueryKey } from '@workspace/api-client-react';
import { usePageMeta } from '@/hooks/use-page-meta';
import { rupiah } from '@/lib/format';
import { OrderRow } from '@/components/order-row';
import { Skeleton } from '@/components/ui/skeleton';

function DashboardLoading() {
  return (
    <div data-testid="state-loading" aria-busy="true" className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="skeleton-shimmer h-28 rounded-2xl bg-[#E2E8F0]" />
        ))}
      </div>
      <Skeleton className="skeleton-shimmer h-32 rounded-2xl bg-[#E2E8F0]" />
      <div className="space-y-3">
        <Skeleton className="skeleton-shimmer h-16 rounded-2xl bg-[#E2E8F0]" />
        <Skeleton className="skeleton-shimmer h-16 rounded-2xl bg-[#E2E8F0]" />
      </div>
    </div>
  );
}

function AnimatedCount({ value }: { value: number }) {
  const [count, setCount] = useState(value);

  useLayoutEffect(() => {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (reduceMotion) {
      setCount(value);
      return;
    }

    const duration = 620;
    const startedAt = performance.now();
    let frame = 0;
    setCount(0);
    const update = (now: number) => {
      const progress = Math.min((now - startedAt) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.round(value * eased));
      if (progress < 1) frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return <>{count}</>;
}

function DashboardError({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div role="alert" data-testid="state-error" className="flex flex-col gap-4 rounded-2xl border border-[#FECACA] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:flex-row sm:items-center sm:justify-between sm:p-5">
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#FEF2F2] text-[#DC2626]">
          <AlertTriangle aria-hidden="true" className="size-5" />
        </span>
        <div>
          <p className="font-semibold text-[#0F172A]">Gagal memuat ringkasan</p>
          <p className="mt-1 text-sm leading-5 text-[#64748B]">{text}</p>
        </div>
      </div>
      <button type="button" onClick={onRetry} data-testid="button-retry"
        className="min-h-11 shrink-0 rounded-[10px] bg-[#2563EB] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#1D4ED8] active:bg-[#1E40AF]">
        Coba lagi
      </button>
    </div>
  );
}

function DashboardEmpty() {
  return (
    <div data-testid="state-empty" className="rounded-2xl border border-dashed border-[#CBD5E1] bg-white px-5 py-8 text-center sm:py-10">
      <span className="mx-auto mb-3 grid size-11 place-items-center rounded-full bg-[#EFF6FF] text-[#2563EB]">
        <Inbox aria-hidden="true" className="size-5" />
      </span>
      <p className="font-semibold text-[#0F172A]">Belum ada pesanan</p>
      <p className="mx-auto mt-1 max-w-sm text-sm leading-5 text-[#64748B]">
        Pesanan akan tampil di sini setelah data pesanan tersedia. Saat ini belum ada yang tercatat.
      </p>
    </div>
  );
}

export default function Dashboard() {
  usePageMeta('Dashboard', 'Ringkasan pesanan digital Lazada Anda di ZETAS.id.');
  const q = useGetDashboardSummary({ query: { queryKey: getGetDashboardSummaryQueryKey(), staleTime: 15000, refetchOnWindowFocus: true, refetchOnMount: true } });
  const d = q.data;
  const stats = d && [
    { k: 'total', l: 'Total pesanan', v: d.totalOrders, icon: PackageOpen, tone: 'bg-[#EFF6FF] text-[#2563EB]' },
    { k: 'pending', l: 'Belum Dibayar', v: d.pendingOrders, icon: Clock3, tone: 'bg-[#FFF7ED] text-[#F97316]' },
    { k: 'processing', l: 'Diproses', v: d.processingOrders, icon: RefreshCw, tone: 'bg-[#EFF6FF] text-[#1E293B]' },
    { k: 'completed', l: 'Selesai', v: d.completedOrders, icon: BadgeCheck, tone: 'bg-[#F0FDF4] text-[#16A34A]' },
    { k: 'cancelled', l: 'Dibatalkan', v: d.cancelledOrders, icon: CircleX, tone: 'bg-[#FEF2F2] text-[#DC2626]' },
  ];

  return (
    <div className="page-enter space-y-7">
      <div className="space-y-7">
        <header className="space-y-1.5">
          <p className="text-[11px] font-bold uppercase tracking-[.17em] text-[#E96B27]">Ruang kendali</p>
          <h1 className="text-[27px] font-bold tracking-[-.035em] text-[#14213A] sm:text-[32px]">Ringkasan</h1>
          <p className="text-sm leading-6 text-[#687587]">Pantau pesanan digital Lazada hari ini.</p>
        </header>

        {q.isLoading && <DashboardLoading />}
        {q.isError && <DashboardError text="Ringkasan belum bisa diambil dari server." onRetry={() => { void q.refetch(); }} />}

        {d && stats && (
          <>
            <section aria-label="Statistik pesanan" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {stats.map((s, index) => {
                const Icon = s.icon;
                return (
              <Link key={s.k} href={s.k === 'total' ? '/orders' : `/orders?status=${s.k}`} data-testid={`card-stat-${s.k}`}
                    className="surface-card stagger-in block min-h-[122px] rounded-2xl p-4 no-underline" style={{ animationDelay: `${index * 45}ms` }}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[13px] leading-5 text-[#687587]">{s.l}</p>
                      <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${s.tone}`}>
                        <Icon aria-hidden="true" className="size-[18px]" />
                      </span>
                    </div>
                    <p data-testid={`text-stat-${s.k}`} className="mt-4 font-mono text-[26px] font-semibold leading-none tracking-tight text-[#14213A] sm:text-[28px]">
                      <AnimatedCount value={s.v} />
                    </p>
              </Link>
                );
              })}
            </section>

            <section aria-label="Total pendapatan" className="surface-card rounded-2xl p-5 sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                   <p className="text-sm font-medium text-[#687587]">Total pendapatan</p>
                   <p data-testid="text-revenue" className="mt-2 break-words font-mono text-2xl font-semibold tracking-tight text-[#14213A] sm:text-3xl">
                    {rupiah(d.totalRevenue)}
                  </p>
                </div>
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#FFF1E8] text-[#E96B27]">
                  <Wallet aria-hidden="true" className="size-5" />
                </span>
              </div>
              <div aria-hidden="true" className="mt-4 h-1 w-12 rounded-full bg-[#F27832]" />
            </section>

            <section aria-labelledby="recent-orders-heading">
              <div className="mb-3 flex min-h-11 items-center justify-between gap-3">
                <div>
                  <h2 id="recent-orders-heading" className="text-lg font-semibold tracking-tight text-[#14213A]">Pesanan terbaru</h2>
                  <p className="mt-0.5 text-sm text-[#687587]">Aktivitas pesanan digital terkini.</p>
                </div>
                <Link href="/orders" data-testid="link-all-orders"
                  className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1 rounded-xl px-3 text-sm font-semibold text-[#E96B27] transition-colors hover:bg-[#FFF1E8] active:bg-[#FDE2D1]">
                  Lihat semua
                </Link>
              </div>
              {d.recentOrders.length === 0 ? (
                <DashboardEmpty />
              ) : (
                <div data-testid="list-recent-orders" className="space-y-3 [&>a]:rounded-2xl [&>a]:border-[#E2E8F0] [&>a]:bg-white [&>a]:shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                  {d.recentOrders.map((o) => <OrderRow key={o.id} order={o} />)}
                </div>
              )}
            </section>
          </>
        )}
        {!q.isLoading && !q.isError && !d && <DashboardLoading />}
      </div>
    </div>
  );
}

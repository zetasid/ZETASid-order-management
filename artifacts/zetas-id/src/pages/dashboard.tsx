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
          <Skeleton key={i} className="h-28 rounded-2xl bg-[#E2E8F0]" />
        ))}
      </div>
      <Skeleton className="h-32 rounded-2xl bg-[#E2E8F0]" />
      <div className="space-y-3">
        <Skeleton className="h-16 rounded-2xl bg-[#E2E8F0]" />
        <Skeleton className="h-16 rounded-2xl bg-[#E2E8F0]" />
      </div>
    </div>
  );
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
    { k: 'total', l: 'Total pesanan', v: String(d.totalOrders), icon: PackageOpen, tone: 'bg-[#EFF6FF] text-[#2563EB]' },
    { k: 'pending', l: 'Menunggu', v: String(d.pendingOrders), icon: Clock3, tone: 'bg-[#FFF7ED] text-[#F97316]' },
    { k: 'processing', l: 'Diproses', v: String(d.processingOrders), icon: RefreshCw, tone: 'bg-[#EFF6FF] text-[#1E293B]' },
    { k: 'completed', l: 'Selesai', v: String(d.completedOrders), icon: BadgeCheck, tone: 'bg-[#F0FDF4] text-[#16A34A]' },
    { k: 'cancelled', l: 'Dibatalkan', v: String(d.cancelledOrders), icon: CircleX, tone: 'bg-[#FEF2F2] text-[#DC2626]' },
  ];

  return (
    <div className="relative left-1/2 -my-6 w-screen -translate-x-1/2 bg-[#F8FAFC]">
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-5 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:px-6 sm:py-7 md:space-y-7 md:pb-8">
        <header className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#F97316]">Ringkasan pesanan</p>
          <h1 className="text-2xl font-bold tracking-tight text-[#0F172A] sm:text-3xl">Dashboard</h1>
          <p className="text-sm leading-5 text-[#64748B]">Pantau pesanan digital Lazada Anda.</p>
        </header>

        {q.isLoading && <DashboardLoading />}
        {q.isError && <DashboardError text="Ringkasan belum bisa diambil dari server." onRetry={() => { void q.refetch(); }} />}

        {d && stats && (
          <>
            <section aria-label="Statistik pesanan" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {stats.map((s) => {
                const Icon = s.icon;
                return (
                  <article key={s.k} data-testid={`card-stat-${s.k}`}
                    className="min-h-28 rounded-2xl border border-[#E2E8F0] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm leading-5 text-[#64748B]">{s.l}</p>
                      <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${s.tone}`}>
                        <Icon aria-hidden="true" className="size-[18px]" />
                      </span>
                    </div>
                    <p data-testid={`text-stat-${s.k}`} className="mt-3 font-mono text-2xl font-semibold leading-none tracking-tight text-[#0F172A] sm:text-[1.75rem]">
                      {s.v}
                    </p>
                  </article>
                );
              })}
            </section>

            <section aria-label="Total pendapatan" className="rounded-2xl border border-[#E2E8F0] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[#64748B]">Total pendapatan</p>
                  <p data-testid="text-revenue" className="mt-2 break-words font-mono text-2xl font-semibold tracking-tight text-[#0F172A] sm:text-3xl">
                    {rupiah(d.totalRevenue)}
                  </p>
                </div>
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#FFF7ED] text-[#F97316]">
                  <Wallet aria-hidden="true" className="size-5" />
                </span>
              </div>
              <div aria-hidden="true" className="mt-4 h-1 w-12 rounded-full bg-[#F97316]" />
            </section>

            <section aria-labelledby="recent-orders-heading">
              <div className="mb-3 flex min-h-11 items-center justify-between gap-3">
                <div>
                  <h2 id="recent-orders-heading" className="text-lg font-semibold tracking-tight text-[#0F172A]">Pesanan terbaru</h2>
                  <p className="mt-0.5 text-sm text-[#64748B]">Aktivitas pesanan digital terkini.</p>
                </div>
                <Link href="/orders" data-testid="link-all-orders"
                  className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1 rounded-[10px] px-3 text-sm font-semibold text-[#2563EB] transition-colors hover:bg-[#EFF6FF] active:bg-[#DBEAFE]">
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

import './_group.css';
import { BadgeCheck, CircleX, Clock3, PackageOpen, RefreshCw, Wallet } from 'lucide-react';
import { AppShell } from './_shared/AppShell';
import { OrderRow } from './_shared/OrderRow';
import { orders, summary } from './_shared/fixtures';
import { rupiah } from './_shared/format';

function DashboardPage() {
  const stats = [
    { k: 'total', l: 'Total pesanan', v: String(summary.totalOrders), icon: PackageOpen, tone: 'bg-[#EFF6FF] text-[#2563EB]' },
    { k: 'pending', l: 'Menunggu', v: String(summary.pendingOrders), icon: Clock3, tone: 'bg-[#FFF7ED] text-[#F97316]' },
    { k: 'processing', l: 'Diproses', v: String(summary.processingOrders), icon: RefreshCw, tone: 'bg-[#EFF6FF] text-[#1E293B]' },
    { k: 'completed', l: 'Selesai', v: String(summary.completedOrders), icon: BadgeCheck, tone: 'bg-[#F0FDF4] text-[#16A34A]' },
    { k: 'cancelled', l: 'Dibatalkan', v: String(summary.cancelledOrders), icon: CircleX, tone: 'bg-[#FEF2F2] text-[#DC2626]' },
  ];
  return (
    <div className="relative left-1/2 -my-6 w-screen -translate-x-1/2 bg-[#F8FAFC]">
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-5 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:px-6 sm:py-7 md:space-y-7 md:pb-8">
        <header className="space-y-1"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#F97316]">Ringkasan pesanan</p><h1 className="text-2xl font-bold tracking-tight text-[#0F172A] sm:text-3xl">Dashboard</h1><p className="text-sm leading-5 text-[#64748B]">Pantau pesanan digital Lazada Anda.</p></header>
        <section aria-label="Statistik pesanan" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {stats.map(s => { const Icon = s.icon; return <article key={s.k} data-testid={`card-stat-${s.k}`} className="min-h-28 rounded-2xl border border-[#E2E8F0] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"><div className="flex items-start justify-between gap-2"><p className="text-sm leading-5 text-[#64748B]">{s.l}</p><span className={`grid size-9 shrink-0 place-items-center rounded-xl ${s.tone}`}><Icon aria-hidden="true" className="size-[18px]" /></span></div><p data-testid={`text-stat-${s.k}`} className="mt-3 font-mono text-2xl font-semibold leading-none tracking-tight text-[#0F172A] sm:text-[1.75rem]">{s.v}</p></article>; })}
        </section>
        <section aria-label="Total pendapatan" className="rounded-2xl border border-[#E2E8F0] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-6"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><p className="text-sm font-medium text-[#64748B]">Total pendapatan</p><p data-testid="text-revenue" className="mt-2 break-words font-mono text-2xl font-semibold tracking-tight text-[#0F172A] sm:text-3xl">{rupiah(summary.totalRevenue)}</p></div><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#FFF7ED] text-[#F97316]"><Wallet aria-hidden="true" className="size-5" /></span></div><div aria-hidden="true" className="mt-4 h-1 w-12 rounded-full bg-[#F97316]" /></section>
        <section aria-labelledby="recent-orders-heading"><div className="mb-3 flex min-h-11 items-center justify-between gap-3"><div><h2 id="recent-orders-heading" className="text-lg font-semibold tracking-tight text-[#0F172A]">Pesanan terbaru</h2><p className="mt-0.5 text-sm text-[#64748B]">Aktivitas pesanan digital terkini.</p></div><a href="/orders" data-testid="link-all-orders" className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1 rounded-[10px] px-3 text-sm font-semibold text-[#2563EB] transition-colors hover:bg-[#EFF6FF] active:bg-[#DBEAFE]">Lihat semua</a></div>
          <div data-testid="list-recent-orders" className="space-y-3 [&>a]:rounded-2xl [&>a]:border-[#E2E8F0] [&>a]:bg-white [&>a]:shadow-[0_1px_2px_rgba(15,23,42,0.04)]">{summary.recentOrders.map(o => <OrderRow key={o.id} order={o} />)}</div>
        </section>
      </div>
    </div>
  );
}

export default function Dashboard() {
  return <AppShell route="/dashboard"><DashboardPage /></AppShell>;
}

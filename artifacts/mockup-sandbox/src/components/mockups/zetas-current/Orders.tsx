import './_group.css';
import { useMemo, useState } from 'react';
import { ArrowDownUp, ChevronRight, RotateCw, Search, X } from 'lucide-react';
import { AppShell } from './_shared/AppShell';
import { OrderRow } from './_shared/OrderRow';
import { orders } from './_shared/fixtures';

const FILTERS = [['', 'Semua'], ['pending', 'Menunggu'], ['processing', 'Diproses'], ['completed', 'Selesai'], ['cancelled', 'Dibatalkan']] as const;

function OrdersPage() {
  const [text, setText] = useState('');
  const [status, setStatus] = useState('');
  const [newestFirst, setNewestFirst] = useState(true);
  const filteredOrders = useMemo(() => orders.filter(o => {
    const matchesStatus = !status || o.status === status;
    const query = text.trim().toLowerCase();
    const matchesText = !query || `${o.marketplaceOrderId} ${o.productName}`.toLowerCase().includes(query);
    return matchesStatus && matchesText;
  }).sort((a, b) => {
    const delta = Date.parse(b.sourceCreatedAt ?? b.createdAt) - Date.parse(a.sourceCreatedAt ?? a.createdAt);
    return newestFirst ? delta : -delta;
  }), [status, text, newestFirst]);
  return (
    <div className="min-h-screen">
      <div className="mb-5"><h1 className="text-xl md:text-2xl font-bold tracking-tight">Pesanan</h1><p className="text-xs md:text-sm text-muted-foreground mt-1">Kelola pesanan digital Lazada.</p></div>
      <section className="mb-4 overflow-hidden rounded-xl border border-[#E2E8F0] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]" aria-labelledby="sync-heading">
        <details className="group">
          <summary className="flex min-h-14 list-none cursor-pointer items-center gap-3 px-3 py-2 [&::-webkit-details-marker]:hidden sm:px-4">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#FFF3E8] text-[#F97316]"><RotateCw aria-hidden="true" className="size-4" /></span>
            <div className="min-w-0 flex-1"><h2 id="sync-heading" className="text-sm font-semibold text-[#0F172A]">Sinkronkan Pesanan</h2><p className="mt-0.5 truncate text-[11px] text-[#64748B]">Terakhir: 02 Okt 2026, 14:30 WIB</p></div>
            <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-[#64748B] transition-transform group-open:rotate-90" />
          </summary>
          <div className="border-t border-[#E2E8F0] px-4 py-4 sm:px-5"><p className="text-xs leading-5 text-[#64748B]">Maksimum 20 pesanan per halaman beserta itemnya. Pembacaan ini tidak mengirim produk digital.</p><div className="my-4 grid grid-cols-2 gap-3"><label className="min-w-0 text-xs font-medium text-[#475569]">Dari tanggal (WIB)<input type="date" defaultValue="2026-07-04" className="mt-1 min-h-11 w-full rounded-lg border border-[#E2E8F0] bg-white px-2 text-sm text-[#0F172A]" /></label><label className="min-w-0 text-xs font-medium text-[#475569]">Sampai tanggal (WIB)<input type="date" defaultValue="2026-10-02" className="mt-1 min-h-11 w-full rounded-lg border border-[#E2E8F0] bg-white px-2 text-sm text-[#0F172A]" /></label></div><button type="button" className="min-h-11 rounded-xl border border-[#F97316] bg-[#F97316] px-4 font-semibold text-[#0F172A]"><span className="inline-flex items-center gap-2"><RotateCw className="size-4" />Baca pesanan</span></button><p className="mt-3 text-sm text-[#64748B]">Hubungkan akun Lazada terlebih dahulu. <a href="/settings" className="font-medium text-[#2563EB] underline underline-offset-2">Buka Pengaturan</a></p></div>
        </details>
      </section>
      <div className="sticky top-14 md:top-0 z-20 bg-page mb-4 pb-4 -mx-4 md:mx-0 px-4 md:px-0 md:mb-3 md:pb-0">
        <div className="relative mb-3 md:mb-0"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><input type="search" value={text} maxLength={200} onChange={e => setText(e.target.value)} data-testid="input-search" aria-label="Cari ID pesanan atau nama produk" placeholder="Cari ID pesanan atau produk" className="min-h-11 w-full rounded-lg border border-input bg-card pl-9 pr-11 text-base" />{text && <button type="button" aria-label="Hapus pencarian" data-testid="button-clear-search" onClick={() => setText('')} className="absolute right-0 top-0 grid size-11 place-items-center text-muted-foreground hover:text-foreground transition-colors"><X className="size-4" /></button>}</div>
        <div className="md:hidden w-[calc(100%+32px)] -mx-4 overflow-x-auto"><div className="flex gap-2 px-4 pb-2" role="group" aria-label="Filter status">{FILTERS.map(([v, label]) => <button key={label} type="button" aria-pressed={status === v} data-testid={`filter-${v || 'all'}`} onClick={() => setStatus(v)} className={`min-h-10 rounded-full border px-3 text-xs font-medium whitespace-nowrap transition-colors ${status === v ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:border-primary/50'}`}>{label}</button>)}</div></div>
        <div className="hidden md:flex flex-wrap gap-2" role="group" aria-label="Filter status">{FILTERS.map(([v, label]) => <button key={label} type="button" aria-pressed={status === v} data-testid={`filter-${v || 'all'}`} onClick={() => setStatus(v)} className={`min-h-11 rounded-full border px-4 text-sm font-medium transition-colors ${status === v ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:border-primary/50'}`}>{label}</button>)}</div>
      </div>
      {filteredOrders.length === 0 ? <div data-testid="state-empty" className="rounded-xl border border-dashed border-input bg-card px-4 md:px-6 py-6 md:py-10 text-center"><p className="text-sm md:text-base font-semibold">Tidak ada hasil</p><p className="mx-auto mt-1 max-w-xs text-xs md:text-sm text-muted-foreground">Tidak ada pesanan yang cocok dengan pencarian atau filter ini.</p><button type="button" data-testid="button-reset" onClick={() => { setText(''); setStatus(''); }} className="mt-4 min-h-11 rounded-lg border px-4 text-sm transition-colors hover:bg-card">Hapus pencarian dan filter</button></div> : <>
        <div className="mb-2 flex min-h-11 items-center justify-between gap-3"><p aria-live="polite" data-testid="text-count" className="text-xs text-[#64748B]">{filteredOrders.length} pesanan ditemukan</p><button type="button" aria-label={`Urutkan pesanan, saat ini ${newestFirst ? 'terbaru' : 'terlama'}`} title={`Urutan: ${newestFirst ? 'terbaru' : 'terlama'}`} aria-pressed={!newestFirst} onClick={() => setNewestFirst(value => !value)} className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-[#64748B] transition-colors hover:bg-white active:bg-[#E9EDF3]">Urutkan <ArrowDownUp aria-hidden="true" className="size-3.5" /></button></div>
        <div data-testid="list-orders" className="space-y-2.5">{filteredOrders.map(o => <OrderRow key={o.id} order={o} variant="orders" />)}</div>
      </>}
    </div>
  );
}

export default function Orders() {
  return <AppShell route="/orders"><OrdersPage /></AppShell>;
}

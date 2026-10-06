import { useCallback, useEffect, useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { ArrowDownUp, Search, X } from 'lucide-react';
import { useListOrders, getListOrdersQueryKey, type ListOrdersParams } from '@workspace/api-client-react';
import { usePageMeta } from '@/hooks/use-page-meta';
import { EmptyState, ErrorState, ListSkeleton, PageHeading } from '@/components/states';
import { OrderRow } from '@/components/order-row';
import { LazadaOrderSync } from '@/components/lazada-order-sync';
import { ScrollArea } from '@/components/ui/scroll-area';

const FILTERS = [
  ['', 'Semua'], ['pending', 'Menunggu'], ['processing', 'Diproses'], ['completed', 'Selesai'], ['cancelled', 'Dibatalkan'],
] as const;
const VALID = ['pending', 'processing', 'completed', 'cancelled'];

export default function Orders() {
  usePageMeta('Daftar Pesanan', 'Lihat seluruh pesanan digital Anda.');
  const [, nav] = useLocation();
  const sp = new URLSearchParams(useSearch());
  const urlSearch = (sp.get('search') ?? '').slice(0, 200);
  const rawStatus = sp.get('status') ?? '';
  const status = VALID.includes(rawStatus) ? rawStatus : '';
  const [text, setText] = useState(urlSearch);
  const [newestFirst, setNewestFirst] = useState(true);

  const setUrl = useCallback((s: string, st: string) => {
    const p = new URLSearchParams();
    if (s.trim()) p.set('search', s.trim());
    if (st) p.set('status', st);
    const qs = p.toString();
    nav(`/orders${qs ? `?${qs}` : ''}`, { replace: true });
  }, [nav]);
  useEffect(() => {
    if (text.trim() === urlSearch) return;
    const t = setTimeout(() => setUrl(text, status), 350);
    return () => clearTimeout(t);
  }, [text, urlSearch, status, setUrl]);
  useEffect(() => { setText(urlSearch); }, [urlSearch]);

  const params: ListOrdersParams = {};
  if (urlSearch.trim()) params.search = urlSearch.trim();
  if (status) params.status = status as ListOrdersParams['status'];
  const q = useListOrders(params, {
    query: { queryKey: getListOrdersQueryKey(params), staleTime: 5000, refetchInterval: 5000, refetchOnWindowFocus: true, refetchOnMount: true },
  });
  const filtered = !!(params.search || params.status);
  const from = new URLSearchParams(Object.entries(params) as [string, string][]).toString();
  const sortedOrders = [...(q.data ?? [])].sort((a, b) => {
    const timestamp = (value: string | null | undefined) => {
      const parsed = value ? Date.parse(value) : Number.NaN;
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const difference = timestamp(b.sourceCreatedAt ?? b.createdAt) - timestamp(a.sourceCreatedAt ?? a.createdAt);
    return newestFirst ? difference : -difference;
  });

  return (
    <>
      <PageHeading title="Pesanan" sub="Kelola pesanan digital Lazada." />
      <LazadaOrderSync />
      {/* Sticky search bar */}
      <div className="sticky top-14 z-20 -mx-4 mb-4 bg-[#F4F6F9]/95 px-4 pb-3 pt-1 backdrop-blur md:top-0 md:mx-0 md:mb-5 md:px-0 md:pb-0 md:pt-0">
        <div className="relative mb-3 md:mb-0">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input type="search" value={text} maxLength={200} onChange={(e) => setText(e.target.value)}
            data-testid="input-search" aria-label="Cari ID pesanan atau nama produk" placeholder="Cari ID pesanan atau produk"
            className="min-h-12 w-full rounded-xl border border-[#DCE2EA] bg-white pl-10 pr-11 text-sm shadow-[0_2px_8px_rgba(24,39,75,.04)] outline-none transition focus:border-[#E96B27] focus:ring-2 focus:ring-[#F27832]/15 placeholder:text-[#98A2B1]" />
          {text && (
            <button type="button" aria-label="Hapus pencarian" data-testid="button-clear-search"
              onClick={() => { setText(''); setUrl('', status); }}
              className="absolute right-0 top-0 grid size-11 place-items-center text-muted-foreground hover:text-foreground transition-colors"><X className="size-4" /></button>
          )}
        </div>
        {/* Horizontal scroll filters on mobile, flex wrap on desktop */}
        <ScrollArea className="orders-filter-scroll md:hidden w-[calc(100%+32px)] -mx-4">
          <div className="flex gap-2 px-4 pb-2" role="group" aria-label="Filter status">
            {FILTERS.map(([v, l]) => (
              <button key={l} type="button" aria-pressed={status === v} data-testid={`filter-${v || 'all'}`}
                onClick={() => setUrl(text, v)}
                className={`min-h-10 rounded-full border px-4 text-xs font-semibold whitespace-nowrap transition-all duration-200 ${status === v ? 'border-[#14213A] bg-[#14213A] text-white shadow-sm' : 'border-[#E0E5EC] bg-white text-[#647184] hover:border-[#E96B27]/50 hover:text-[#14213A]'}`}>{l}</button>
            ))}
          </div>
        </ScrollArea>
        {/* Desktop flex wrap filters */}
        <div className="hidden md:flex flex-wrap gap-2" role="group" aria-label="Filter status">
          {FILTERS.map(([v, l]) => (
            <button key={l} type="button" aria-pressed={status === v} data-testid={`filter-${v || 'all'}`}
              onClick={() => setUrl(text, v)}
              className={`min-h-11 rounded-full border px-4 text-sm font-semibold transition-all duration-200 ${status === v ? 'border-[#14213A] bg-[#14213A] text-white shadow-sm' : 'border-[#E0E5EC] bg-white text-[#647184] hover:border-[#E96B27]/50 hover:text-[#14213A]'}`}>{l}</button>
          ))}
        </div>
      </div>
      {q.isLoading && <ListSkeleton rows={4} />}
      {q.isError && <ErrorState text="Daftar pesanan belum bisa diambil." onRetry={() => q.refetch()} />}
      {q.data && q.data.length === 0 && (filtered ? (
        <EmptyState title="Tidak ada hasil" text="Tidak ada pesanan yang cocok dengan pencarian atau filter ini."
          action={<button type="button" data-testid="button-reset" onClick={() => { setText(''); setUrl('', ''); }} className="min-h-11 rounded-lg border px-4 text-sm transition-colors hover:bg-card">Hapus pencarian dan filter</button>} />
      ) : (
        <EmptyState title="Belum ada pesanan" text="Daftar akan terisi saat data pesanan tersedia." />
      ))}
      {q.data && q.data.length > 0 && (
        <>
          <div className="mb-2 flex min-h-11 items-center justify-between gap-3">
            <p aria-live="polite" data-testid="text-count" className="text-xs text-[#64748B]">
              {q.data.length >= 100
                ? 'Menampilkan 100 pesanan terbaru yang cocok. Pesanan lebih lama tidak ditampilkan; persempit pencarian.'
                : `${q.data.length} pesanan ditemukan`}
            </p>
            <button type="button" aria-label={`Urutkan pesanan, saat ini ${newestFirst ? 'terbaru' : 'terlama'}`}
              title={`Urutan: ${newestFirst ? 'terbaru' : 'terlama'}`} aria-pressed={!newestFirst}
              onClick={() => setNewestFirst(value => !value)}
              className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-[#64748B] transition-colors hover:bg-white active:bg-[#E9EDF3]">
              Urutkan <ArrowDownUp aria-hidden="true" className="size-3.5" />
            </button>
          </div>
          <div key={`${status}:${urlSearch}`} data-testid="list-orders" className="page-enter space-y-3">{sortedOrders.map((o) => <OrderRow key={o.id} order={o} from={from} variant="orders" />)}</div>
        </>
      )}
    </>
  );
}

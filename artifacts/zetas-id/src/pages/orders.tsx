import { useCallback, useEffect, useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { Search, X } from 'lucide-react';
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

  return (
    <>
      <PageHeading title="Pesanan" sub="Kelola pesanan digital Lazada." />
      <LazadaOrderSync />
      {/* Sticky search bar */}
      <div className="sticky top-14 md:top-0 z-20 bg-page mb-4 pb-4 -mx-4 md:mx-0 px-4 md:px-0 md:mb-3 md:pb-0">
        <div className="relative mb-3 md:mb-0">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input type="search" value={text} maxLength={200} onChange={(e) => setText(e.target.value)}
            data-testid="input-search" aria-label="Cari ID pesanan atau nama produk" placeholder="Cari ID pesanan atau produk"
            className="min-h-11 w-full rounded-lg border border-input bg-card pl-9 pr-11 text-base" />
          {text && (
            <button type="button" aria-label="Hapus pencarian" data-testid="button-clear-search"
              onClick={() => { setText(''); setUrl('', status); }}
              className="absolute right-0 top-0 grid size-11 place-items-center text-muted-foreground hover:text-foreground transition-colors"><X className="size-4" /></button>
          )}
        </div>
        {/* Horizontal scroll filters on mobile, flex wrap on desktop */}
        <ScrollArea className="md:hidden w-[calc(100%+32px)] -mx-4">
          <div className="flex gap-2 px-4 pb-2" role="group" aria-label="Filter status">
            {FILTERS.map(([v, l]) => (
              <button key={l} type="button" aria-pressed={status === v} data-testid={`filter-${v || 'all'}`}
                onClick={() => setUrl(text, v)}
                className={`min-h-10 rounded-full border px-3 text-xs font-medium whitespace-nowrap transition-colors ${status === v ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:border-primary/50'}`}>{l}</button>
            ))}
          </div>
        </ScrollArea>
        {/* Desktop flex wrap filters */}
        <div className="hidden md:flex flex-wrap gap-2" role="group" aria-label="Filter status">
          {FILTERS.map(([v, l]) => (
            <button key={l} type="button" aria-pressed={status === v} data-testid={`filter-${v || 'all'}`}
              onClick={() => setUrl(text, v)}
              className={`min-h-11 rounded-full border px-4 text-sm font-medium transition-colors ${status === v ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:border-primary/50'}`}>{l}</button>
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
          <p aria-live="polite" data-testid="text-count" className="mb-2 text-xs text-muted-foreground">
            {q.data.length >= 100
              ? 'Menampilkan 100 pesanan terbaru yang cocok. Pesanan lebih lama tidak ditampilkan; persempit pencarian.'
              : `${q.data.length} pesanan`}
          </p>
          <div data-testid="list-orders" className="space-y-3">{q.data.map((o) => <OrderRow key={o.id} order={o} from={from} variant="orders" />)}</div>
        </>
      )}
    </>
  );
}

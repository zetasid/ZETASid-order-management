import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Download, Loader2 } from 'lucide-react';
import { ApiError, useGetLazadaConnection, useSyncLazadaOrders } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';

const day = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

export function LazadaOrderSync() {
  const client = useQueryClient();
  const connection = useGetLazadaConnection({ query: { staleTime: 0, refetchOnWindowFocus: true } });
  const sync = useSyncLazadaOrders();
  const [after, setAfter] = useState(() => day(new Date(Date.now() - 90 * 86400000)));
  const [before, setBefore] = useState(() => day(new Date()));
  const [localError, setLocalError] = useState('');
  const read = (offset: number) => {
    setLocalError('');
    if (!after || !before || after > before) { setLocalError('Pilih rentang tanggal yang valid.'); return; }
    sync.mutate({ data: {
      createdAfter: new Date(`${after}T00:00:00+07:00`).toISOString(),
      createdBefore: new Date(`${before}T23:59:59+07:00`).toISOString(), offset,
    } }, { onSuccess: () => { void client.invalidateQueries({ predicate: query =>
      typeof query.queryKey[0] === 'string' && (query.queryKey[0].startsWith('/api/orders') || query.queryKey[0].startsWith('/api/dashboard')),
    }); } });
  };
  const available = connection.data?.connected === true;
  const error = sync.error instanceof ApiError && typeof sync.error.data === 'object' && sync.error.data
    && 'error' in sync.error.data && typeof sync.error.data.error === 'string'
    ? sync.error.data.error : sync.isError ? 'Pembacaan gagal. Muat ulang daftar sebelum mencoba lagi untuk memastikan hasil terakhir.' : '';
  return (
    <section className="mb-5 rounded-xl border bg-card p-4" aria-labelledby="sync-heading">
      <h2 id="sync-heading" className="font-semibold">Baca order Lazada — READ-ONLY</h2>
      <p className="mt-1 text-xs text-muted-foreground">Manual, maksimum 20 order per halaman beserta semua itemnya. Tidak mengubah order di Lazada dan tidak mengirim produk digital.</p>
      <div className="my-3 grid grid-cols-2 gap-3">
        <label className="min-w-0 text-xs">Dari tanggal (WIB)
          <input type="date" data-testid="sync-from" value={after} disabled={sync.isPending}
            onChange={event => { setAfter(event.target.value); sync.reset(); setLocalError(''); }}
            className="mt-1 min-h-11 w-full rounded-md border bg-background px-2 text-sm" />
        </label>
        <label className="min-w-0 text-xs">Sampai tanggal (WIB)
          <input type="date" data-testid="sync-to" value={before} disabled={sync.isPending}
            onChange={event => { setBefore(event.target.value); sync.reset(); setLocalError(''); }}
            className="mt-1 min-h-11 w-full rounded-md border bg-background px-2 text-sm" />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => read(0)} disabled={!available || sync.isPending} data-testid="button-sync-lazada">
          {sync.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Download className="mr-2 size-4" />}
          {sync.isPending ? 'Membaca Lazada…' : 'Baca order Lazada'}
        </Button>
        {sync.data?.nextOffset !== null && sync.data?.nextOffset !== undefined && <Button variant="outline"
          onClick={() => read(sync.data!.nextOffset!)} disabled={!available || sync.isPending} data-testid="button-sync-next">
          Baca halaman berikutnya
        </Button>}
      </div>
      {!available && !connection.isLoading && <p className="mt-2 text-sm text-muted-foreground">
        {connection.isError ? 'Status koneksi tidak dapat diperiksa.' : 'Hubungkan akun Lazada terlebih dahulu.'}
        {' '}<Link href="/settings" className="underline">Buka Pengaturan</Link>
      </p>}
      {(error || localError) && <p role="alert" className="mt-3 text-sm text-destructive">{localError || error}</p>}
      {sync.data && <div role="status" data-testid="sync-result" className="mt-3 space-y-1 text-sm">
        <p>{sync.data.ordersRead} order dan {sync.data.itemsRead} item dibaca dan disimpan. Total dalam rentang: {sync.data.countTotal ?? 'tidak diberikan API'}.</p>
        <p className="text-xs text-muted-foreground">Field digital_delivery_info hadir pada {sync.data.digitalDetailPresent} item; {sync.data.digitalDetailNonempty} berisi nilai tidak kosong.
          {sync.data.nextOffset !== null ? ' Klik halaman berikutnya untuk melanjutkan; tidak berjalan otomatis.' : ' Halaman terakhir dalam rentang ini.'}</p>
        <details className="pt-1 text-xs"><summary className="cursor-pointer">Field response yang diterima</summary>
          <p className="mt-2 break-all">GetOrders: {sync.data.orderFields.join(', ') || '(tidak ada order)'}</p>
          <p className="mt-2 break-all">GetOrderItems: {sync.data.itemFields.join(', ') || '(tidak ada item)'}</p>
        </details>
      </div>}
    </section>
  );
}
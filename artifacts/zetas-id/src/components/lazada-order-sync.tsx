import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Download, Loader2, RotateCw } from 'lucide-react';
import { ApiError, useGetLazadaConnection, useGetLazadaOrderPushStatus, useSyncLazadaOrders } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { waktuWib } from '@/lib/format';

const day = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

export function LazadaOrderSync() {
  const client = useQueryClient();
  const connection = useGetLazadaConnection({ query: { staleTime: 0, refetchOnWindowFocus: true } });
  const pushStatus = useGetLazadaOrderPushStatus({ query: { staleTime: 30000, refetchOnWindowFocus: true } });
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
  const lastSync = sync.data?.syncedAt ?? pushStatus.data?.lastSync;
  return (
    <section className="mb-4 overflow-hidden rounded-xl border border-[#E2E8F0] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]" aria-labelledby="sync-heading">
      <details className="group">
        <summary className="flex min-h-14 list-none cursor-pointer items-center gap-3 px-3 py-2 [&::-webkit-details-marker]:hidden sm:px-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#FFF3E8] text-[#F97316]">
            <RotateCw aria-hidden="true" className={`size-4 ${sync.isPending ? 'animate-spin' : ''}`} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="sync-heading" className="text-sm font-semibold text-[#0F172A]">Sinkronkan Pesanan</h2>
            <p className="mt-0.5 truncate text-[11px] text-[#64748B]">
              Terakhir: {lastSync ? waktuWib(lastSync).replace(' • ', ', ') : 'Tidak tersedia'}
            </p>
          </div>
          <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-[#64748B] transition-transform group-open:rotate-90" />
        </summary>
        <div className="border-t border-[#E2E8F0] px-4 py-4 sm:px-5">
          <p className="text-xs leading-5 text-[#64748B]">Maksimum 20 pesanan per halaman. Rentang memakai waktu perubahan Lazada agar status pesanan lama ikut diperbarui; pembacaan ini tidak mengirim produk digital.</p>
          <div className="my-4 grid grid-cols-2 gap-3">
            <label className="min-w-0 text-xs font-medium text-[#475569]">Perubahan sejak tanggal (WIB)
              <input type="date" data-testid="sync-from" value={after} disabled={sync.isPending}
                onChange={event => { setAfter(event.target.value); sync.reset(); setLocalError(''); }}
                className="mt-1 min-h-11 w-full rounded-lg border border-[#E2E8F0] bg-white px-2 text-sm text-[#0F172A]" />
            </label>
            <label className="min-w-0 text-xs font-medium text-[#475569]">Sampai tanggal perubahan (WIB)
              <input type="date" data-testid="sync-to" value={before} disabled={sync.isPending}
                onChange={event => { setBefore(event.target.value); sync.reset(); setLocalError(''); }}
                className="mt-1 min-h-11 w-full rounded-lg border border-[#E2E8F0] bg-white px-2 text-sm text-[#0F172A]" />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => read(0)} disabled={!available || sync.isPending} data-testid="button-sync-lazada"
              className="min-h-11 rounded-xl border-[#F97316] bg-[#F97316] px-4 font-semibold text-[#0F172A] hover:bg-[#EA580C]">
              {sync.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Download className="mr-2 size-4" />}
              {sync.isPending ? 'Membaca Lazada…' : 'Baca pesanan'}
            </Button>
            {sync.data?.nextOffset !== null && sync.data?.nextOffset !== undefined && <Button variant="outline"
              onClick={() => read(sync.data!.nextOffset!)} disabled={!available || sync.isPending} data-testid="button-sync-next"
              className="min-h-11 rounded-xl border-[#E2E8F0]">
              Baca halaman berikutnya
            </Button>}
          </div>
          {!available && !connection.isLoading && <p className="mt-3 text-sm text-[#64748B]">
            {connection.isError ? 'Status koneksi tidak dapat diperiksa.' : 'Hubungkan akun Lazada terlebih dahulu.'}
            {' '}<Link href="/settings" className="font-medium text-[#2563EB] underline underline-offset-2">Buka Pengaturan</Link>
          </p>}
          {(error || localError) && <p role="alert" className="mt-3 text-sm text-[#DC2626]">{localError || error}</p>}
          {sync.data && <div role="status" data-testid="sync-result" className="mt-4 rounded-xl bg-[#F8FAFC] p-3 text-sm text-[#1E293B]">
            <p className="font-medium">{sync.data.ordersRead} pesanan dan {sync.data.itemsRead} item dibaca. Total perubahan dalam rentang: {sync.data.countTotal ?? 'tidak diberikan Lazada'}.</p>
            <p className="mt-1 text-xs leading-5 text-[#64748B]">
              {sync.data.digitalDetailPresent} item memiliki data digital; {sync.data.digitalDetailNonempty} berisi nilai.
              {sync.data.nextOffset !== null ? ' Lanjutkan dengan membaca halaman berikutnya.' : ' Pembacaan rentang selesai.'}
            </p>
            <details className="mt-2">
              <summary className="flex min-h-11 cursor-pointer items-center text-xs font-medium text-[#64748B]">Informasi teknis tambahan</summary>
              <p className="break-all text-xs">GetOrders (update_after): {sync.data.orderFields.join(', ') || '(tidak ada pesanan)'}</p>
              <p className="mt-2 break-all text-xs">GetOrderItems: {sync.data.itemFields.join(', ') || '(tidak ada item)'}</p>
            </details>
          </div>}
        </div>
      </details>
    </section>
  );
}
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { MessageCircle } from 'lucide-react';
import {
  ApiError,
  getGetLazadaImConnectionQueryKey,
  useAuthorizeLazadaIm,
  useGetLazadaImConnection,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/states';

const outcomes: Record<string, string> = {
  connected: 'Otorisasi IM Chat selesai.',
  authorization_failed: 'Otorisasi IM Chat tidak selesai, kedaluwarsa, atau tidak valid. Coba lagi.',
  permission_denied: 'Lazada menolak izin In-house IM Chat untuk aplikasi ini.',
  api_unavailable: 'Lazada belum dapat dihubungi. Silakan coba kembali.',
};

const statusLabel = (status: string | undefined) => status === 'connected' ? 'Terhubung'
  : status === 'expired' ? 'Token kedaluwarsa' : 'Belum terhubung';

export function LazadaImConnection() {
  const client = useQueryClient();
  const q = useGetLazadaImConnection({ query: { staleTime: 0, refetchOnWindowFocus: true } });
  const authorize = useAuthorizeLazadaIm();
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const outcome = url.searchParams.get('lazada_im');
    if (outcome && outcomes[outcome]) setMessage(outcomes[outcome]);
    if (outcome) {
      url.searchParams.delete('lazada_im');
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
      void client.invalidateQueries({ queryKey: getGetLazadaImConnectionQueryKey() });
    }
  }, [client]);

  const fail = (error: unknown) => setMessage(error instanceof ApiError && typeof error.data === 'object'
    && error.data && 'error' in error.data && typeof error.data.error === 'string'
    ? error.data.error : 'Permintaan koneksi IM Chat gagal. Silakan coba kembali.');

  const connect = () => {
    setMessage(null);
    const popup = window.open('about:blank', '_blank');
    if (!popup) { setMessage('Izinkan tab baru untuk membuka halaman resmi Lazada.'); return; }
    popup.opener = null;
    popup.document.title = 'Otorisasi Lazada IM Chat';
    popup.document.body.textContent = 'Menyiapkan otorisasi Lazada IM Chat…';
    authorize.mutate(undefined, {
      onSuccess: data => {
        const url = new URL(data.authorizationUrl);
        if (url.origin !== 'https://auth.lazada.com' || url.pathname !== '/oauth/authorize') {
          popup.close();
          setMessage('URL otorisasi IM Chat tidak valid.');
          return;
        }
        if (popup.closed) {
          setMessage('Tab otorisasi ditutup. Mulai lagi untuk menghubungkan IM Chat.');
          return;
        }
        popup.location.replace(url.href);
        setMessage('Selesaikan otorisasi IM Chat di tab Lazada, lalu kembali ke Pengaturan.');
      },
      onError: error => { popup.close(); fail(error); },
    });
  };

  const pending = authorize.isPending;
  const connected = q.data?.status === 'connected';
  const expired = q.data?.status === 'expired';

  return (
    <section className="surface-card rounded-2xl p-4 sm:p-5" aria-labelledby="lazada-im-heading">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="lazada-im-heading" className="flex items-center gap-2 text-[15px] font-bold tracking-[-.01em] text-[#14213A]">
          <span className="grid size-9 place-items-center rounded-xl bg-[#EEF2F8] text-[#14213A]">
            <MessageCircle aria-hidden="true" className="size-4" />
          </span>
          Koneksi Lazada IM Chat
        </h2>
      </div>
      {q.isLoading && <Skeleton className="mb-3 h-6 w-40" />}
      {q.isError && <ErrorState text="Status koneksi IM Chat tidak dapat dimuat." onRetry={() => q.refetch()} />}
      {q.data && <>
        <p className={`mb-3 flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold ${
          connected ? 'bg-emerald-50 text-emerald-800' : expired ? 'bg-amber-50 text-amber-800' : 'bg-[#F3F5F8] text-[#53647B]'
        }`} data-testid="lazada-im-status" role="status">
          <span className={`size-2.5 rounded-full ${connected ? 'bg-emerald-500' : expired ? 'bg-amber-500' : 'bg-muted-foreground'}`} />
          {statusLabel(q.data.status)}
        </p>
        {!q.data.configured && <p className="mb-3 text-sm text-muted-foreground">
          Konfigurasi aplikasi IM Chat belum tersedia di backend. Tambahkan App Key dan App Secret IM Chat melalui Replit Secrets.
        </p>}
        {(connected || expired) && q.data.expiresAt && (
          <p className="mb-3 text-sm text-muted-foreground">Token berlaku hingga {new Date(q.data.expiresAt).toLocaleString('id-ID')}.</p>
        )}
        <Button
          className="min-h-11 rounded-xl px-4"
          onClick={connect}
          disabled={!q.data.configured || pending}
          data-testid="lazada-im-connect"
        >
          {pending ? 'Menyiapkan OAuth…' : 'Hubungkan IM Chat'}
        </Button>
      </>}
      {message && <p className="mt-3 text-sm" role="status">{message}</p>}
      <p className="mt-4 text-xs text-muted-foreground">
        Koneksi dan token IM Chat terpisah dari koneksi Seller In-house APP. Halaman ini hanya menampilkan status otorisasi;
        tidak mengirim pesan atau menandai sesi terbaca.
      </p>
    </section>
  );
}

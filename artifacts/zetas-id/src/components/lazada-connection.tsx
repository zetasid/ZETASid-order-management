import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link2, RefreshCw } from 'lucide-react';
import { ApiError, useGetLazadaConnection, useGetLazadaOrderPushStatus, useAuthorizeLazada, useCheckLazadaConnection, getGetLazadaConnectionQueryKey } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/states';

const outcomes: Record<string, string> = {
  connected: 'OAuth selesai dan koneksi API seller berhasil diverifikasi.',
  authorization_failed: 'Otorisasi tidak selesai, kedaluwarsa, atau tidak valid. Mulai lagi dari tombol Hubungkan Lazada.',
  permission_denied: 'Akses GetSeller belum diizinkan. Periksa permission minimum di App Console Lazada.',
  wrong_country: 'Negara toko tidak sesuai dengan konfigurasi backend.',
  api_unavailable: 'Lazada belum dapat dihubungi. Silakan coba kembali.',
};
const date = (value: string | null) => value ? new Date(value).toLocaleString('id-ID') : '—';
export function LazadaConnection() {
  const client = useQueryClient();
  const q = useGetLazadaConnection({ query: { staleTime: 0, refetchOnWindowFocus: true } });
  const push = useGetLazadaOrderPushStatus({ query: { staleTime: 0, refetchInterval: 5000, refetchOnWindowFocus: true } });
  const authorize = useAuthorizeLazada();
  const check = useCheckLazadaConnection();
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    const url = new URL(window.location.href);
    const outcome = url.searchParams.get('lazada');
    if (outcome && outcomes[outcome]) setMessage(outcomes[outcome]);
    if (outcome) {
      url.searchParams.delete('lazada');
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
      void client.invalidateQueries({ queryKey: getGetLazadaConnectionQueryKey() });
    }
  }, [client]);
  const fail = (error: unknown) => setMessage(error instanceof ApiError && typeof error.data === 'object'
    && error.data && 'error' in error.data && typeof error.data.error === 'string'
    ? error.data.error : 'Permintaan gagal. Silakan coba kembali.');
  const connect = () => {
    setMessage(null);
    // OAuth providers may forbid iframe embedding. Open synchronously so the
    // browser recognizes the user gesture, then detach the opener before navigation.
    const popup = window.open('about:blank', '_blank');
    if (!popup) { setMessage('Izinkan tab baru untuk membuka halaman resmi Lazada.'); return; }
    popup.opener = null;
    popup.document.title = 'Otorisasi Lazada';
    popup.document.body.textContent = 'Menyiapkan otorisasi Lazada…';
    authorize.mutate(undefined, { onSuccess: data => {
      // Only a public OAuth URL is returned; never credentials or access tokens.
      const url = new URL(data.authorizationUrl);
      if (url.origin !== 'https://auth.lazada.com' || url.pathname !== '/oauth/authorize') {
        popup.close(); setMessage('URL otorisasi tidak valid.'); return;
      }
      if (popup.closed) { setMessage('Tab otorisasi ditutup. Mulai lagi untuk menghubungkan Lazada.'); return; }
      popup.location.replace(url.href);
      setMessage('Selesaikan otorisasi di tab Lazada, lalu kembali ke Pengaturan untuk melihat status koneksi.');
    }, onError: error => { popup.close(); fail(error); } });
  };
  const verify = () => {
    setMessage(null);
    check.mutate(undefined, {
      onSuccess: data => {
        client.setQueryData(getGetLazadaConnectionQueryKey(), data);
        setMessage('Koneksi API Lazada berhasil diverifikasi.');
      },
      onError: fail,
      onSettled: () => { void client.invalidateQueries({ queryKey: getGetLazadaConnectionQueryKey() }); },
    });
  };
  const pending = authorize.isPending || check.isPending;
  return (
    <section className="mb-4 rounded-xl border bg-card p-4" aria-labelledby="lazada-heading">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="lazada-heading" className="flex items-center gap-2 font-semibold"><Link2 className="size-4" />Koneksi Lazada</h2>
        <span className="rounded-md border px-2 py-1 text-xs font-medium">Testing</span>
      </div>
      {q.isLoading && <Skeleton className="h-6 w-40" />}
      {q.isError && <ErrorState text="Status koneksi tidak dapat dimuat." onRetry={() => q.refetch()} />}
      {q.data && <>
        <p className="mb-3 flex items-center gap-2 font-medium" data-testid="lazada-status">
          <span className={`size-2.5 rounded-full ${q.data.connected ? 'bg-emerald-500' : 'bg-muted-foreground'}`} />
          {q.data.connected ? 'Terhubung' : 'Tidak Terhubung'}
        </p>
        {!q.data.configured && <p className="mb-3 text-sm text-muted-foreground">
          Konfigurasi backend belum lengkap atau tidak valid. Atur App Key, App Secret, key enkripsi token,
          mode Testing, dan callback HTTPS melalui environment variables. Jangan masukkan credential di halaman ini.
        </p>}
        {q.data.reason === 'expired' && <p className="mb-3 text-sm text-muted-foreground">Token kedaluwarsa. Hubungkan ulang Lazada.</p>}
        {q.data.reason === 'verification_failed' && <p className="mb-3 text-sm text-muted-foreground">Koneksi terakhir tidak valid. Cek kembali atau hubungkan ulang.</p>}
        <dl className="mb-4 grid gap-2 text-sm">
          <div className="flex flex-wrap justify-between gap-2"><dt className="text-muted-foreground">Negara toko</dt><dd>{q.data.country?.toUpperCase() ?? '—'}</dd></div>
          <div className="flex flex-wrap justify-between gap-2"><dt className="text-muted-foreground">Pemeriksaan terakhir</dt><dd>{date(q.data.lastCheckedAt)}</dd></div>
          <div className="flex flex-wrap justify-between gap-2"><dt className="text-muted-foreground">Token berlaku hingga</dt><dd>{date(q.data.expiresAt)}</dd></div>
          {push.data && <>
            <div className="flex flex-wrap justify-between gap-2" data-testid="lazada-push-status"><dt className="text-muted-foreground">Push Order</dt><dd>{q.data.connected && push.data.active ? 'Aktif (push berhasil diterima)' : 'Tidak Aktif / belum terverifikasi'}</dd></div>
            <div className="flex flex-wrap justify-between gap-2" data-testid="lazada-last-push"><dt className="text-muted-foreground">Last Push</dt><dd>{date(push.data.lastPush)}</dd></div>
            <div className="flex flex-wrap justify-between gap-2" data-testid="lazada-last-sync"><dt className="text-muted-foreground">Last Sync</dt><dd>{date(push.data.lastSync)}</dd></div>
            <div className="flex flex-wrap justify-between gap-2" data-testid="lazada-last-error"><dt className="text-muted-foreground">Last Error</dt><dd className="max-w-full break-words">{push.data.lastError ?? '—'}</dd></div>
            <div className="flex flex-wrap justify-between gap-2"><dt className="text-muted-foreground">Antrean push</dt><dd>{push.data.pending}</dd></div>
            <div className="flex flex-wrap justify-between gap-2"><dt className="text-muted-foreground">Backup sinkronisasi</dt><dd>Tiap {push.data.reconciliationHours} jam</dd></div>
          </>}
          {q.data.callbackUri && <div><dt className="text-muted-foreground">Callback HTTPS</dt><dd className="mt-1 break-all font-mono text-xs">{q.data.callbackUri}</dd></div>}
        </dl>
        {push.isError && <p className="mb-3 text-sm" role="alert">Status Push Order belum dapat dimuat.</p>}
        {push.data && <p className="mb-3 text-xs text-muted-foreground">
          Webhook: <code className="break-all">{push.data.webhookPath}</code>. Verifikasi URL HTTPS tetap dan subscribe Order Status Change (type 0) di Message Service Lazada.
          Status Aktif berarti push bertanda tangan telah berhasil dibaca dari API, bukan konfirmasi subscription dari App Console.
        </p>}
        <div className="flex flex-wrap gap-2">
          <Button onClick={connect} disabled={!q.data.configured || pending} data-testid="lazada-connect">
            {authorize.isPending ? 'Menyiapkan OAuth…' : q.data.lastCheckedAt ? 'Hubungkan ulang Lazada' : 'Hubungkan Lazada'}
          </Button>
          <Button variant="outline" onClick={verify} disabled={!q.data.configured || !q.data.lastCheckedAt || pending} data-testid="lazada-check">
            <RefreshCw className={`mr-2 size-4 ${check.isPending ? 'animate-spin' : ''}`} />
            {check.isPending ? 'Memeriksa…' : 'Cek koneksi'}
          </Button>
        </div>
      </>}
      {message && <p className="mt-3 text-sm" role="status">{message}</p>}
      <p className="mt-4 text-xs text-muted-foreground">
        Koneksi khusus akun ZETAS Anda. Pemeriksaan hanya membaca informasi dasar seller.
        Pemasukan order otomatis hanya membaca API dan menyimpan data. Tidak memproses fulfillment atau menjalankan DeliverDigital.
        Status Terhubung mencerminkan verifikasi terakhir; gunakan Cek koneksi untuk memeriksa ulang.
      </p>
    </section>
  );
}
import { Redirect, useSearch } from 'wouter';
import { useState, type FormEvent } from 'react';
import { ApiError } from '@workspace/api-client-react';
import { usePageMeta } from '@/hooks/use-page-meta';
import { Brand } from '@/components/app-shell';
import { useAuth } from '@/hooks/use-auth';

export default function Login() {
  usePageMeta('Masuk', 'Masuk ke ruang pengelolaan pesanan ZETAS.id.');
  const { user, loading, signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const next = new URLSearchParams(useSearch()).get('next') ?? '';
  const destination = /^\/(?:dashboard|orders(?:\/[0-9a-f-]{36})?|settings)(?:\?.*)?$/.test(next) ? next : '/dashboard';
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try { await signIn(email, password); } catch (e) {
      setError(e instanceof ApiError && e.status === 429
        ? 'Terlalu banyak percobaan. Tunggu sebelum mencoba kembali.'
        : e instanceof ApiError && (e.status === 400 || e.status === 401)
          ? 'Email atau kata sandi tidak sesuai.'
          : 'Tidak dapat masuk. Periksa koneksi dan coba lagi.');
    } finally { setPassword(''); setBusy(false); }
  };
  if (user) return <Redirect to={destination} />;
  return (
    <div className="grid min-h-[100dvh] place-items-center bg-primary px-4 text-primary-foreground">
      <div className="w-full max-w-sm">
        <Brand className="size-36" />
        <h1 className="mt-8 text-3xl font-bold tracking-tight">Masuk</h1>
        <p className="mt-3 text-sm text-primary-foreground/75">Akses khusus pengguna yang diberi izin oleh pengelola.</p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm">Email</label>
            <input id="email" data-testid="input-email" type="email" autoComplete="username" required maxLength={254}
              value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy || loading}
              className="min-h-12 w-full rounded-lg border border-white/25 bg-white/10 px-3 text-base outline-none focus:border-accent" />
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-sm">Kata sandi</label>
            <input id="password" data-testid="input-password" type="password" autoComplete="current-password" required maxLength={128}
              value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy || loading}
              className="min-h-12 w-full rounded-lg border border-white/25 bg-white/10 px-3 text-base outline-none focus:border-accent" />
          </div>
          {error && <p role="alert" data-testid="text-login-error" className="rounded-lg border border-accent/50 p-3 text-sm">{error}</p>}
          <button type="submit" data-testid="button-login" disabled={busy || loading}
            className="grid min-h-12 w-full place-items-center rounded-lg bg-accent font-medium text-accent-foreground disabled:opacity-60">
            {loading ? 'Memeriksa sesi…' : busy ? 'Memproses…' : 'Masuk'}
          </button>
        </form>
      </div>
    </div>
  );
}

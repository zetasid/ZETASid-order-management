import { Link } from 'wouter';
import { usePageMeta } from '@/hooks/use-page-meta';
import { Brand } from '@/components/app-shell';

export default function Login() {
  usePageMeta('Masuk', 'Halaman masuk ZETAS.id. Autentikasi belum terhubung pada fase ini.');
  return (
    <div className="grid min-h-[100dvh] place-items-center bg-primary px-4 text-primary-foreground">
      <div className="w-full max-w-sm">
        <Brand />
        <h1 className="mt-8 text-3xl font-bold tracking-tight">Masuk</h1>
        <p role="status" data-testid="text-auth-notice" className="mt-3 rounded-lg border border-accent/60 bg-accent/15 p-3 text-sm">
          Autentikasi belum terhubung. Halaman ini hanya tampilan; tidak ada data masuk yang dikumpulkan atau disimpan.
        </p>
        <div className="mt-5 space-y-3 opacity-60" aria-hidden="true">
          <div className="h-12 rounded-lg border border-white/20 px-3 py-3 text-sm text-primary-foreground/60">Email</div>
          <div className="h-12 rounded-lg border border-white/20 px-3 py-3 text-sm text-primary-foreground/60">Kata sandi</div>
          <div className="grid h-12 place-items-center rounded-lg bg-white/20 text-sm font-medium">Masuk (belum aktif)</div>
        </div>
        <Link href="/dashboard" data-testid="link-view-dashboard"
          className="mt-6 grid min-h-12 place-items-center rounded-lg bg-accent font-medium text-accent-foreground transition-transform active:scale-95">
          Lihat dasbor fondasi
        </Link>
      </div>
    </div>
  );
}

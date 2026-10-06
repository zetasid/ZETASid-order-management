import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowLeft, LayoutDashboard, Package, PackageSearch, Settings, LogOut } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import logo from '@/assets/zetas-logo.png';

const NAV = [
  { href: '/dashboard', label: 'Ringkasan', icon: LayoutDashboard, match: (l: string) => l === '/' || l.startsWith('/dashboard') },
  { href: '/orders', label: 'Pesanan', icon: PackageSearch, match: (l: string) => l.startsWith('/orders') },
  { href: '/settings', label: 'Pengaturan', icon: Settings, match: (l: string) => l.startsWith('/settings') },
];

export function Brand({ className = 'size-12' }: { className?: string }) {
  return (
    <img src={logo} alt="ZETAS.id" width={200} height={200}
      className={`block shrink-0 rounded-md object-contain ${className}`} />
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [loc] = useLocation();
  const isOrderRoute = loc.startsWith('/orders');
  const isOrderDetail = loc.startsWith('/orders/');
  const from = typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('from') ?? '';
  const backHref = `/orders${from ? `?${from}` : ''}`;
  const { signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const leave = async () => {
    setBusy(true); setError('');
    try { await signOut(); } catch { setError('Keluar belum berhasil. Coba lagi.'); }
    finally { setBusy(false); }
  };
  return (
    <div className={`min-h-[100dvh] pb-20 md:pb-0 ${isOrderRoute ? 'bg-[#F6F7FA]' : ''}`}>
      <header className="sticky top-0 z-30 bg-primary text-primary-foreground">
        <div className="relative mx-auto flex h-14 max-w-4xl items-center justify-between px-4">
          {isOrderDetail ? (
            <Link href={backHref} data-testid="link-back" aria-label="Kembali ke pesanan"
              onClick={event => {
                if (window.history.length > 1) {
                  event.preventDefault();
                  window.history.back();
                }
              }}
              className="grid size-11 shrink-0 place-items-center rounded-lg text-primary-foreground transition-colors hover:bg-white/10">
              <ArrowLeft aria-hidden="true" className="size-5" />
            </Link>
          ) : (
            <Link href="/dashboard" data-testid="link-brand" aria-label="ZETAS.id beranda"><Brand /></Link>
          )}
          {isOrderDetail && <h1 className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-base font-semibold text-primary-foreground md:hidden">Detail Pesanan</h1>}
          <nav className="hidden md:flex items-center gap-1" aria-label="Navigasi utama">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} data-testid={`link-nav-${n.label.toLowerCase()}`}
                aria-current={n.match(loc) ? 'page' : undefined}
                className={`rounded-md px-3 py-1.5 text-sm transition-colors ${n.match(loc) ? 'bg-white/15' : 'hover:bg-white/10'}`}>
                {n.label}
              </Link>
            ))}
          </nav>
          <button type="button" onClick={leave} disabled={busy} data-testid="button-logout" className="flex min-h-11 items-center gap-1.5 text-sm text-primary-foreground/80 hover:text-primary-foreground disabled:opacity-60">
            <LogOut className="size-4" /> {busy ? 'Keluar…' : 'Keluar'}
          </button>
        </div>
      </header>
      {error && <p role="alert" className="mx-auto max-w-4xl px-4 pt-3 text-sm text-destructive">{error}</p>}
      <main className={`mx-auto max-w-4xl px-4 ${isOrderRoute ? 'py-4' : 'py-6'}`}>{children}</main>
      <nav aria-label="Navigasi utama" className="fixed bottom-0 inset-x-0 z-30 border-t border-white/10 bg-primary text-primary-foreground md:hidden pb-[env(safe-area-inset-bottom)]">
        <ul className="grid grid-cols-3">
          {NAV.map((n) => {
            const on = n.match(loc);
            const TabIcon = isOrderRoute && n.href === '/orders' ? Package : n.icon;
            return (
              <li key={n.href}>
                <Link href={n.href} data-testid={`link-tab-${n.label.toLowerCase()}`} aria-current={on ? 'page' : undefined}
                  className={`flex flex-col items-center gap-1 py-2.5 text-xs transition-colors ${on ? 'text-accent' : 'text-primary-foreground/70'}`}>
                  <TabIcon className="size-5" />
                  {n.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

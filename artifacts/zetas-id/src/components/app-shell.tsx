import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { LayoutDashboard, PackageSearch, Settings, LogOut } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';

const NAV = [
  { href: '/dashboard', label: 'Ringkasan', icon: LayoutDashboard, match: (l: string) => l === '/' || l.startsWith('/dashboard') },
  { href: '/orders', label: 'Pesanan', icon: PackageSearch, match: (l: string) => l.startsWith('/orders') },
  { href: '/settings', label: 'Pengaturan', icon: Settings, match: (l: string) => l.startsWith('/settings') },
];

export function Brand() {
  return (
    <span className="inline-flex items-center gap-2 font-bold tracking-tight text-lg">
      <span className="grid size-7 place-items-center rounded-md bg-accent text-accent-foreground font-mono text-sm">Z</span>
      ZETAS<span className="text-primary-foreground/70 font-medium">.id</span>
    </span>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [loc] = useLocation();
  const { signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const leave = async () => {
    setBusy(true); setError('');
    try { await signOut(); } catch { setError('Keluar belum berhasil. Coba lagi.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="min-h-[100dvh] pb-20 md:pb-0">
      <header className="sticky top-0 z-30 bg-primary text-primary-foreground">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4">
          <Link href="/dashboard" data-testid="link-brand" aria-label="ZETAS.id beranda"><Brand /></Link>
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
      <main className="mx-auto max-w-4xl px-4 py-6">{children}</main>
      <nav aria-label="Navigasi utama" className="fixed bottom-0 inset-x-0 z-30 border-t border-white/10 bg-primary text-primary-foreground md:hidden pb-[env(safe-area-inset-bottom)]">
        <ul className="grid grid-cols-3">
          {NAV.map((n) => {
            const on = n.match(loc);
            return (
              <li key={n.href}>
                <Link href={n.href} data-testid={`link-tab-${n.label.toLowerCase()}`} aria-current={on ? 'page' : undefined}
                  className={`flex flex-col items-center gap-1 py-2.5 text-xs transition-colors ${on ? 'text-accent' : 'text-primary-foreground/70'}`}>
                  <n.icon className="size-5" />
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

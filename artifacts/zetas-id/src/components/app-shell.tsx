import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowLeft, LayoutDashboard, Package, PackageSearch, Settings, LogOut, Sparkles } from 'lucide-react';
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
    <div className="min-h-[100dvh] bg-[#F4F6F9] pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0">
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between bg-primary px-4 text-primary-foreground shadow-sm md:hidden">
        {isOrderDetail ? (
          <Link href={backHref} data-testid="link-back" aria-label="Kembali ke pesanan"
            onClick={event => {
              if (window.history.length > 1) { event.preventDefault(); window.history.back(); }
            }} className="grid size-11 shrink-0 place-items-center rounded-xl hover:bg-white/10">
            <ArrowLeft aria-hidden="true" className="size-5" />
          </Link>
        ) : <Link href="/dashboard" data-testid="link-brand" aria-label="ZETAS.id beranda" className="flex items-center gap-2"><Brand className="size-9" /><span className="text-sm font-semibold tracking-tight">ZETAS.id</span></Link>}
        {isOrderDetail && <h1 className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-sm font-semibold">Detail Pesanan</h1>}
      </header>

      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[252px] flex-col bg-[#101E35] px-5 py-6 text-white md:flex">
        <Link href="/dashboard" data-testid="link-brand-desktop" aria-label="ZETAS.id beranda" className="mb-10 flex items-center gap-3 px-1">
          <Brand className="size-12 rounded-lg bg-white p-1" />
          <span className="text-[15px] font-bold tracking-tight">ZETAS.id</span>
        </Link>
        <p className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[.16em] text-slate-400">Workspace</p>
        <nav aria-label="Navigasi utama" className="space-y-1">
          {NAV.map(n => {
            const ActiveIcon = n.icon;
            return <Link key={n.href} href={n.href} data-testid={`link-nav-${n.label.toLowerCase()}`}
              aria-current={n.match(loc) ? 'page' : undefined}
              className={`flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors ${n.match(loc) ? 'bg-[#F27832] text-white shadow-[0_6px_16px_rgba(242,120,50,.2)]' : 'text-slate-300 hover:bg-white/[.07] hover:text-white'}`}>
              <ActiveIcon aria-hidden="true" className="size-[18px]" />{n.label}
            </Link>;
          })}
        </nav>
        <div className="mt-auto mb-16 rounded-2xl border border-white/10 bg-white/[.04] p-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold"><Sparkles className="size-4 text-[#F27832]" />Operasional Lazada</div>
          <p className="text-[11px] leading-5 text-slate-400">Pantau status pesanan digital dalam satu workspace.</p>
        </div>
      </aside>
      <button type="button" onClick={leave} disabled={busy} data-testid="button-logout"
        className="fixed right-3 top-1 z-50 flex min-h-11 items-center gap-2 rounded-lg px-2 text-xs font-medium text-white/80 transition-colors hover:bg-white/10 disabled:opacity-60 md:bottom-6 md:left-5 md:top-auto md:right-auto md:w-[212px] md:justify-start md:px-3 md:text-slate-300">
        <LogOut className="size-4" />{busy ? 'Keluar…' : 'Keluar'}
      </button>
      <div className="md:ml-[252px]">
        {error && <p role="alert" className="mx-auto max-w-[1240px] px-4 pt-3 text-sm text-destructive md:px-8">{error}</p>}
        <main className={`mx-auto max-w-[1240px] px-4 md:px-8 ${isOrderRoute ? 'py-4 md:py-8' : 'py-6 md:py-9'}`}>{children}</main>
      </div>
      <nav aria-label="Navigasi utama" className="fixed inset-x-0 bottom-0 z-30 border-t border-[#E4E8EE] bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-6px_24px_rgba(20,35,61,.08)] backdrop-blur md:hidden">
        <ul className="mx-auto grid max-w-lg grid-cols-3">
          {NAV.map(n => {
            const on = n.match(loc);
            const TabIcon = isOrderRoute && n.href === '/orders' ? Package : n.icon;
            return <li key={n.href}><Link href={n.href} data-testid={`link-tab-${n.label.toLowerCase()}`} aria-current={on ? 'page' : undefined}
              className={`relative flex min-h-[62px] flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors ${on ? 'text-[#E96B27]' : 'text-[#7A8492]'}`}>
              {on && <span aria-hidden="true" className="absolute top-0 h-[2px] w-9 rounded-b-full bg-[#F27832]" />}
              <TabIcon className="size-[19px]" />{n.label}
            </Link></li>;
          })}
        </ul>
      </nav>
    </div>
  );
}

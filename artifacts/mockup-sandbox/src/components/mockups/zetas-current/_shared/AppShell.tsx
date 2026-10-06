import type { ReactNode } from 'react';
import { ArrowLeft, LayoutDashboard, LogOut, Package, PackageSearch, Settings } from 'lucide-react';
import logo from './zetas-logo.png';

const NAV = [
  { href: '/dashboard', label: 'Ringkasan', icon: LayoutDashboard },
  { href: '/orders', label: 'Pesanan', icon: PackageSearch },
  { href: '/settings', label: 'Pengaturan', icon: Settings },
];

export function AppShell({ children, route }: { children: ReactNode; route: string }) {
  const isOrderRoute = route.startsWith('/orders');
  const isOrderDetail = /^\/orders\/.+/.test(route);
  const backHref = '/orders';
  const active = (href: string) => href === '/dashboard' ? route === '/' || route.startsWith('/dashboard') : route.startsWith(href);
  return (
    <div className={`min-h-screen pb-20 md:pb-0 ${isOrderRoute ? 'bg-[#F6F7FA]' : ''}`}>
      <header className="sticky top-0 z-30 bg-primary text-primary-foreground">
        <div className="relative mx-auto flex h-14 max-w-4xl items-center justify-between px-4">
          {isOrderDetail ? (
            <a href={backHref} data-testid="link-back" aria-label="Kembali ke pesanan" className="grid size-11 shrink-0 place-items-center rounded-lg text-primary-foreground transition-colors hover:bg-white/10"><ArrowLeft aria-hidden="true" className="size-5" /></a>
          ) : (
            <a href="/dashboard" data-testid="link-brand" aria-label="ZETAS.id beranda">
              <img src={logo} alt="ZETAS.id" width={200} height={200} className="block size-12 shrink-0 rounded-md object-contain" />
            </a>
          )}
          {isOrderDetail && <h1 className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-base font-semibold text-primary-foreground md:hidden">Detail Pesanan</h1>}
          <nav className="hidden md:flex items-center gap-1" aria-label="Navigasi utama">
            {NAV.map(n => <a key={n.href} href={n.href} data-testid={`link-nav-${n.label.toLowerCase()}`} aria-current={active(n.href) ? 'page' : undefined} className={`rounded-md px-3 py-1.5 text-sm transition-colors ${active(n.href) ? 'bg-white/15' : 'hover:bg-white/10'}`}>{n.label}</a>)}
          </nav>
          <button type="button" onClick={() => undefined} data-testid="button-logout" className="flex min-h-11 items-center gap-1.5 text-sm text-primary-foreground/80 hover:text-primary-foreground"><LogOut className="size-4" /> Keluar</button>
        </div>
      </header>
      <main className={`mx-auto max-w-4xl px-4 ${isOrderRoute ? 'py-4' : 'py-6'}`}>{children}</main>
      <nav aria-label="Navigasi utama" className="fixed bottom-0 inset-x-0 z-30 border-t border-white/10 bg-primary text-primary-foreground md:hidden pb-[env(safe-area-inset-bottom)]">
        <ul className="grid grid-cols-3">
          {NAV.map(n => {
            const on = active(n.href);
            const TabIcon = isOrderRoute && n.href === '/orders' ? Package : n.icon;
            return <li key={n.href}><a href={n.href} data-testid={`link-tab-${n.label.toLowerCase()}`} aria-current={on ? 'page' : undefined} className={`flex flex-col items-center gap-1 py-2.5 text-xs transition-colors ${on ? 'text-accent' : 'text-primary-foreground/70'}`}><TabIcon className="size-5" />{n.label}</a></li>;
          })}
        </ul>
      </nav>
    </div>
  );
}

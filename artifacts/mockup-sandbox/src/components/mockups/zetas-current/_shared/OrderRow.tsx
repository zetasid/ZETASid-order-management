import { ChevronRight, PackageOpen } from 'lucide-react';
import type { Order } from './fixtures';
import { orderMoney, providerMoney, rupiah, tanggal, waktuWib } from './format';
import { PaymentStatusBadge, ProviderStatus } from './Statuses';

export function OrderRow({ order, from, variant = 'default' }: { order: Order; from?: string; variant?: 'default' | 'orders' }) {
  const items = order.items ?? [];
  const href = `/orders/${order.id}${from ? `?from=${encodeURIComponent(from)}` : ''}`;
  if (variant === 'orders') {
    return (
      <a href={href} data-testid={`link-order-${order.id}`} className="flex min-h-24 items-center gap-3 rounded-2xl border border-[#E2E8F0] bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-[#CBD5E1] hover:bg-[#FCFDFE] active:scale-[0.99] sm:gap-4 sm:p-4">
        <div role="img" aria-label="Foto produk tidak tersedia dari data pesanan" className="grid size-14 shrink-0 place-items-center rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] text-[#64748B] sm:size-16"><PackageOpen aria-hidden="true" className="size-6" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <p className="line-clamp-2 min-w-0 break-words text-sm font-semibold leading-5 text-[#0F172A] sm:text-base">{order.productName?.trim() || 'Produk tidak tersedia'}</p>
            <div className="flex shrink-0 flex-col items-end gap-1 [&_[data-testid=status-pending]]:bg-[#FFF7ED] [&_[data-testid=status-pending]]:text-[#C2410C] [&_[data-testid=status-processing]]:bg-[#EFF6FF] [&_[data-testid=status-processing]]:text-[#2563EB] [&_[data-testid=status-completed]]:bg-[#F0FDF4] [&_[data-testid=status-completed]]:text-[#15803D] [&_[data-testid=status-cancelled]]:bg-[#FEF2F2] [&_[data-testid=status-cancelled]]:text-[#DC2626]">
              <ProviderStatus status={order.status} /><PaymentStatusBadge status={order.paymentStatus} />
            </div>
          </div>
          <p className="mt-1 truncate font-mono text-xs text-[#64748B]">#{order.marketplaceOrderId}</p>
          <div className="mt-2 flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="text-xs text-[#64748B]">{waktuWib(order.sourceCreatedAt ?? order.createdAt)}</span>
            <span className="font-mono text-sm font-semibold text-[#0F172A]">{order.syncedAt ? orderMoney(order.sourcePrice, order.currency, order.amount) : rupiah(order.amount)}</span>
          </div>
        </div>
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-[#94A3B8]" />
      </a>
    );
  }
  return (
    <a href={href} data-testid={`link-order-${order.id}`} className="flex items-center gap-2 md:gap-3 rounded-xl border bg-card p-3 md:p-4 transition-all hover:border-accent active:scale-[0.99] min-h-16">
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2 mb-1"><span className="text-xs font-mono text-muted-foreground truncate">#{order.marketplaceOrderId}</span><div className="shrink-0"><ProviderStatus status={order.status} source={order.lazadaStatuses} /></div></div>
        {items.length > 0 ? <ul className="space-y-0.5">{items.map(i => <li key={i.id} className="break-words"><p className="text-sm md:text-base font-semibold line-clamp-2">{i.productName}</p><p className="text-xs font-mono text-muted-foreground">Item {i.lazadaOrderItemId}</p>{order.syncedAt && <p className="hidden md:block text-xs text-muted-foreground">Variasi: {i.variation || 'Tidak tersedia'} · SKU: {i.sku || 'Tidak tersedia'} · Harga: {providerMoney(i.itemPrice, i.currency)}</p>}</li>)}</ul> : <><p className="text-sm md:text-base font-semibold line-clamp-2">{order.productName}</p><p className="text-xs text-muted-foreground">Item dan Digital Detail tidak tersedia.</p></>}
        <div className="mt-2 flex flex-col md:flex-row md:justify-between md:gap-x-2 text-xs md:text-sm text-muted-foreground"><span>{order.sourceCreatedAt ?? tanggal(order.createdAt)}</span><span className="font-mono text-foreground">{order.syncedAt ? providerMoney(order.sourcePrice, order.currency) : rupiah(order.amount)}</span></div>
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </a>
  );
}

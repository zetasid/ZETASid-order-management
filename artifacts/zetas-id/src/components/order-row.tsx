import { Link } from 'wouter';
import { ChevronRight } from 'lucide-react';
import type { Order } from '@workspace/api-client-react';
import { rupiah, tanggal, providerMoney } from '@/lib/format';
import { ProviderStatus } from './provider-status';

export function OrderRow({ order, from }: { order: Order; from?: string }) {
  const items = order.items ?? [];
  const href = `/orders/${order.id}${from ? `?from=${encodeURIComponent(from)}` : ''}`;
  return (
    <Link href={href} data-testid={`link-order-${order.id}`}
      className="flex items-center gap-2 md:gap-3 rounded-xl border bg-card p-3 md:p-4 transition-all hover:border-accent active:scale-[0.99] min-h-16">
      <div className="min-w-0 flex-1">
        {/* Order header: ID + Status */}
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="text-xs font-mono text-muted-foreground truncate">#{order.marketplaceOrderId}</span>
          <div className="shrink-0">
            <ProviderStatus status={order.status} source={order.lazadaStatuses} />
          </div>
        </div>
        {/* Product info */}
        {items.length > 0 ? (
          <ul className="space-y-0.5">
            {items.map((i) => (
              <li key={i.id} className="break-words">
                {/* Product name - truncate to 2 lines on mobile */}
                <p className="text-sm md:text-base font-semibold line-clamp-2">{i.productName}</p>
                {/* Item ID only - metadata hidden on mobile */}
                <p className="text-xs font-mono text-muted-foreground">Item {i.lazadaOrderItemId}</p>
                {/* Full metadata on desktop only */}
                {order.syncedAt && <p className="hidden md:block text-xs text-muted-foreground">
                  Variasi: {i.variation || 'Tidak tersedia'} · SKU: {i.sku || 'Tidak tersedia'} · Harga: {providerMoney(i.itemPrice, i.currency)}
                </p>}
              </li>
            ))}
          </ul>
        ) : (
          <>
            <p className="text-sm md:text-base font-semibold line-clamp-2">{order.productName}</p>
            <p className="text-xs text-muted-foreground">Item dan Digital Detail tidak tersedia.</p>
          </>
        )}
        {/* Footer: Date + Price (stacked on mobile, inline on desktop) */}
        <div className="mt-2 flex flex-col md:flex-row md:justify-between md:gap-x-2 text-xs md:text-sm text-muted-foreground">
          <span>{order.sourceCreatedAt ?? tanggal(order.createdAt)}</span>
          <span className="font-mono text-foreground">{order.syncedAt ? providerMoney(order.sourcePrice, order.currency) : rupiah(order.amount)}</span>
        </div>
      </div>
      {/* Chevron indicator */}
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

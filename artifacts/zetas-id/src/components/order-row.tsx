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
      className="flex items-center gap-3 rounded-xl border bg-card p-4 transition-all hover:border-accent active:scale-[0.99]">
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 break-all font-mono text-xs text-muted-foreground">#{order.marketplaceOrderId}</span>
          <ProviderStatus status={order.status} source={order.lazadaStatuses} />
        </div>
        {items.length > 0 ? (
          <ul className="mt-1 space-y-0.5">
            {items.map((i) => <li key={i.id} className="break-words">
              <p className="font-semibold">{i.productName}</p>
              <p className="break-all font-mono text-xs text-muted-foreground">Item {i.lazadaOrderItemId}</p>
              {order.syncedAt && <p className="text-xs text-muted-foreground">
                Variasi: {i.variation || 'Tidak tersedia'} · SKU: {i.sku || 'Tidak tersedia'} · Harga: {providerMoney(i.itemPrice, i.currency)}
              </p>}
            </li>)}
          </ul>
        ) : (
          <>
            <p className="mt-1 break-words font-semibold">{order.productName}</p>
            <p className="text-xs text-muted-foreground">Item dan Digital Detail tidak tersedia.</p>
          </>
        )}
        <div className="mt-0.5 flex flex-wrap justify-between gap-x-2 text-sm text-muted-foreground">
          <span>{order.sourceCreatedAt ?? tanggal(order.createdAt)}</span>
          <span className="font-mono text-foreground">{order.syncedAt ? providerMoney(order.sourcePrice, order.currency) : rupiah(order.amount)}</span>
        </div>
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

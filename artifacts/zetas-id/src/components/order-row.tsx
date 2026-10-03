import { Link } from 'wouter';
import { ChevronRight } from 'lucide-react';
import type { Order } from '@workspace/api-client-react';
import { rupiah, tanggal } from '@/lib/format';
import { StatusBadge } from '@/components/states';

export function OrderRow({ order }: { order: Order }) {
  return (
    <Link href={`/orders/${order.id}`} data-testid={`link-order-${order.id}`}
      className="flex items-center gap-3 rounded-xl border bg-card p-4 transition-all hover:border-accent active:scale-[0.99]">
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-xs text-muted-foreground truncate">#{order.marketplaceOrderId}</span>
          <StatusBadge status={order.status} />
        </div>
        <p className="mt-1 truncate font-semibold">{order.productName}</p>
        <div className="mt-0.5 flex justify-between gap-2 text-sm text-muted-foreground">
          <span>{tanggal(order.createdAt)}</span>
          <span className="font-mono text-foreground">{rupiah(order.amount)}</span>
        </div>
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

import { Link } from 'wouter';
import { ChevronRight } from 'lucide-react';
import type { Order } from '@workspace/api-client-react';
import { orderMoney, rupiah, tanggal, providerMoney, waktuWib } from '@/lib/format';
import { ProviderStatus } from './provider-status';
import { PaymentStatusBadge } from './payment-status';
import { ProductImage } from './product-image';

export function OrderRow({ order, from, variant = 'default' }: { order: Order; from?: string; variant?: 'default' | 'orders' }) {
  const items = order.items ?? [];
  const itemStatuses = items.map(item => item.sourceStatus).filter((status): status is string => typeof status === 'string' && status.length > 0);
  const statusSource = itemStatuses.length ? itemStatuses : order.lazadaStatuses;
  const href = `/orders/${order.id}${from ? `?from=${encodeURIComponent(from)}` : ''}`;

  if (variant === 'orders') {
    return (
      <Link href={href} data-testid={`link-order-${order.id}`}
        className="surface-card flex min-h-24 items-center gap-3 rounded-2xl p-3 active:scale-[.99] sm:gap-4 sm:p-4">
        <ProductImage
          src={items[0]?.productMainImage}
          alt={`Foto produk: ${items[0]?.productName || order.productName || 'produk'}`}
          testId={`img-product-${order.id}`}
          imageClassName="size-14 shrink-0 rounded-xl border border-[#E4E8EE] object-cover sm:size-16"
          fallbackClassName="grid size-14 shrink-0 place-items-center rounded-xl border border-[#E4E8EE] bg-[#F4F6F9] text-[#738094] sm:size-16"
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <p className="line-clamp-2 min-w-0 break-words text-sm font-semibold leading-5 text-[#14213A] sm:text-base">{order.productName?.trim() || 'Produk tidak tersedia'}</p>
            <div className="flex shrink-0 flex-col items-end gap-1 [&_[data-testid=status-pending]]:bg-[#FFF7ED] [&_[data-testid=status-pending]]:text-[#C2410C] [&_[data-testid=status-processing]]:bg-[#EFF6FF] [&_[data-testid=status-processing]]:text-[#2563EB] [&_[data-testid=status-completed]]:bg-[#F0FDF4] [&_[data-testid=status-completed]]:text-[#15803D] [&_[data-testid=status-cancelled]]:bg-[#FEF2F2] [&_[data-testid=status-cancelled]]:text-[#DC2626]">
              <ProviderStatus status={order.status} source={statusSource} paymentStatus={order.paymentStatus} />
              <PaymentStatusBadge status={order.paymentStatus} />
            </div>
          </div>
          <p className="mt-1 truncate font-mono text-xs tracking-[.01em] text-[#64748B]">#{order.marketplaceOrderId}</p>
          <div className="mt-2 flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="text-xs text-[#778396]">{waktuWib(order.sourceCreatedAt ?? order.createdAt)}</span>
            <span className="font-mono text-sm font-semibold text-[#14213A]">
              {order.syncedAt ? orderMoney(order.sourcePrice, order.currency, order.amount) : rupiah(order.amount)}
            </span>
          </div>
        </div>
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-[#94A3B8]" />
      </Link>
    );
  }

  return (
    <Link href={href} data-testid={`link-order-${order.id}`}
      className="surface-card flex items-center gap-2 md:gap-3 rounded-2xl p-3 md:p-4 active:scale-[.99] min-h-[76px]">
      <div className="min-w-0 flex-1">
        {/* Order header: ID + Status */}
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="text-[11px] font-mono text-muted-foreground truncate">#{order.marketplaceOrderId}</span>
          <div className="shrink-0">
            <ProviderStatus status={order.status} source={statusSource} paymentStatus={order.paymentStatus} />
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

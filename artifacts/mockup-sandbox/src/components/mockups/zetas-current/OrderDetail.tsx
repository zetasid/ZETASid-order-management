import './_group.css';
import type { ReactNode } from 'react';
import { BadgeCheck, CalendarClock, CircleX, ClipboardList, Clock3, CreditCard, Info, Package, PackageOpen, ReceiptText, Send } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { AppShell } from './_shared/AppShell';
import { CopyValue, DigitalDetail } from './_shared/CopyDetail';
import { orders } from './_shared/fixtures';
import { orderMoney, waktuWib } from './_shared/format';
import { paymentStatusLabel } from './_shared/Statuses';

const STATUS_VIEW = {
  pending: { title: 'Pesanan Menunggu', description: 'Pesanan siap untuk diproses.', icon: Clock3, tone: 'border-[#FED7AA] bg-[#FFF3E8] text-[#B45309]', iconTone: 'bg-[#F97316] text-white' },
  processing: { title: 'Pesanan Diproses', description: 'Pesanan sedang diproses.', icon: Clock3, tone: 'border-[#BFDBFE] bg-[#EFF6FF] text-[#1D4ED8]', iconTone: 'bg-[#3B82F6] text-white' },
  completed: { title: 'Pesanan Selesai', description: 'Pesanan telah selesai diproses.', icon: BadgeCheck, tone: 'border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]', iconTone: 'bg-[#22C55E] text-white' },
  cancelled: { title: 'Pesanan Dibatalkan', description: 'Pesanan ini telah dibatalkan oleh sistem Lazada.', icon: CircleX, tone: 'border-[#FECACA] bg-[#FEF0F0] text-[#B91C1C]', iconTone: 'bg-[#EF4444] text-white' },
} as const;

function InfoRow({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return <div className="grid min-h-11 grid-cols-[16px_72px_minmax(0,1fr)] items-center gap-2 border-b border-[#EEF0F4] py-1.5 last:border-b-0"><Icon aria-hidden="true" className="size-3.5 text-[#64748B]" /><dt className="text-[11px] leading-4 text-[#64748B]">{label}</dt><dd className="min-w-0 text-xs font-medium text-[#0F172A]">{children}</dd></div>;
}

function OrderDetailPage() {
  const o = orders[1];
  const items = o.items ?? [];
  const statusView = STATUS_VIEW[o.status];
  const StatusIcon = statusView.icon;
  return (
    <div className="min-h-screen -mx-4 -my-4 bg-[#F6F7FA] px-4 py-2 pb-[calc(6rem+env(safe-area-inset-bottom))] md:mx-0 md:my-0 md:bg-transparent md:px-0 md:py-4 md:pb-8">
      <div className="mx-auto max-w-4xl space-y-3">
        <div className="space-y-3">
          <section aria-labelledby="order-status-heading" className={`flex items-center gap-3 rounded-xl border px-3 py-3 ${statusView.tone}`}><span className={`grid size-10 shrink-0 place-items-center rounded-full ${statusView.iconTone}`}><StatusIcon aria-hidden="true" className="size-5" /></span><div className="min-w-0"><h2 id="order-status-heading" className="text-sm font-semibold">{statusView.title}</h2><p className="mt-0.5 text-[11px] leading-4 opacity-90">{statusView.description}</p></div></section>
          <section aria-labelledby="order-info-heading" className="rounded-xl border border-[#E5E7EB] bg-white px-3.5 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <h2 id="order-info-heading" className="mb-1 text-sm font-semibold text-[#0F172A]">Informasi Pesanan</h2>
            <dl>
              <InfoRow icon={ClipboardList} label="Order ID"><CopyValue id="order-id" label="Order ID" value={o.marketplaceOrderId} /></InfoRow>
              <InfoRow icon={CreditCard} label="Pembayaran">{paymentStatusLabel(o.paymentStatus)}</InfoRow>
              {items.map((item, index) => <InfoRow key={`info-${item.id}`} icon={Package} label={items.length > 1 ? `Item ID ${index + 1}` : 'Item ID'}><CopyValue id={`item-info-${item.id}`} label="Item ID" value={item.lazadaOrderItemId} /></InfoRow>)}
              <InfoRow icon={CalendarClock} label="Waktu order">{waktuWib(o.sourceCreatedAt ?? o.createdAt)}</InfoRow>
              <InfoRow icon={ReceiptText} label="Nilai transaksi">{orderMoney(o.sourcePrice, o.currency, o.amount)}</InfoRow>
            </dl>
            {(o.paymentStatus !== 'confirmed' || items.some(item => item.sourceStatus !== 'pending')) && <p role="note" className="mt-2 rounded-lg border border-[#FED7AA] bg-[#FFF7ED] px-3 py-2 text-[11px] leading-4 text-[#9A3412]">{o.paymentStatus !== 'confirmed' ? 'Pengiriman digital dinonaktifkan sampai status pembayaran dikonfirmasi oleh Lazada.' : 'Status item Lazada belum memenuhi syarat untuk pengiriman digital.'}</p>}
          </section>
          <section aria-labelledby="order-products-heading" className="space-y-2">
            <h2 id="order-products-heading" className="px-0.5 text-sm font-semibold text-[#0F172A]">Produk</h2>
            <ul className="space-y-2">{items.map(i => <li key={i.id} data-testid={`item-${i.id}`} className="rounded-xl border border-[#E5E7EB] bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)]"><div className="flex min-w-0 items-center gap-3"><div role="img" aria-label="Foto produk tidak tersedia dari data pesanan" className="grid size-12 shrink-0 place-items-center rounded-lg border border-[#E5E7EB] bg-[#F8FAFC] text-[#64748B]"><PackageOpen aria-hidden="true" className="size-5" /></div><div className="min-w-0 flex-1"><h3 className="break-words text-xs font-semibold leading-4 text-[#0F172A]">{i.productName}</h3><p className="mt-1 inline-flex max-w-full rounded-md bg-[#FFF4E9] px-2 py-1 text-[10px] leading-4 text-[#7C4A24]"><span className="truncate">Variasi: {i.variation?.trim() || 'Tidak tersedia'}</span></p></div></div></li>)}</ul>
          </section>
          <section aria-labelledby="digital-detail-heading" className="rounded-xl border border-[#E5E7EB] bg-white px-3.5 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <h2 id="digital-detail-heading" className="mb-2 text-sm font-semibold text-[#0F172A]">Detail Digital</h2>
            <div className="space-y-2">{items.map(i => <div key={`digital-${i.id}`} className="min-w-0">{items.length > 1 && <p className="mb-1 text-[11px] font-medium text-[#64748B]">{i.productName}</p>}<DigitalDetail id={i.id} value={i.digitalDetail} /></div>)}</div>
            {o.syncedAt && o.paymentStatus === 'confirmed' && o.status === 'pending' && items.length > 0 && items.every(item => item.sourceStatus === 'pending') && <button type="button" data-testid="button-deliver-digital" className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-[#F97316] bg-[#F97316] px-5 font-semibold text-white hover:bg-[#EA580C]"><Send aria-hidden="true" className="size-4" />Kirim Digital</button>}
          </section>
          {items.some(i => o.syncedAt && i.extraAttributes) && <details className="rounded-xl border border-[#E5E7EB] bg-white"><summary className="flex min-h-11 cursor-pointer items-center px-3.5 text-xs font-medium text-[#64748B]">Informasi tambahan</summary><div className="space-y-3 px-3.5 pb-3.5">{items.filter(i => i.extraAttributes).map(i => <pre key={`extra-${i.id}`} className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-[#F8FAFC] p-2 font-mono text-[10px] text-[#64748B]">{i.extraAttributes}</pre>)}</div></details>}
        </div>
      </div>
    </div>
  );
}

export default function OrderDetail() {
  return <AppShell route="/orders/order-1002"><OrderDetailPage /></AppShell>;
}

import { useListOrders, getListOrdersQueryKey } from '@workspace/api-client-react';
import { usePageMeta } from '@/hooks/use-page-meta';
import { EmptyState, ErrorState, ListSkeleton, PageHeading } from '@/components/states';
import { OrderRow } from '@/components/order-row';

export default function Orders() {
  usePageMeta('Daftar Pesanan', 'Lihat seluruh pesanan digital Lazada Anda.');
  const q = useListOrders({ query: { queryKey: getListOrdersQueryKey() } });
  return (
    <>
      <PageHeading title="Pesanan" sub="Daftar pesanan digital. Hanya untuk dilihat, tanpa perubahan." />
      {q.isLoading && <ListSkeleton rows={4} />}
      {q.isError && <ErrorState text="Daftar pesanan belum bisa diambil." onRetry={() => q.refetch()} />}
      {q.data && q.data.length === 0 && (
        <EmptyState title="Belum ada pesanan" text="Belum ada pesanan yang tersimpan. Daftar akan terisi saat data pesanan tersedia." />
      )}
      {q.data && q.data.length > 0 && (
        <div data-testid="list-orders" className="space-y-3">{q.data.map((o) => <OrderRow key={o.id} order={o} />)}</div>
      )}
    </>
  );
}

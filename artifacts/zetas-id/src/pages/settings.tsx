import { useHealthCheck, getHealthCheckQueryKey } from '@workspace/api-client-react';
import { usePageMeta } from '@/hooks/use-page-meta';
import { ErrorState, PageHeading } from '@/components/states';
import { Skeleton } from '@/components/ui/skeleton';
import { LazadaConnection } from '@/components/lazada-connection';

export default function Settings() {
  usePageMeta('Pengaturan', 'Informasi dasar aplikasi dan status server ZETAS.id.');
  const q = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey() } });
  return (
    <>
      <PageHeading title="Pengaturan" sub="Informasi aplikasi dan koneksi Lazada Testing." />
      <LazadaConnection />
      <section className="mb-4 rounded-xl border bg-card p-4">
        <h2 className="mb-2 font-semibold">Status server</h2>
        {q.isLoading && <Skeleton data-testid="state-loading" className="h-6 w-40" />}
        {q.isError && <ErrorState text="Server tidak dapat dihubungi." onRetry={() => q.refetch()} />}
        {q.data && (
          <p className="flex items-center gap-2" data-testid="text-health">
            <span className="size-2.5 rounded-full bg-[hsl(160_40%_35%)]" />
            Server aktif <span className="font-mono text-sm text-muted-foreground">({q.data.status})</span>
          </p>
        )}
      </section>
      <section className="rounded-xl border bg-card p-4">
        <h2 className="mb-2 font-semibold">Tentang aplikasi</h2>
        <dl className="divide-y text-sm">
          {[
            ['Aplikasi', 'ZETAS.id'],
            ['Fase', 'Lazada Testing & OAuth'],
            ['Integrasi', 'Lazada Testing; tanpa pemrosesan order'],
            ['Autentikasi', 'Login lokal PostgreSQL'],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 py-2.5">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="text-right">{v}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}

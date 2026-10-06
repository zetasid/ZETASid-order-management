import { Activity, CircleHelp, Info, ShieldCheck, UserRound } from 'lucide-react';
import { useHealthCheck, getHealthCheckQueryKey } from '@workspace/api-client-react';
import { usePageMeta } from '@/hooks/use-page-meta';
import { ErrorState, PageHeading } from '@/components/states';
import { Skeleton } from '@/components/ui/skeleton';
import { LazadaConnection } from '@/components/lazada-connection';
import { useAuth } from '@/hooks/use-auth';

export default function Settings() {
  usePageMeta('Pengaturan', 'Informasi dasar aplikasi dan status server ZETAS.id.');
  const { user } = useAuth();
  const q = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey() } });
  return (
    <div className="space-y-5">
      <PageHeading title="Pengaturan" sub="Kelola pengaturan aplikasi ZETAS.id." />
      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="settings-account-heading" style={{ animationDelay: '0ms' }} className="surface-card stagger-in rounded-2xl p-4 sm:p-5">
          <div className="mb-4 flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#EEF2F8] text-[#14213A]">
              <UserRound aria-hidden="true" className="size-5" />
            </span>
            <div className="min-w-0">
              <h2 id="settings-account-heading" className="text-[15px] font-bold tracking-[-.01em] text-[#14213A]">Akun operator</h2>
              <p className="mt-0.5 text-xs text-[#718096]">Informasi akun yang sedang digunakan.</p>
            </div>
          </div>
          <div className="flex min-w-0 items-center justify-between gap-3 rounded-xl bg-[#F7F8FA] px-3 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-white text-[#53647B]">
                <UserRound aria-hidden="true" className="size-5" />
              </span>
              <div className="min-w-0">
                <p data-testid="text-operator-name" className="truncate text-sm font-semibold text-[#17263E]">
                  {user?.displayName || user?.email || 'Informasi akun tidak tersedia'}
                </p>
                {user?.displayName && <p data-testid="text-operator-email" className="mt-0.5 break-all text-xs text-[#718096]">{user.email}</p>}
              </div>
            </div>
            {user && (
              <span data-testid="status-account-session" className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800">
                <ShieldCheck aria-hidden="true" className="size-3.5" />Sesi aktif
              </span>
            )}
          </div>
        </section>

        <section aria-labelledby="settings-system-heading" style={{ animationDelay: '45ms' }} className="surface-card stagger-in rounded-2xl p-4 sm:p-5">
          <div className="mb-4 flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#EEF2F8] text-[#14213A]">
              <Activity aria-hidden="true" className="size-5" />
            </span>
            <div>
              <h2 id="settings-system-heading" className="text-[15px] font-bold tracking-[-.01em] text-[#14213A]">Status sistem</h2>
              <p className="mt-0.5 text-xs text-[#718096]">Ketersediaan layanan aplikasi.</p>
            </div>
          </div>
          <div className="min-h-[60px] rounded-xl bg-[#F7F8FA] px-3 py-3">
            {q.isLoading && <Skeleton data-testid="state-loading" className="skeleton-shimmer h-8 w-44 rounded-lg" />}
            {q.isError && <ErrorState text="Server tidak dapat dihubungi." onRetry={() => q.refetch()} />}
            {q.data && (
              <p className="flex min-h-8 flex-wrap items-center gap-2 text-sm font-semibold text-[#17263E]" data-testid="text-health">
                <span aria-hidden="true" className="health-dot-enter size-2.5 rounded-full bg-emerald-500" />
                Server aktif
                <span className="rounded-md bg-white px-2 py-1 font-mono text-xs font-medium text-[#687587]">{q.data.status}</span>
              </p>
            )}
          </div>
        </section>

        <div style={{ animationDelay: '90ms' }} className="stagger-in lg:col-span-2">
          <LazadaConnection />
        </div>

        <section aria-labelledby="settings-about-heading" style={{ animationDelay: '135ms' }} className="surface-card stagger-in rounded-2xl p-4 sm:p-5">
          <div className="mb-4 flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#FFF1E8] text-[#D95D1E]">
              <Info aria-hidden="true" className="size-5" />
            </span>
            <div>
              <h2 id="settings-about-heading" className="text-[15px] font-bold tracking-[-.01em] text-[#14213A]">Tentang aplikasi</h2>
              <p className="mt-0.5 text-xs text-[#718096]">Informasi versi dan lingkungan ZETAS.id.</p>
            </div>
          </div>
          <dl className="divide-y divide-[#E9EDF2] text-sm">
            <div className="flex items-center justify-between gap-4 py-3">
              <dt className="text-[#718096]">Aplikasi</dt>
              <dd data-testid="text-app-name" className="font-semibold text-[#17263E]">ZETAS.id</dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-3">
              <dt className="text-[#718096]">Versi</dt>
              <dd data-testid="text-app-version" className="font-mono text-xs font-medium text-[#53647B]">1.0.0</dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-3">
              <dt className="text-[#718096]">Lingkungan Lazada</dt>
              <dd className="rounded-full bg-[#FFF1E8] px-2.5 py-1 text-xs font-semibold text-[#B94D18]">Testing</dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="settings-help-heading" style={{ animationDelay: '180ms' }} className="surface-card stagger-in rounded-2xl p-4 sm:p-5">
          <div className="mb-4 flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#EEF2F8] text-[#14213A]">
              <CircleHelp aria-hidden="true" className="size-5" />
            </span>
            <div>
              <h2 id="settings-help-heading" className="text-[15px] font-bold tracking-[-.01em] text-[#14213A]">Bantuan</h2>
              <p className="mt-0.5 text-xs text-[#718096]">Panduan penggunaan dan informasi aplikasi.</p>
            </div>
          </div>
          <p className="rounded-xl bg-[#F7F8FA] px-3 py-3 text-sm leading-6 text-[#53647B]">
            Informasi koneksi dan status aplikasi tersedia di halaman ini. Untuk proses pesanan, buka menu Pesanan.
          </p>
        </section>
      </div>
    </div>
  );
}

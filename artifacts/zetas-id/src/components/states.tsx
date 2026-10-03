import type { ReactNode } from 'react';
import { AlertTriangle, Inbox } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { STATUS_LABEL } from '@/lib/format';

export function PageHeading({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-5">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground mt-1">{sub}</p>
    </div>
  );
}

const TONE = {
  pending: 'bg-accent/25 text-foreground',
  processing: 'bg-primary/10 text-primary',
  completed: 'bg-[hsl(160_40%_35%/0.15)] text-[hsl(160_45%_24%)]',
  cancelled: 'bg-destructive/10 text-destructive',
} as const;

export function StatusBadge({ status }: { status: keyof typeof TONE }) {
  return (
    <span data-testid={`status-${status}`} className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function EmptyState({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <div data-testid="state-empty" className="rounded-xl border border-dashed border-input bg-card px-6 py-10 text-center">
      <div className="mx-auto mb-3 grid size-11 place-items-center rounded-full bg-muted"><Inbox className="size-5 text-muted-foreground" /></div>
      <p className="font-semibold">{title}</p>
      <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">{text}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div role="alert" data-testid="state-error" className="rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-8 text-center">
      <AlertTriangle className="mx-auto mb-2 size-6 text-destructive" />
      <p className="font-semibold">Gagal memuat data</p>
      <p className="mt-1 text-sm text-muted-foreground">{text}</p>
      <button type="button" onClick={onRetry} data-testid="button-retry"
        className="mt-4 min-h-11 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-transform active:scale-95">
        Coba lagi
      </button>
    </div>
  );
}

export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div data-testid="state-loading" aria-busy="true" className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
    </div>
  );
}

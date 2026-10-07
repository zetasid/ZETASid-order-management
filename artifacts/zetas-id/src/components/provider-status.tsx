import type { Order } from '@workspace/api-client-react';
import { StatusBadge } from './states';
import { isKnownLazadaStatus, lazadaStatusesLabel } from '@/lib/lazada-status-label';

export function ProviderStatus({ status, source, paymentStatus }: {
  status: Order['status'];
  source?: string | string[] | null;
  paymentStatus?: Order['paymentStatus'];
}) {
  const rawStatuses = (Array.isArray(source) ? source : [source]).filter((value): value is string => typeof value === 'string');
  const text = lazadaStatusesLabel(source, paymentStatus);
  const unmapped = rawStatuses.some(value => !isKnownLazadaStatus(value));
  return text ? <span className="max-w-full break-words rounded-md border bg-background px-2 py-1 font-mono text-xs text-foreground"
    title={status === null || unmapped ? "Status Lazada belum dipetakan; nilai asli tetap ditampilkan" : `Status asli Lazada: ${rawStatuses.join(', ')}`}>{text}</span>
    : status === null ? <span className="text-xs text-muted-foreground">Status belum dipetakan</span> : <StatusBadge status={status} />;
}
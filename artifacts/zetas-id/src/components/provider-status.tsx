import type { Order } from '@workspace/api-client-react';
import { StatusBadge } from './states';

export function ProviderStatus({ status, source }: { status: Order['status']; source?: string | string[] | null }) {
  const text = Array.isArray(source) ? source.join(', ') : source;
  return text ? <span className="max-w-full break-words rounded-md border bg-background px-2 py-1 font-mono text-xs text-foreground"
    title={status === null ? "Status Lazada belum dipetakan; hanya ditampilkan di Semua" : "Status asli response Lazada"}>{text}</span>
    : status === null ? <span className="text-xs text-muted-foreground">Status belum dipetakan</span> : <StatusBadge status={status} />;
}
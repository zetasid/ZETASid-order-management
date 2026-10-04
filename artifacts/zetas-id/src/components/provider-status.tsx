import type { Order } from '@workspace/api-client-react';
import { StatusBadge } from './states';

export function ProviderStatus({ status, source }: { status: Order['status']; source?: string | string[] | null }) {
  const text = Array.isArray(source) ? source.join(', ') : source;
  return text ? <span className="max-w-full break-words rounded-md border bg-background px-2 py-1 font-mono text-xs text-foreground"
    title="Status asli response Lazada">{text}</span> : <StatusBadge status={status} />;
}
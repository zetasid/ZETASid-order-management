import { useEffect, useRef, useState } from 'react';
import { Check, Coins, Copy, Info, Phone, Tag } from 'lucide-react';

function readableFieldName(key: string) {
  const normalized = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
  const known = new Map([
    ['phone', 'Nomor tujuan'],
    ['mobile', 'Nomor tujuan'],
    ['phone number', 'Nomor tujuan'],
    ['mobile number', 'Nomor tujuan'],
    ['msisdn', 'Nomor tujuan'],
    ['user id', 'User ID'],
    ['server id', 'Server ID'],
    ['nominal', 'Nominal'],
    ['amount', 'Nominal'],
  ]);
  const mapped = known.get(normalized.toLowerCase());
  if (mapped) return mapped;
  return normalized.split(/\s+/).map(word => {
    const lower = word.toLowerCase();
    if (lower === 'id') return 'ID';
    if (lower === 'sku') return 'SKU';
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join(' ');
}

function displayFieldValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.trim() ? value : null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value, null, 2) ?? null;
  } catch {
    return null;
  }
}

function digitalFields(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed === null || parsed === undefined) return [];
    if (Array.isArray(parsed)) {
      return parsed.map((item, index) => ({
        label: `Data tujuan ${index + 1}`,
        value: displayFieldValue(item),
      }));
    }
    if (typeof parsed === 'object') {
      return Object.entries(parsed as Record<string, unknown>).map(([key, item]) => ({
        label: readableFieldName(key),
        value: displayFieldValue(item),
      }));
    }
    if (typeof parsed === 'string') return [{ label: 'Data tujuan', value: parsed.trim() || null }];
  } catch {
    // Plain text is already the exact digital detail supplied by the API.
  }
  return [{ label: 'Data tujuan', value }];
}

export function CopyValue({ value, id, label }: { value: string | null; id: string; label: string }) {
  const [message, setMessage] = useState('');
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);
  const textRef = useRef<HTMLSpanElement>(null);
  const available = value !== null && value.trim() !== '';

  useEffect(() => {
    setMessage('');
    setCopied(false);
    setManual(false);
  }, [value]);

  const selectText = () => {
    if (!textRef.current) return;
    const range = document.createRange();
    range.selectNodeContents(textRef.current);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  const copy = async () => {
    if (!available || value === null) return;
    if (!navigator.clipboard?.writeText) {
      setManual(true);
      setCopied(false);
      setMessage('Salin otomatis tidak tersedia. Teks dipilih untuk disalin manual.');
      selectText();
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setManual(false);
      setMessage(`${label} berhasil disalin.`);
    } catch {
      setCopied(false);
      setManual(true);
      setMessage('Gagal menyalin. Teks dipilih untuk disalin manual.');
      selectText();
    }
  };

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <span ref={textRef} tabIndex={available ? 0 : undefined}
        className="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-xs text-[#0F172A]">
        {available ? value : 'Tidak tersedia'}
      </span>
      {available && (
        <button type="button" onClick={copy} data-testid={`button-copy-${id}`} aria-label={`Salin ${label}`}
          className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-md border border-[#E2E8F0] bg-white px-2 text-[11px] font-medium text-[#1E293B] transition-colors hover:bg-[#F8FAFC] active:bg-[#F1F5F9]">
          {copied ? <Check aria-hidden="true" className="size-3.5 text-[#16A34A]" /> : <Copy aria-hidden="true" className="size-3.5" />}
          Salin
        </button>
      )}
      <span aria-live="polite" role="status" data-testid={`text-copy-status-${id}`}
        className={`w-full text-xs ${copied ? 'text-[#15803D]' : 'text-[#64748B]'}`}>{message}</span>
      {manual && <span className="sr-only">Mode salin manual</span>}
    </div>
  );
}

export function DigitalDetail({ value, id }: { value: string | null; id: string }) {
  if (value === null || value.trim() === '') {
    return (
      <dl data-testid={`text-detail-empty-${id}`} className="space-y-1">
        <div className="grid min-h-11 grid-cols-[16px_72px_minmax(0,1fr)] items-center gap-2 border-b border-[#EEF0F4] py-1 last:border-b-0">
          <Phone aria-hidden="true" className="size-3.5 text-[#64748B]" />
          <dt className="text-[11px] leading-4 text-[#64748B]">Nomor tujuan</dt>
          <dd><CopyValue value={null} id={id} label="Nomor tujuan" /></dd>
        </div>
      </dl>
    );
  }
  const fields = digitalFields(value);
  if (fields.length === 0) {
    return (
      <dl data-testid={`text-detail-empty-${id}`} className="space-y-1">
        <div className="grid min-h-11 grid-cols-[16px_72px_minmax(0,1fr)] items-center gap-2 border-b border-[#EEF0F4] py-1 last:border-b-0">
          <Phone aria-hidden="true" className="size-3.5 text-[#64748B]" />
          <dt className="text-[11px] leading-4 text-[#64748B]">Nomor tujuan</dt>
          <dd><CopyValue value={null} id={id} label="Nomor tujuan" /></dd>
        </div>
      </dl>
    );
  }

  return (
    <dl data-testid={`text-detail-${id}`} className="space-y-0">
      {fields.map((field, index) => {
        const fieldId = index === 0 ? id : `${id}-${index}`;
        const normalizedLabel = field.label.toLowerCase();
        const Icon = normalizedLabel.includes('nomor') || normalizedLabel.includes('phone')
          ? Phone
          : normalizedLabel.includes('nominal') || normalizedLabel.includes('amount')
            ? Coins
            : normalizedLabel.includes('variasi') || normalizedLabel.includes('operator')
              ? Tag
              : Info;
        return (
          <div key={`${field.label}-${index}`} className="grid min-h-11 grid-cols-[16px_72px_minmax(0,1fr)] items-center gap-2 border-b border-[#EEF0F4] py-1 last:border-b-0">
            <Icon aria-hidden="true" className="size-3.5 text-[#64748B]" />
            <dt className="break-words text-[11px] leading-4 text-[#64748B]">{field.label}</dt>
            <dd className="min-w-0"><CopyValue value={field.value} id={fieldId} label={field.label} /></dd>
          </div>
        );
      })}
    </dl>
  );
}

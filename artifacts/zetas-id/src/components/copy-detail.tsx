import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';

export function DigitalDetail({ value, id }: { value: string | null; id: string }) {
  const [msg, setMsg] = useState('');
  const [ok, setOk] = useState(false);
  const [manual, setManual] = useState(false);
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => { setMsg(''); setOk(false); setManual(false); }, [value]);
  if (value === null || value.trim() === '') {
    return <p className="text-sm text-muted-foreground" data-testid={`text-detail-empty-${id}`}>Digital Detail belum tersedia.</p>;
  }
  const select = () => {
    const el = ref.current;
    if (!el) return;
    const r = document.createRange();
    r.selectNodeContents(el);
    const s = window.getSelection();
    s?.removeAllRanges();
    s?.addRange(r);
  };
  const copy = async () => {
    if (!navigator.clipboard?.writeText) {
      setManual(true); setOk(false);
      setMsg('Salin otomatis tidak tersedia. Teks dipilih, salin secara manual.');
      select();
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setOk(true); setManual(false); setMsg('Digital Detail berhasil disalin.');
    } catch {
      setOk(false); setManual(true);
      setMsg('Gagal menyalin. Teks dipilih, salin secara manual.');
      select();
    }
  };
  return (
    <div>
      <pre ref={ref} data-testid={`text-detail-${id}`} tabIndex={0}
        className="max-h-60 select-all overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-3 font-mono text-sm">{value}</pre>
      <button type="button" onClick={copy} data-testid={`button-copy-${id}`}
        className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground active:scale-95">
        {ok ? <Check className="size-4" /> : <Copy className="size-4" />} Salin Digital Detail
      </button>
      <p aria-live="polite" role="status" data-testid={`text-copy-status-${id}`}
        className={`mt-1 text-sm ${ok ? 'text-[hsl(160_45%_24%)]' : 'text-destructive'}`}>{msg}</p>
      {manual && <span className="sr-only">Mode salin manual</span>}
    </div>
  );
}

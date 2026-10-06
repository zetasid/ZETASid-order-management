import { useState } from 'react';
import { PackageOpen } from 'lucide-react';
import { safeProductImageUrl } from '@/lib/product-image';

type ProductImageProps = {
  src: unknown;
  alt: string;
  testId: string;
  imageClassName: string;
  fallbackClassName: string;
};

export function ProductImage({ src, alt, testId, imageClassName, fallbackClassName }: ProductImageProps) {
  const safeSrc = safeProductImageUrl(src);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (!safeSrc || failedSrc === safeSrc) {
    return (
      <div role="img" aria-label="Foto produk tidak tersedia" data-testid={testId} className={fallbackClassName}>
        <PackageOpen aria-hidden="true" className="size-5" />
      </div>
    );
  }

  return (
    <img
      src={safeSrc}
      alt={alt || 'Foto produk'}
      data-testid={testId}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailedSrc(safeSrc)}
      className={imageClassName}
    />
  );
}

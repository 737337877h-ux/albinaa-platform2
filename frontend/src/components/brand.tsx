'use client';
import { useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * شعار "البناء الراقي".
 * عند توفر الشعار الرسمي: ضع الملف في frontend/public/logo.svg وسيُعرض تلقائيًا؛
 * حتى ذلك الحين تُعرض علامة اللبنات المؤقتة (نفس هوية الألوان).
 */
export function BrickMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn('h-7 w-7', className)} aria-hidden>
      <rect x="2" y="14" width="9" height="6" rx="1" fill="#E8A33D" />
      <rect x="13" y="14" width="9" height="6" rx="1" fill="#177470" />
      <rect x="7" y="6" width="10" height="6" rx="1" fill="#0F5C5A" />
    </svg>
  );
}

export function BrandLogo({ className }: { className?: string }) {
  const [fallback, setFallback] = useState(false);
  if (fallback) return <BrickMark className={className} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo.svg"
      alt="شعار البناء الراقي"
      className={cn('h-7 w-7 object-contain', className)}
      onError={() => setFallback(true)}
    />
  );
}

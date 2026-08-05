'use client';
import Image from 'next/image';
import { cn } from '@/lib/utils';

/**
 * شعار "البناء الراقي".
 * يُعرض SVG داخلي (BrickMark) لتفادي Hydration Mismatch الذي يحدث مع
 * img + onError (السبب الجذري لـ React #418/#423 في الإنتاج).
 * عند توفّر الشعار الرسمي، يمكن استبدال المحتوى بـ <Image src="/logo.svg" />
 * داخل مكون معلق بـ useEffect لتفادي التبديل أثناء Render.
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

export function BrandLogo({ className, src, name = 'البناء الراقي' }: { className?: string; src?: string | null; name?: string }) {
  if (src) {
    return <Image unoptimized src={src} width={80} height={80} alt={`شعار ${name}`} className={cn('object-contain', className)} />;
  }
  return <BrickMark className={className} />;
}

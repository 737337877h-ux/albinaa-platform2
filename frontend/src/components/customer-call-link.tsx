'use client';
import { type ReactNode } from 'react';
import { registerContactAttempt } from '@/lib/contact-attempt';
import { toast } from '@/components/ui/toast';

export function CustomerCallLink({ customerId, href, className, children }: {
  customerId: string; href: string; className?: string; children: ReactNode;
}) {
  return <a href={href} className={className} onClick={() => {
    // Keep the anchor's native protocol launch in the user's click gesture.
    void registerContactAttempt(customerId, 'call').catch(() => {
      toast('تعذر حفظ محاولة الاتصال؛ سجّل المتابعة يدويًا أو أعد المحاولة عند اتصال الشبكة.', 'err');
    });
  }}>{children}</a>;
}

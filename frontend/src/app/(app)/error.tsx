'use client';
import { useEffect } from 'react';
import { Button } from '@/components/ui/primitives';
import { BrandLogo } from '@/components/brand';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[App Error]', error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <BrandLogo className="h-10 w-10" />
      <h2 className="font-display text-xl font-bold text-iron-900 dark:text-concrete-100">
        حدث خطأ غير متوقع
      </h2>
      <p className="max-w-md text-sm text-concrete-500">
        تعذّر عرض هذه الصفحة. يمكنك المحاولة مرة أخرى أو العودة إلى لوحة التحكم.
      </p>
      {error.digest && (
        <p className="text-xs text-concrete-400" dir="ltr">Error: {error.digest}</p>
      )}
      <div className="flex gap-2">
        <Button onClick={reset}>إعادة المحاولة</Button>
        <Button variant="secondary" onClick={() => (window.location.href = '/dashboard')}>
          العودة للرئيسية
        </Button>
      </div>
    </div>
  );
}

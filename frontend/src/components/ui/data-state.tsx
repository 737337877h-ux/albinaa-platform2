'use client';
import { Lock } from 'lucide-react';
import { friendlyApiError } from '@/lib/errors';
import { Button, Empty, ErrorNote, Skeleton } from './primitives';

/**
 * غلاف موحّد لحالات جلب البيانات (Loading / Error / Empty) — قابل لإعادة
 * الاستخدام في أي بطاقة أو قسم عبر التطبيق (Dashboard، Customers، وغيرها).
 * كل استعلام في الصفحة مستقل، فخطأ قسم واحد لا يكسر بقية الصفحة.
 */
export function DataState({
  isLoading, isError, error, onRetry, isFetching,
  isEmpty, emptyTitle, emptyHint, skeletonClassName, children,
}: {
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  onRetry?: () => void;
  isFetching?: boolean;
  isEmpty: boolean;
  emptyTitle: string;
  emptyHint?: string;
  skeletonClassName?: string;
  children: React.ReactNode;
}) {
  if (isLoading) return <Skeleton className={skeletonClassName ?? 'h-24'} />;
  if (isError) {
    return (
      <div className="space-y-2 p-4">
        <ErrorNote message={friendlyApiError(error)} />
        {onRetry && (
          <Button variant="secondary" onClick={onRetry} loading={isFetching}>
            إعادة المحاولة
          </Button>
        )}
      </div>
    );
  }
  if (isEmpty) return <Empty title={emptyTitle} hint={emptyHint} />;
  return <>{children}</>;
}

/** يظهر بدل قسم كامل حين لا يملك المستخدم صلاحية الوصول إليه — إخفاء لطيف لا كسر. */
export function PermissionNotice({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <Lock className="h-6 w-6 text-concrete-300 dark:text-concrete-500" aria-hidden />
      <p className="text-sm text-concrete-500">{message}</p>
    </div>
  );
}

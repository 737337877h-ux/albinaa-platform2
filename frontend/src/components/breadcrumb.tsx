'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';

/** تُعرَّف تسميات المسارات هنا مركزيًا مع إضافة كل صفحة جديدة. */
const LABELS: Record<string, string> = {
  dashboard: 'لوحة التحكم',
  customers: 'العملاء',
  followups: 'المتابعات',
  promises: 'وعود السداد',
  collections: 'التحصيلات',
  imports: 'استيراد Excel',
  tasks: 'عمل اليوم',
  notifications: 'الإشعارات',
};

export function Breadcrumb() {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return null;

  return (
    <nav aria-label="مسار التصفح" className="mb-1 flex items-center gap-1.5 text-xs text-concrete-500">
      <Link href="/dashboard" className="hover:text-pine-700">الرئيسية</Link>
      {segments.map((seg, i) => {
        const href = `/${segments.slice(0, i + 1).join('/')}`;
        const isLast = i === segments.length - 1;
        // تجاهل عرض قيم UUID كخطوة منفصلة (تُعرض "التفاصيل" بدلاً منها)
        const isId = /^[0-9a-f-]{16,}$/i.test(seg);
        const label = isId ? 'التفاصيل' : (LABELS[seg] ?? seg);
        return (
          <span key={href} className="flex items-center gap-1.5">
            <ChevronLeft className="h-3 w-3" aria-hidden />
            {isLast ? (
              <span aria-current="page" className="font-medium text-iron-900 dark:text-concrete-100">{label}</span>
            ) : (
              <Link href={href} className="hover:text-pine-700">{label}</Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}

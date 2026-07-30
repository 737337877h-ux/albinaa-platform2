'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useCan } from '@/lib/auth';

/**
 * /admin — إعادة توجيه تلقائية إلى أول قسم متاح للمستخدم.
 * يمنع ظهور 404 عند الدخول على المسار العام للإدارة من القائمة.
 */
export default function AdminIndexPage() {
  const router = useRouter();
  const can = useCan();

  useEffect(() => {
    if (can('users.manage')) router.replace('/admin/users');
    else if (can('settings.manage')) router.replace('/admin/branches');
    else if (can('audit.read')) router.replace('/admin/audit');
    else router.replace('/dashboard');
  }, [can, router]);

  return (
    <div className="flex min-h-[40vh] items-center justify-center gap-2 text-sm text-concrete-500">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      جارٍ التحويل…
    </div>
  );
}

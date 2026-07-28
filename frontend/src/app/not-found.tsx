import Link from 'next/link';
import { Button } from '@/components/ui/primitives';
import { BrandLogo } from '@/components/brand';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <BrandLogo className="h-12 w-12" />
      <h1 className="font-display text-4xl font-bold text-iron-900 dark:text-concrete-100">404</h1>
      <p className="text-sm text-concrete-500">الصفحة التي تبحث عنها غير موجودة أو تم نقلها.</p>
      <Link href="/dashboard">
        <Button>العودة إلى لوحة التحكم</Button>
      </Link>
    </div>
  );
}

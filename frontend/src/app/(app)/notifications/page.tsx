import { Bell } from 'lucide-react';
import { PageHeader } from '@/components/app-shell';
import { Card, Empty } from '@/components/ui/primitives';

/**
 * صفحة مؤقتة (Placeholder) واضحة — تُستبدل بصفحة الإشعارات الكاملة
 * (قائمة/تعليم كمقروء/الانتقال للعنصر المرتبط) في مرحلتها ضمن Milestone 6،
 * بعد اعتماد نجاح بناء مرحلة التأسيس. القائمة المنسدلة في الشريط العلوي
 * تعمل بالفعل وتتصل بالـ API الحقيقي؛ هذه الصفحة فقط بانتظار البناء الكامل.
 */
export default function NotificationsPage() {
  return (
    <div>
      <PageHeader title="الإشعارات" />
      <Card className="p-6">
        <Empty
          title="صفحة الإشعارات الكاملة قيد الإنشاء"
          hint="قائمة الإشعارات في الشريط العلوي تعمل الآن — هذه الصفحة الكاملة قادمة ضمن هذه المرحلة"
        />
        <div className="mt-2 flex justify-center text-concrete-300 dark:text-concrete-500">
          <Bell className="h-8 w-8" aria-hidden />
        </div>
      </Card>
    </div>
  );
}

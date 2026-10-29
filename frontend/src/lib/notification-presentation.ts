import {fmtDateTime,fmtMoney} from './format';
import {notificationHref, type TargetableNotification} from './notification-target';
import {financialAdjustmentDecisionAr,financialAdjustmentTypeAr} from './financial-adjustment';
type KindTone = 'neutral' | 'pine' | 'hazard' | 'debt';

export const KIND_AR: Record<string, { label: string; tone: KindTone }> = {
  hr_task_assigned: {label:'مهمة موظف جديدة',tone:'pine'},
  hr_task_submitted: {label:'إنجاز يحتاج المراجعة',tone:'hazard'},
  hr_task_completed: {label:'إنجاز معتمد',tone:'pine'},
  hr_task_returned: {label:'مهمة أعيدت للتعديل',tone:'hazard'},
  hr_task_cancelled: {label:'مهمة ملغاة',tone:'neutral'},
  hr_request_submitted: {label:'طلب موظف',tone:'hazard'},
  hr_request_decided: {label:'تحديث طلب موظف',tone:'pine'},
  task_new: {label:'مهمة جديدة',tone:'pine'},
  followup_due: { label: 'متابعة مستحقة', tone: 'hazard' },
  promise_due: { label: 'وعد مستحق', tone: 'hazard' },
  promise_overdue: { label: 'وعد متأخر', tone: 'debt' },
  task_overdue: { label: 'إعادة تصعيد مهمة متأخرة', tone: 'debt' },
  collection_created: { label: 'تحصيل جديد', tone: 'pine' },
  receipt_uploaded: { label: 'صورة إيصال جديدة', tone: 'pine' },
  collection_reversal_requested: { label: 'طلب عكس تحصيل', tone: 'debt' },
  finance_alert: { label: 'تنبيه مالي فوري', tone: 'debt' },
  scheduled_job_failed: { label: 'فشل مهمة مجدولة', tone: 'debt' },
  oracle_exception_movement_published: { label: 'حركة Oracle استثنائية', tone: 'hazard' },
  customer_transferred: { label: 'نقل عميل', tone: 'neutral' },
};

export function describeNotification(n: TargetableNotification): { title: string; text: string; href?: string } {
  const p = n.payload ?? {};
  if(p.diagnostic === true)return {title:String(p.title??'إشعار اختبار'),text:String(p.message??'إشعار اختبار فقط'),href:notificationHref(n)};
  const customerName = (p.customerName as string | undefined) ?? '';
  const money =
    p.amount != null && p.currency
      ? `${fmtMoney(p.amount as number)} ${String(p.currency)}`
      : null;
  const customerHref = notificationHref(n);

  if((n.kind.startsWith('hr_request_')||n.kind.startsWith('hr_task_')))return {title:String(p.title??'طلب موظف'),text:String(p.message??''),href:notificationHref(n)};
  switch (n.kind) {
    case 'task_overdue': return {title:'إعادة تصعيد مهمة متأخرة',text:`مهمة متأخرة${customerName ? ` — ${customerName}` : ''}`,href:notificationHref(n)};
    case 'task_new': return {title:'مهمة جديدة',text:String(p.message??'أُسندت إليك مهمة جديدة'),href:notificationHref(n)};
    case 'assignment_change_requested': return {title:'طلب تغيير إسناد',text:String(p.message??'طلب جديد يحتاج المراجعة'),href:notificationHref(n)};
    case 'assignment_change_reviewed': return {title:'نتيجة طلب تغيير الإسناد',text:String(p.message??'تمت مراجعة الطلب'),href:notificationHref(n)};
    case 'sync_failed': return {title:'تعذرت المزامنة',text:String(p.message??'راجع حالة الاتصال والمزامنة'),href:notificationHref(n)};
    case 'followup_due':
      return {
        title: 'متابعة مستحقة',
        text: `${customerName ? `حان موعد متابعة ${customerName}` : 'لديك متابعة مستحقة'}${p.dueDate ? ` — ${fmtDateTime(p.dueDate as string)}` : ''}`,
        href: customerHref,
      };
    case 'promise_due':
      return {
        title: 'تذكير بوعد سداد',
        text: money
          ? `وعد سداد من ${customerName || 'عميل'} بمبلغ ${money}${p.dueDate ? ` — يستحق ${fmtDateTime(p.dueDate as string)}` : ''}`
          : `وعد سداد من ${customerName || 'عميل'} يستحق قريبًا`,
        href: customerHref,
      };
    case 'promise_overdue':
      return {
        title: 'وعد سداد متأخر',
        text: money
          ? `تجاوز ${customerName || 'العميل'} موعد الوفاء بوعد بمبلغ ${money}${p.reason ? ` (${p.reason})` : ''}`
          : `تجاوز ${customerName || 'العميل'} موعد الوفاء بوعد${p.reason ? ` (${p.reason})` : ''}`,
        href: customerHref,
      };
    case 'collection_created':
      return {
        title: 'تحصيل جديد بانتظار الاستلام',
        text: `سُجّل تحصيل من ${customerName || ''}${money ? ` بمبلغ ${money}` : ''}${p.method ? ` — ${p.method}` : ''}${p.collectorName ? ` بواسطة ${p.collectorName}` : ''}`,
        href: customerHref,
      };
    case 'receipt_uploaded':
      return {
        title: 'رفع المحصل صورة إيصال جديدة',
        text: `${customerName ? `العميل: ${customerName}` : 'صورة إيصال مرتبطة بسند'}${p.collectorName ? ` — المحصل: ${p.collectorName}` : ''}`,
        href: typeof p.href === 'string' ? p.href : '/collections',
      };
    case 'collection_reversal_requested':
      return {
        title: 'طلب عكس يحتاج موافقة مالية',
        text: `طُلب عكس تحصيل${money ? ` بمبلغ ${money}` : ''}${p.reason ? ` — ${p.reason}` : ''}`,
        href: '/collections/reconciliation',
      };
    case 'finance_alert': {
      if (p.event === 'financial_adjustment_requested') {
        const type = financialAdjustmentTypeAr(p.requestType);
        return {
          title: `طلب ${type} يحتاج موافقة مالية`,
          text: `${customerName || 'عميل'}${money ? ` — ${money}` : ''}${p.requesterName ? ` — مقدم الطلب: ${p.requesterName}` : ''}${p.reason ? ` — السبب: ${p.reason}` : ''}`,
          href: notificationHref(n),
        };
      }
      if (p.event === 'financial_adjustment_reviewed') {
        const type = financialAdjustmentTypeAr(p.requestType);
        return {
          title: `تمت معالجة طلب ${type}`,
          text: `${customerName || 'عميل'} — الحالة: ${financialAdjustmentDecisionAr(p.decision)}${money ? ` — ${money}` : ''}${p.reviewerName ? ` — المراجع: ${p.reviewerName}` : ''}${p.reviewNotes ? ` — الملاحظات: ${p.reviewNotes}` : ''}`,
          href: notificationHref(n),
        };
      }
      const labels: Record<string, string> = {
        collection_reversed: 'تم عكس تحصيل',
        manual_balance_adjustment: 'تم تعديل رصيد يدويًا',
        credit_limit_overridden: 'تم تجاوز سقف ائتمان',
        customer_merged: 'تم دمج سجلّي عميل',
        import_reversed: 'تم التراجع عن دفعة استيراد',
      };
      const eventLabel = labels[String(p.event)] ?? 'تمت عملية مالية حساسة';
      return {
        title: eventLabel,
        text: `${eventLabel}${money ? ` بمبلغ ${money}` : ''}${p.actorName ? ` بواسطة ${p.actorName}` : ''}${p.reason ? ` — ${p.reason}` : ''}`,
        href: typeof p.href === 'string' ? p.href : undefined,
      };
    }
    case 'scheduled_job_failed':
      return {
        title: 'تعطلت مهمة مجدولة',
        text: `فشلت المهمة ${p.job ?? ''}${p.message ? ` — ${p.message}` : ''}`,
        href: typeof p.href === 'string' ? p.href : '/admin/audit',
      };
    case 'oracle_exception_movement_published':
      return {
        title: String(p.title ?? 'نشر حركة Oracle استثنائية'),
        text: String(p.message ?? 'نُشرت حركة تاريخية أو معدلة وفق Oracle مع حفظ سجل المراجعة.'),
        href: notificationHref(n),
      };
    case 'customer_transferred':
      return {
        title: 'نُقل إليك عميل',
        text: `نُقل إليك العميل ${customerName || ''}${p.customerCode ? ` (${p.customerCode})` : ''}${p.reason ? ` — ${p.reason}` : ''}`,
        href: customerHref,
      };
    default:
      return { title: typeof p.title === 'string' ? p.title : 'إشعار جديد', text: typeof p.message === 'string' ? p.message : 'راجع التفاصيل المرتبطة بهذا الإشعار', href: notificationHref(n) };
  }
}

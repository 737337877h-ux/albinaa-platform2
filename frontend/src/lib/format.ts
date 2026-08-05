/** تنسيقات عربية موحدة — الأرقام لاتينية (0-9) لتطابق كشوف النظام المحاسبي. */
export const fmtMoney = (v: number | string | null | undefined) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(v ?? 0));

export const ORG_TIME_ZONE = 'Asia/Aden';
export const ORG_UTC_OFFSET = '+03:00';

export const fmtDate = (v: string | Date) =>
  new Intl.DateTimeFormat('ar', { dateStyle: 'medium', timeZone: ORG_TIME_ZONE }).format(new Date(v));

export const fmtDateTime = (v: string | Date) =>
  new Intl.DateTimeFormat('ar', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: ORG_TIME_ZONE,
  }).format(new Date(v));

/** قيمة صريحة بتوقيت المنشأة مناسبة لحقل datetime-local. */
export function orgDateTimeLocalValue(value: string | Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ORG_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

/** يحول الساعة التي اختارها المستخدم في صنعاء إلى لحظة UTC غير ملتبسة للإرسال إلى API. */
export function orgDateTimeLocalToIso(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) {
    throw new Error('Invalid organization local date-time');
  }
  const parsed = new Date(`${value.length === 16 ? `${value}:00` : value}${ORG_UTC_OFFSET}`);
  if (Number.isNaN(parsed.getTime())) throw new Error('Invalid organization local date-time');
  return parsed.toISOString();
}

export const CCY_AR: Record<string, string> = { YER: 'ريال يمني', SAR: 'ريال سعودي', USD: 'دولار' };

export const PROMISE_STATUS_AR: Record<string, string> = {
  upcoming: 'قادم', due_today: 'مستحق اليوم', fulfilled: 'منفذ',
  partially_fulfilled: 'منفذ جزئيًا', unfulfilled: 'غير منفذ',
  postponed: 'مؤجل', cancelled_approved: 'ملغى',
};
export const COLLECTION_STATUS_AR: Record<string, string> = {
  recorded: 'مسجلة', handed_to_cashier: 'مسلمة للصندوق',
  matched: 'مطابقة', approved: 'معتمدة', reversed: 'معكوسة',
};

export const TASK_STATUS_AR: Record<string, string> = {
  open: 'مفتوحة', escalated: 'تصعيد', done: 'منجزة',
};
export const TASK_TYPE_AR: Record<string, string> = {
  large_debt_7plus: 'مديونية كبيرة تجاوزت أسبوعًا',
  promise_due: 'وعد سداد مستحق',
  promise_escalation: 'تصعيد وعد متأخر',
  followup_overdue: 'متابعة متأخرة',
  risk_critical: 'مخاطر حرجة',
  risk_high: 'مخاطر مرتفعة',
  debt_120plus: 'دين +120 يوم',
  escalation_message_30: 'رسالة تحصيل — +30 يومًا',
  escalation_call_60: 'مكالمة تحصيل — +60 يومًا',
  escalation_visit_90: 'زيارة ميدانية — +90 يومًا',
  escalation_legal_120: 'إنذار قانوني — +120 يومًا',
  high_balance_no_followup: 'رصيد مرتفع بلا متابعة حديثة',
  repeated_no_answer: 'لا يرد متكرر',
  needs_visit: 'يحتاج زيارة',
  followup_periodic_medium: 'متابعة دورية (مخاطر متوسطة)',
  followup_normal: 'متابعة عادية',
};

export const IMPORT_STATUS_AR: Record<string, string> = {
  dry_run: 'جاهز للمراجعة', running: 'قيد التنفيذ',
  completed: 'مكتمل', failed: 'فشل',
  reversed: 'تم التراجع',
};

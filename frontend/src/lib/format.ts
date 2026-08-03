/** تنسيقات عربية موحدة — الأرقام لاتينية (0-9) لتطابق كشوف النظام المحاسبي. */
export const fmtMoney = (v: number | string | null | undefined) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(v ?? 0));

export const fmtDate = (v: string | Date) =>
  new Intl.DateTimeFormat('ar', { dateStyle: 'medium' }).format(new Date(v));

export const fmtDateTime = (v: string | Date) =>
  new Intl.DateTimeFormat('ar', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(v));

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
  high_balance_no_followup: 'رصيد مرتفع بلا متابعة حديثة',
  repeated_no_answer: 'لا يرد متكرر',
  needs_visit: 'يحتاج زيارة',
  followup_periodic_medium: 'متابعة دورية (مخاطر متوسطة)',
  followup_normal: 'متابعة عادية',
};

export const IMPORT_STATUS_AR: Record<string, string> = {
  dry_run: 'جاهز للمراجعة', running: 'قيد التنفيذ',
  completed: 'مكتمل', failed: 'فشل',
};

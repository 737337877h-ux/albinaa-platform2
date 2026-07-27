/** تنسيقات عربية موحدة — الأرقام لاتينية (0-9) لتطابق كشوف النظام المحاسبي. */
export const fmtMoney = (v: number) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(v);

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

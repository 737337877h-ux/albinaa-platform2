/** The user-approved statement message, shared by both entry points. */
export function statementCaption(name: string, code: string | undefined, from: string, to: string, currency: string): string {
  return `الأخ/ ${name}، مرفق لكم كشف حسابكم رقم ${code || '—'} عن الفترة من ${from} إلى ${to} بعملة ${currency}. نرجو مراجعة الكشف والتكرم بالسداد أو التواصل معنا عند وجود أي ملاحظة. البناء الراقي.`;
}

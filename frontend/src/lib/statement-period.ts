/** Archive requests need an explicit, complete calendar period. */
export function archiveStatementPeriodError(source: string, from: string, to: string): string | null {
  if (source !== 'oracle_archive') return null;
  if (!from || !to) return 'حدد «من تاريخ» و«إلى تاريخ» لعرض كشف أرشيف Oracle.';
  const valid = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day)
    && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day;
  if (!valid(from) || !valid(to)) return 'أدخل تاريخ بداية ونهاية صحيحين للكشف.';
  if (from > to) return 'تاريخ بداية الكشف يجب ألا يتجاوز تاريخ النهاية.';
  if (from < '2020-01-01' || to > '2026-12-31') return 'اختر فترة ضمن أرشيف Oracle المتاح من 2020 إلى 2026.';
  return null;
}

/**
 * حدود اليوم بتوقيت المنشأة (اليمن، UTC+3 دائمًا — بلا توقيت صيفي) بدل UTC.
 *
 * قرار موثق (تصحيح مراجعة Dashboard/Milestone 6):
 * فلاتر التاريخ اليومية (مثل "تحصيلات اليوم") تستقبل تاريخًا بلا وقت
 * (YYYY-MM-DD). تفسير هذا التاريخ كمنتصف ليل UTC يزيح حدود اليوم 3 ساعات عن
 * يوم العمل الفعلي في اليمن، فيستبعد معظم حركات اليوم. الحل: تفسير التاريخ
 * كمنتصف ليل بتوقيت المنشأة (+03:00) صراحة، وجعل حد النهاية "بداية اليوم
 * التالي" غير شامل (lt) بدل "نهاية اليوم نفسه" شامل (lte) — فلا نعتمد على
 * افتراض تقريبي لآخر لحظة في اليوم.
 */
export const ORG_UTC_OFFSET = '+03:00';

/** بداية اليوم المحلي (شاملة) — لاستخدامها في fromDate/gte. */
export function startOfOrgDay(dateOnly: string): Date {
  return new Date(`${dateOnly}T00:00:00.000${ORG_UTC_OFFSET}`);
}

/** بداية اليوم التالي محليًا (غير شاملة) — لاستخدامها في toDate/lt. */
export function startOfNextOrgDay(dateOnly: string): Date {
  const d = startOfOrgDay(dateOnly);
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

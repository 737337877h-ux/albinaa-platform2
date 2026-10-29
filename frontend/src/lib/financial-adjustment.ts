export function financialAdjustmentTypeAr(value: unknown): string {
  return value === 'settlement' ? 'تصفية' : 'خصم';
}

export function financialAdjustmentDecisionAr(value: unknown): string {
  if (value === 'approved') return 'معتمد';
  if (value === 'rejected') return 'مرفوض';
  return 'قيد المراجعة';
}

export function isFinancialAdjustmentEvent(value: unknown): boolean {
  return value === 'financial_adjustment_requested' || value === 'financial_adjustment_reviewed';
}

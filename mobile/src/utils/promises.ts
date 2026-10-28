export type PromiseFilter = 'active' | 'upcoming' | 'today' | 'overdue' | 'fulfilled' | 'cancelled' | 'all';
export type PromiseBucket = Exclude<PromiseFilter, 'active' | 'all'> | 'review';

export interface PromiseState {
  status?: unknown;
  dueDate?: unknown;
  settlementDate?: unknown;
  settledLate?: unknown;
  missedDueDate?: unknown;
  fulfilledAmount?: unknown;
}

export const PROMISE_FILTER_LABELS: Record<PromiseFilter, string> = {
  active: 'قيد المتابعة', upcoming: 'القادمة', today: 'اليوم', overdue: 'المتأخرة',
  fulfilled: 'المنفذة', cancelled: 'الملغاة', all: 'الكل',
};

function dateKey(value: unknown): string {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  return String(value ?? '').match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? '';
}

function flag(value: unknown): boolean {
  return value === true || value === 1 || value === 'true' || value === '1';
}

function normalizedStatus(value: unknown): string {
  const status = String(value ?? '').trim().toLowerCase();
  if (status === 'بانتظار المزامنة') return 'pending';
  if (['paid', 'done', 'settled', 'fulfilled_late', 'settled_late'].includes(status)) return 'fulfilled';
  if (status === 'cancelled') return 'cancelled_approved';
  if (['broken', 'overdue'].includes(status)) return 'unfulfilled';
  return status;
}

export function promiseSettledLate(item: PromiseState): boolean {
  if (flag(item.settledLate)) return true;
  if (['fulfilled_late', 'settled_late'].includes(String(item.status ?? '').toLowerCase())) return true;
  const settled = dateKey(item.settlementDate);
  const due = dateKey(item.dueDate);
  return !!settled && !!due && settled > due;
}

/** Final states take precedence over an old due date, so history never re-enters the work queue. */
export function promiseBucket(item: PromiseState, today: string): PromiseBucket {
  const status = normalizedStatus(item.status);
  if (status === 'fulfilled') return 'fulfilled';
  if (status === 'cancelled_approved') return 'cancelled';
  if (status === 'unfulfilled') return 'overdue';
  if (!['upcoming', 'due_today', 'partially_fulfilled', 'pending', ''].includes(status)) return 'review';
  const due = dateKey(item.dueDate);
  if (due) return due < today ? 'overdue' : due === today ? 'today' : 'upcoming';
  return status === 'upcoming' ? 'upcoming' : status === 'due_today' ? 'today' : 'review';
}

export function promiseStatusLabel(item: PromiseState, today: string): string {
  const status = normalizedStatus(item.status);
  const bucket = promiseBucket(item, today);
  if (bucket === 'fulfilled') return promiseSettledLate(item) ? 'تم السداد بعد الموعد' : 'تم السداد';
  if (bucket === 'cancelled') return String(item.status ?? '').toLowerCase() === 'cancelled_approved' ? 'إلغاء معتمد' : 'ملغي';
  if (status === 'pending') return 'بانتظار المزامنة';
  if (status === 'partially_fulfilled') return bucket === 'overdue' ? 'سداد جزئي · متأخر' : 'سداد جزئي';
  if (status === 'unfulfilled') return Number(item.fulfilledAmount ?? 0)>0 ? 'سداد جزئي · تجاوز الموعد' : 'لم يُوفَ به';
  if (bucket === 'overdue') return 'متأخر';
  if (bucket === 'today') return 'مستحق اليوم';
  if (bucket === 'upcoming') return 'قادم';
  return 'حالة تحتاج مراجعة';
}

export function matchesPromiseFilter(item: PromiseState, filter: PromiseFilter, today: string): boolean {
  const bucket = promiseBucket(item, today);
  return filter === 'all' || (filter === 'active'
    ? ['upcoming', 'today', 'overdue'].includes(bucket)
    : bucket === filter);
}

export function promiseSummary(rows: PromiseState[], today: string): Record<PromiseFilter, number> {
  const summary: Record<PromiseFilter, number> = { active: 0, upcoming: 0, today: 0, overdue: 0, fulfilled: 0, cancelled: 0, all: rows.length };
  for (const row of rows) {
    const bucket = promiseBucket(row, today);
    if (bucket === 'review') continue;
    summary[bucket] += 1;
    if (['upcoming', 'today', 'overdue'].includes(bucket)) summary.active += 1;
  }
  return summary;
}

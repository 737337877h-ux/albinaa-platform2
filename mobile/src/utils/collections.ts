export interface CollectionState {
  id?: unknown;
  status?: unknown;
  source?: unknown;
  statusVerified?: unknown;
  amount?: unknown;
  currencyCode?: unknown;
}

function verified(value: unknown): boolean {
  return value === true || value === 1 || value === 'true' || value === '1';
}

export function collectionSource(item: CollectionState): string {
  if (item.source) return String(item.source);
  const id = String(item.id ?? '');
  if (id.startsWith('oracle-direct:')) return 'oracle_direct_receipt';
  if (id.startsWith('oracle-receipt:')) return 'oracle_receipt_request';
  return 'unknown';
}

export type CollectionBucket = 'confirmed' | 'pending' | 'unknown' | 'inactive';

export function collectionBucket(item: CollectionState): CollectionBucket {
  const status = String(item.status ?? '').trim().toLowerCase();
  if (['reversed', 'cancelled', 'canceled', 'rejected', 'voided'].includes(status)) return 'inactive';
  if (['pending_approval', 'pending_sync', 'pending', 'submitted'].includes(status)) return 'pending';
  if (['approved', 'recorded', 'posted'].includes(status) && verified(item.statusVerified)) return 'confirmed';
  return 'unknown';
}

export function collectionStatusLabel(item: CollectionState): string {
  const status = String(item.status ?? '').trim().toLowerCase();
  if (status === 'pending_sync') return 'بانتظار المزامنة';
  if (['pending_approval', 'pending', 'submitted'].includes(status)) return 'بانتظار الاعتماد';
  if (['rejected'].includes(status)) return 'مرفوض';
  if (['cancelled', 'canceled', 'voided'].includes(status)) return 'ملغى';
  if (status === 'reversed') return 'معكوس';
  if (collectionBucket(item) === 'confirmed') return status === 'recorded' ? 'مسجّل' : 'معتمد';
  return 'الحالة غير متحققة';
}

export function collectionSourceLabel(item: CollectionState): string {
  const source = collectionSource(item);
  if (source === 'oracle_direct_receipt') return 'سند Oracle';
  if (source === 'oracle_receipt_request') return 'طلب سند قبض';
  if (source === 'platform_collection') return 'تحصيل المنصة';
  return 'سجل تحصيل';
}

function currencyKey(value: unknown): string {
  const currency = String(value ?? '').trim().toUpperCase();
  return (({ YR: 'YER', SR: 'SAR', $: 'USD' } as Record<string, string>)[currency] ?? currency) || 'عملة غير محددة';
}

/** Keep document states and currencies separate; an unverified legacy row cannot inflate confirmed totals. */
export function collectionSummary(rows: CollectionState[]) {
  const totals: Record<'confirmed' | 'pending' | 'unknown', Record<string, number>> = { confirmed: {}, pending: {}, unknown: {} };
  const counts: Record<CollectionBucket, number> = { confirmed: 0, pending: 0, unknown: 0, inactive: 0 };
  const seen = new Set<string>();
  for (const row of rows) {
    const id = row.id == null ? '' : String(row.id);
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    const bucket = collectionBucket(row);
    counts[bucket] += 1;
    if (bucket === 'inactive') continue;
    const amount = Number(row.amount);
    if (!Number.isFinite(amount)) continue;
    const currency = currencyKey(row.currencyCode);
    totals[bucket][currency] = (totals[bucket][currency] ?? 0) + amount;
  }
  return { ...totals, counts };
}

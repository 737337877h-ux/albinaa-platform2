import { createHash } from 'crypto';
import { orgDateOnly } from '../common/org-time';

type Money = string | number | { toFixed: (digits: number) => string };
export interface SettlementPromise {
  id: string; customerId: string; currencyCode: string; expectedAmount: Money;
  fulfilledAmount?: Money | null; status: string; promiseDate: Date | string;
  dueDate: Date | string; createdAt: Date | string; statusReason?: string | null;
  settlementDate?: Date | string | null; settledLate?: boolean; missedDueDate?: Date | string | null;
}
export interface SettlementReceipt {
  key: string; customerId: string; currencyCode: string; amount: Money;
  receiptDate: string; occurredAt?: Date | string | null; precision: 'day' | 'timestamp';
  source: 'local_collection' | 'oracle_receipt'; sourceId: string;
}
export interface ExistingSettlementAllocation {
  promiseId: string; receiptKey: string; amount: Money; receiptAmount: Money;
  receiptDate: Date | string; customerId: string; currencyCode: string;
}
export interface PlannedAllocation {
  promiseId: string; receiptKey: string; amount: string; receiptAmount: string;
  receiptDate: string; customerId: string; currencyCode: string;
  source: string; sourceId: string;
}
export interface SettlementReview {
  code: string; promiseIds: string[]; receiptKey?: string; customerId?: string;
}
export interface PromiseSettlementChange {
  promiseId: string; customerId: string; previousStatus: string; status: string;
  previousFulfilledAmount: string; fulfilledAmount: string; settlementDate: string | null;
  settledLate: boolean; missedDueDate: string | null; previousStatusReason: string | null;
}

/** Decimal(18,4) arithmetic: allocations never pass through floating point. */
export function moneyUnits(value: Money | null | undefined): bigint {
  const text = value == null ? '0' : typeof value === 'object' ? value.toFixed(4)
    : typeof value === 'number' ? (Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER / 10_000
      ? value.toFixed(4) : 'invalid') : value.trim();
  const match = /^(-?)(\d+)(?:\.(\d{1,4}))?$/.exec(text);
  if (!match) throw new Error('Invalid settlement amount');
  return (match[1] ? -1n : 1n) * (BigInt(match[2]) * 10_000n + BigInt((match[3] ?? '').padEnd(4, '0')));
}
export function moneyText(value: bigint): string {
  const sign = value < 0n ? '-' : ''; const positive = value < 0n ? -value : value;
  return `${sign}${positive / 10_000n}.${String(positive % 10_000n).padStart(4, '0')}`;
}
const day = (value: Date | string) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
const groupKey = (row: { customerId: string; currencyCode: string }) => `${row.customerId}|${row.currencyCode}`;
const eligibleStatuses = new Set(['upcoming', 'due_today', 'partially_fulfilled', 'unfulfilled']);

/**
 * An amount/date coincidence is insufficient when several promises overlap.
 * Preserve those cases for review; never choose FIFO or a newer promise implicitly.
 */
export function planPromiseSettlements(
  promises: SettlementPromise[], receipts: SettlementReceipt[], existing: ExistingSettlementAllocation[],
  now = new Date(), selectedPromiseIds?: string[],
) {
  const today = orgDateOnly(now);
  const review: SettlementReview[] = [];
  const blockedGroups = new Set<string>();
  const allocatedByPromise = new Map<string, bigint>();
  const allocatedByReceipt = new Map<string, bigint>();
  const lastAllocationDay = new Map<string, string>();
  const receiptByKey = new Map<string, SettlementReceipt>();
  const promisesById = new Map(promises.map(p => [p.id, p]));
  for (const receipt of receipts) {
    const previous = receiptByKey.get(receipt.key);
    if (previous && (groupKey(previous) !== groupKey(receipt) || moneyUnits(previous.amount) !== moneyUnits(receipt.amount)
      || previous.receiptDate !== receipt.receiptDate)) {
      blockedGroups.add(groupKey(previous)); blockedGroups.add(groupKey(receipt));
      review.push({ code: 'conflicting_receipt_identity', promiseIds: [], receiptKey: receipt.key });
    } else if (!previous) receiptByKey.set(receipt.key, receipt);
  }
  for (const row of existing) {
    const units = moneyUnits(row.amount);
    allocatedByPromise.set(row.promiseId, (allocatedByPromise.get(row.promiseId) ?? 0n) + units);
    allocatedByReceipt.set(row.receiptKey, (allocatedByReceipt.get(row.receiptKey) ?? 0n) + units);
    const allocationDay = day(row.receiptDate);
    if (allocationDay > (lastAllocationDay.get(row.promiseId) ?? '')) lastAllocationDay.set(row.promiseId, allocationDay);
    const current = receiptByKey.get(row.receiptKey);
    if (!current || moneyUnits(current.amount) !== moneyUnits(row.receiptAmount)
      || groupKey(current) !== groupKey(row) || current.receiptDate !== allocationDay) {
      blockedGroups.add(groupKey(row));
      review.push({ code: 'allocated_receipt_missing_or_changed', promiseIds: [row.promiseId], receiptKey: row.receiptKey, customerId: row.customerId });
    }
  }
  for (const promise of promises) {
    const allocated = allocatedByPromise.get(promise.id) ?? 0n;
    const reported = promise.status === 'fulfilled' ? moneyUnits(promise.expectedAmount) : moneyUnits(promise.fulfilledAmount);
    if (reported > allocated) {
      blockedGroups.add(groupKey(promise));
      review.push({ code: 'manual_fulfillment_without_receipt_binding', promiseIds: [promise.id], customerId: promise.customerId });
    }
    if (allocated > moneyUnits(promise.expectedAmount)) {
      blockedGroups.add(groupKey(promise));
      review.push({ code: 'allocation_exceeds_promise', promiseIds: [promise.id], customerId: promise.customerId });
    }
  }
  const allocations: PlannedAllocation[] = [];
  const selected = selectedPromiseIds ? new Set(selectedPromiseIds) : null;
  const changedIds = new Set<string>();
  const ordered = [...receiptByKey.values()].sort((a, b) => a.receiptDate.localeCompare(b.receiptDate) || a.key.localeCompare(b.key));
  for (const receipt of ordered) {
    if (blockedGroups.has(groupKey(receipt)) || receipt.receiptDate > today || moneyUnits(receipt.amount) <= 0n) continue;
    const available = moneyUnits(receipt.amount) - (allocatedByReceipt.get(receipt.key) ?? 0n);
    if (available < 0n) {
      review.push({ code: 'allocation_exceeds_receipt', promiseIds: [], receiptKey: receipt.key }); continue;
    }
    if (available === 0n) continue;
    // Scope controls which changes may be applied, never which competing promises are considered.
    const candidates = promises.filter(p => groupKey(p) === groupKey(receipt) && eligibleStatuses.has(p.status)
      && day(p.promiseDate) <= receipt.receiptDate
      && moneyUnits(p.expectedAmount) > (allocatedByPromise.get(p.id) ?? 0n));
    if (!candidates.length) continue;
    if (candidates.length > 1) {
      review.push({ code: 'overlapping_promises', promiseIds: candidates.map(p => p.id).sort(), receiptKey: receipt.key, customerId: receipt.customerId }); continue;
    }
    const promise = candidates[0];
    if (selected && !selected.has(promise.id)) continue;
    const createdDay = orgDateOnly(new Date(promise.createdAt));
    if (receipt.receiptDate < createdDay) {
      review.push({ code: 'receipt_before_promise_creation', promiseIds: [promise.id], receiptKey: receipt.key, customerId: promise.customerId }); continue;
    }
    if (receipt.precision === 'day' && receipt.receiptDate === createdDay) {
      review.push({ code: 'same_day_receipt_order_unknown', promiseIds: [promise.id], receiptKey: receipt.key, customerId: promise.customerId }); continue;
    }
    if (receipt.precision === 'timestamp' && (!receipt.occurredAt
      || new Date(receipt.occurredAt).getTime() < new Date(promise.createdAt).getTime()
      || new Date(receipt.occurredAt).getTime() > now.getTime())) continue;
    const remaining = moneyUnits(promise.expectedAmount) - (allocatedByPromise.get(promise.id) ?? 0n);
    const amount = available < remaining ? available : remaining;
    if (amount <= 0n) continue;
    allocations.push({ promiseId: promise.id, receiptKey: receipt.key, amount: moneyText(amount), receiptAmount: moneyText(moneyUnits(receipt.amount)),
      receiptDate: receipt.receiptDate, customerId: receipt.customerId, currencyCode: receipt.currencyCode, source: receipt.source, sourceId: receipt.sourceId });
    allocatedByPromise.set(promise.id, (allocatedByPromise.get(promise.id) ?? 0n) + amount);
    allocatedByReceipt.set(receipt.key, (allocatedByReceipt.get(receipt.key) ?? 0n) + amount);
    lastAllocationDay.set(promise.id, receipt.receiptDate); changedIds.add(promise.id);
  }
  const changes: PromiseSettlementChange[] = [...changedIds].sort().map(id => {
    const promise = promisesById.get(id)!;
    const amount = allocatedByPromise.get(id)!;
    const completed = amount >= moneyUnits(promise.expectedAmount);
    const finalDay = completed ? lastAllocationDay.get(id)! : null;
    const dueDay = day(promise.dueDate);
    const missedDueDate = promise.missedDueDate ? day(promise.missedDueDate)
      : promise.status === 'unfulfilled' || (completed ? finalDay! > dueDay : today > dueDay) ? dueDay : null;
    return { promiseId: id, customerId: promise.customerId, previousStatus: promise.status,
      status: completed ? 'fulfilled' : promise.status === 'unfulfilled' ? 'unfulfilled' : 'partially_fulfilled',
      previousFulfilledAmount: moneyText(moneyUnits(promise.fulfilledAmount)), fulfilledAmount: moneyText(amount),
      settlementDate: finalDay, settledLate: completed && finalDay! > dueDay, missedDueDate,
      previousStatusReason: promise.statusReason ?? null };
  });
  const hash = createHash('sha256').update(JSON.stringify({ allocations, changes, review })).digest('hex');
  return { today, allocations, changes, review, planHash: hash };
}

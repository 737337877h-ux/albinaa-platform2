export const AGING_BUCKETS = [
  'bucket_0_30', 'bucket_31_60', 'bucket_61_90', 'bucket_91_120', 'bucket_120_plus', 'undated',
] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export interface AgingCharge { amount: number; date: Date | null }
export type AgingAmounts = Record<AgingBucket, number>;

export function allocateFifo(
  charges: AgingCharge[],
  payments: number,
  targetBalance: number,
  asOf: Date,
): AgingAmounts {
  const open = charges
    .filter((x) => x.amount > 0)
    .map((x) => ({ ...x }))
    .sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return -1;
      if (!b.date) return 1;
      return a.date.getTime() - b.date.getTime();
    });

  let available = Math.max(0, payments);
  for (const charge of open) {
    const applied = Math.min(charge.amount, available);
    charge.amount -= applied;
    available -= applied;
    if (available <= 0) break;
  }

  const target = Math.max(0, targetBalance);
  let remaining = open.reduce((sum, x) => sum + x.amount, 0);
  if (remaining > target) {
    let adjustment = remaining - target;
    for (const charge of open) {
      const applied = Math.min(charge.amount, adjustment);
      charge.amount -= applied;
      adjustment -= applied;
      if (adjustment <= 0) break;
    }
  } else if (remaining < target) {
    open.push({ amount: target - remaining, date: null });
  }

  const result: AgingAmounts = {
    bucket_0_30: 0, bucket_31_60: 0, bucket_61_90: 0,
    bucket_91_120: 0, bucket_120_plus: 0, undated: 0,
  };
  for (const charge of open) {
    if (charge.amount <= 0) continue;
    if (!charge.date) {
      result.undated += charge.amount;
      continue;
    }
    const days = Math.max(0, Math.floor((asOf.getTime() - charge.date.getTime()) / 86_400_000));
    const bucket: AgingBucket = days <= 30 ? 'bucket_0_30'
      : days <= 60 ? 'bucket_31_60'
        : days <= 90 ? 'bucket_61_90'
          : days <= 120 ? 'bucket_91_120' : 'bucket_120_plus';
    result[bucket] += charge.amount;
  }
  remaining = Object.values(result).reduce((sum, x) => sum + x, 0);
  if (Math.abs(remaining - target) > 0.005) result.undated += target - remaining;
  return result;
}

export function provisionFor(amounts: AgingAmounts, rates: Partial<Record<AgingBucket, number>>) {
  return AGING_BUCKETS.reduce((sum, bucket) => sum + amounts[bucket] * (rates[bucket] ?? 0), 0);
}

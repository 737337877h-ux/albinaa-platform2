import { calculateCei, calculateDso, safePercent, weightedDebtAge } from './kpi-calculator';

describe('financial KPI calculator', () => {
  it('calculates DSO with month length', () => expect(calculateDso(300, 600, 30)).toBe(15));
  it('returns null DSO without sales', () => expect(calculateDso(300, 0, 30)).toBeNull());
  it('uses current receivables in CEI denominator', () => expect(calculateCei(1000, 500, 900, 300)).toBe(50));
  it('does not invent CEI when aging close is missing', () => expect(calculateCei(1000, 500, 900, null)).toBeNull());
  it('calculates weighted debt age and ignores undated amounts', () => expect(weightedDebtAge({ bucket_0_30: 100, bucket_31_60: 0, bucket_61_90: 100, bucket_91_120: 0, bucket_120_plus: 0 })).toBe(45));
  it('calculates safe percentages', () => expect(safePercent(3, 4)).toBe(75));
});

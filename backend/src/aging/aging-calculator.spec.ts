import { allocateFifo, provisionFor } from './aging-calculator';

describe('aging FIFO calculator', () => {
  const asOf = new Date('2026-08-04T00:00:00.000Z');

  it('applies collections to the oldest invoices first', () => {
    const result = allocateFifo([
      { amount: 100, date: new Date('2026-03-01') },
      { amount: 200, date: new Date('2026-07-20') },
    ], 150, 150, asOf);
    expect(result.bucket_120_plus).toBe(0);
    expect(result.bucket_0_30).toBe(150);
  });

  it('puts the unexplained balance in the visible undated bucket', () => {
    const result = allocateFifo([], 0, 500, asOf);
    expect(result.undated).toBe(500);
    expect(result.bucket_0_30).toBe(0);
  });

  it('never reports receivables for a credit balance', () => {
    const result = allocateFifo([{ amount: 100, date: new Date('2026-01-01') }], 0, -50, asOf);
    expect(Object.values(result).reduce((sum, x) => sum + x, 0)).toBe(0);
  });

  it('calculates configurable doubtful-debt provision', () => {
    const amounts = allocateFifo([{ amount: 1000, date: new Date('2026-05-01') }], 0, 1000, asOf);
    expect(provisionFor(amounts, { bucket_91_120: 0.25 })).toBe(250);
  });
});

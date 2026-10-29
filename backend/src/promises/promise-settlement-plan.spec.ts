import { moneyText, moneyUnits, planPromiseSettlements, SettlementPromise, SettlementReceipt } from './promise-settlement-plan';

const now = new Date('2026-10-28T08:00:00Z');
const promise = (patch: Partial<SettlementPromise> = {}): SettlementPromise => ({
  id: 'p1', customerId: 'c1', currencyCode: 'YER', expectedAmount: '15000', fulfilledAmount: null,
  status: 'unfulfilled', promiseDate: '2026-10-01', dueDate: '2026-10-08',
  createdAt: '2026-10-01T08:00:00Z', statusReason: 'تصعيد سابق', ...patch,
});
const receipt = (patch: Partial<SettlementReceipt> = {}): SettlementReceipt => ({
  key: 'receipt1', customerId: 'c1', currencyCode: 'YER', amount: '15000',
  receiptDate: '2026-10-06', precision: 'day', source: 'oracle_receipt', sourceId: '1617', ...patch,
});

describe('promise receipt settlement planner', () => {
  it('uses fixed-scale decimals without losing fractional amounts', () => {
    expect(moneyText(moneyUnits('12345678901234.4321'))).toBe('12345678901234.4321');
    expect(moneyText(moneyUnits('0.1') + moneyUnits('0.2'))).toBe('0.3000');
    expect(() => moneyUnits('1.00001')).toThrow();
  });

  it('settles one uniquely matched promise and preserves previous escalation history', () => {
    const result = planPromiseSettlements([promise()], [receipt()], [], now);
    expect(result.allocations).toEqual([expect.objectContaining({ promiseId: 'p1', amount: '15000.0000' })]);
    expect(result.changes[0]).toMatchObject({ status: 'fulfilled', settlementDate: '2026-10-06', settledLate: false,
      missedDueDate: '2026-10-08', previousStatusReason: 'تصعيد سابق' });
  });

  it('can settle a late promise in installments while retaining the missed date', () => {
    const result = planPromiseSettlements([promise({ expectedAmount: '25000', dueDate: '2026-10-02' })],
      [receipt({ amount: '10000', receiptDate: '2026-10-06' }), receipt({ key: 'r2', amount: '15000', receiptDate: '2026-10-11' })], [], now);
    expect(result.allocations.map(r => r.amount)).toEqual(['10000.0000', '15000.0000']);
    expect(result.changes[0]).toMatchObject({ status: 'fulfilled', fulfilledAmount: '25000.0000', settlementDate: '2026-10-11', settledLate: true, missedDueDate: '2026-10-02' });
  });

  it('flags repeated overlapping promises instead of choosing the oldest or newest', () => {
    const result = planPromiseSettlements([promise(), promise({ id: 'p2', promiseDate: '2026-09-16', createdAt: '2026-09-16T08:00:00Z' })], [receipt()], [], now);
    expect(result.allocations).toEqual([]);
    expect(result.review).toContainEqual(expect.objectContaining({ code: 'overlapping_promises', promiseIds: ['p1', 'p2'] }));
  });

  it('a scoped apply does not conceal competing promises', () => {
    const result = planPromiseSettlements([promise(), promise({ id: 'p2' })], [receipt()], [], now, ['p1']);
    expect(result.changes).toEqual([]);
    expect(result.review[0].code).toBe('overlapping_promises');
  });

  it('does not reuse a fully allocated receipt for another promise', () => {
    const first = promise({ status: 'fulfilled', fulfilledAmount: '15000' });
    const other = promise({ id: 'p2', promiseDate: '2026-10-07', createdAt: '2026-10-07T08:00:00Z' });
    const existing = [{ promiseId: 'p1', receiptKey: 'receipt1', amount: '15000', receiptAmount: '15000',
      receiptDate: '2026-10-06', customerId: 'c1', currencyCode: 'YER' }];
    expect(planPromiseSettlements([first, other], [receipt()], existing, now).allocations).toEqual([]);
  });

  it('respects previously allocated partial payments and is idempotent', () => {
    const initial = planPromiseSettlements([promise({ expectedAmount: '25000', status: 'upcoming' })], [receipt()], [], now);
    const existing = initial.allocations;
    const result = planPromiseSettlements([promise({ expectedAmount: '25000', fulfilledAmount: '15000', status: 'partially_fulfilled' })],
      [receipt(), receipt({ key: 'r2', amount: '20000', receiptDate: '2026-10-09' })], existing, now);
    expect(result.allocations).toEqual([expect.objectContaining({ receiptKey: 'r2', amount: '10000.0000' })]);
    expect(result.changes[0].fulfilledAmount).toBe('25000.0000');
    const again = planPromiseSettlements([promise({ expectedAmount: '25000', fulfilledAmount: '25000', status: 'fulfilled' })],
      [receipt(), receipt({ key: 'r2', amount: '20000', receiptDate: '2026-10-09' })], [...existing, ...result.allocations], now);
    expect(again.changes).toEqual([]);
  });

  it('blocks a group with an unbound manual fulfilled or partial promise', () => {
    for (const status of ['fulfilled', 'partially_fulfilled']) {
      const result = planPromiseSettlements([promise({ id: 'manual', status, fulfilledAmount: '10000' }), promise()], [receipt()], [], now);
      expect(result.allocations).toEqual([]);
      expect(result.review).toContainEqual(expect.objectContaining({ code: 'manual_fulfillment_without_receipt_binding' }));
    }
  });

  it('does not assume the order of an Oracle receipt and promise created on the same day', () => {
    const result = planPromiseSettlements([promise()], [receipt({ receiptDate: '2026-10-01' })], [], now);
    expect(result.allocations).toEqual([]);
    expect(result.review[0].code).toBe('same_day_receipt_order_unknown');
  });

  it('accepts a precise local timestamp only after promise creation', () => {
    const early = receipt({ precision: 'timestamp', receiptDate: '2026-10-01', occurredAt: '2026-10-01T07:00:00Z' });
    const late = receipt({ precision: 'timestamp', receiptDate: '2026-10-01', occurredAt: '2026-10-01T09:00:00Z' });
    expect(planPromiseSettlements([promise()], [early], [], now).changes).toEqual([]);
    expect(planPromiseSettlements([promise()], [late], [], now).changes[0].status).toBe('fulfilled');
  });

  it('ignores other currencies, other customers, future receipts and cancelled promises', () => {
    for (const row of [receipt({ currencyCode: 'SAR' }), receipt({ customerId: 'other' }), receipt({ receiptDate: '2026-11-01' }), receipt({ amount: '-100' })]) {
      expect(planPromiseSettlements([promise()], [row], [], now).allocations).toEqual([]);
    }
    expect(planPromiseSettlements([promise({ status: 'cancelled_approved' })], [receipt()], [], now).allocations).toEqual([]);
  });

  it('deduplicates stable source identity and flags a changed allocated source', () => {
    expect(planPromiseSettlements([promise()], [receipt(), receipt()], [], now).allocations).toHaveLength(1);
    const existing = [{ promiseId: 'p1', receiptKey: 'receipt1', amount: '10000', receiptAmount: '15000',
      receiptDate: '2026-10-06', customerId: 'c1', currencyCode: 'YER' }];
    const result = planPromiseSettlements([promise({ fulfilledAmount: '10000' })], [receipt({ amount: '12000' })], existing, now);
    expect(result.allocations).toEqual([]);
    expect(result.review).toContainEqual(expect.objectContaining({ code: 'allocated_receipt_missing_or_changed' }));
  });
});

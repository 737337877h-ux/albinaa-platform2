import { applyGrossLedgerMovement, deduplicateDebtMovements, summarizeDebtChange } from './dashboard.service';

it('retains gross incoming/outgoing when the account net is zero', () => {
  const snapshots = [{ customerId: 'a', currencyCode: 'YER', balance: 100 }];
  const result = applyGrossLedgerMovement(summarizeDebtChange(snapshots, snapshots), [
    { currencyCode: 'YER', amountSigned: 500 }, { currencyCode: 'YER', amountSigned: -500 },
  ]);
  expect(result.YER).toMatchObject({ netChange: 0, positiveIncreases: 500, decreases: 500 });
});

it('keeps the Oracle copy and removes the linked platform receipt only once', () => {
  const occurredAt = new Date('2026-09-07T10:00:00Z');
  const rows = deduplicateDebtMovements([
    { customerId: 'a', currencyCode: 'YER', amountSigned: -100, occurredAt, source: 'platform', documentKey: 'a|YER|77' },
    { customerId: 'a', currencyCode: 'YER', amountSigned: -100, occurredAt, source: 'oracle', documentKey: 'a|YER|77' },
    { customerId: 'a', currencyCode: 'YER', amountSigned: 50, occurredAt, source: 'platform', documentKey: null },
  ]);
  expect(rows).toHaveLength(2);
  expect(rows.map((row) => row.source)).toEqual(['oracle', 'platform']);
});

it('keeps currencies separate and ignores currencies outside the scoped snapshots', () => {
  const snapshots = [{ customerId: 'a', currencyCode: 'SAR', balance: 100 }];
  const result = applyGrossLedgerMovement(summarizeDebtChange(snapshots, snapshots), [
    { currencyCode: 'SAR', amountSigned: 10 }, { currencyCode: 'YER', amountSigned: 500 },
  ]);
  expect(Object.keys(result)).toEqual(['SAR']);
  expect(result.SAR.positiveIncreases).toBe(10);
});

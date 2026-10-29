import { describe, expect, it } from '@jest/globals';
import { collectionBucket, collectionSource, collectionStatusLabel, collectionSummary } from '../src/utils/collections';

describe('collection status and daily money totals', () => {
  it('keeps confirmed receipts separate from requests and never mixes currencies', () => {
    const summary = collectionSummary([
      { id: 'a', amount: 100000, currencyCode: 'YER', status: 'recorded', statusVerified: true },
      { id: 'b', amount: 100, currencyCode: 'SAR', status: 'approved', statusVerified: 1 },
      { id: 'c', amount: 250000, currencyCode: 'YR', status: 'pending_approval', statusVerified: true },
      { id: 'd', amount: 10000, currencyCode: 'YER', status: 'pending_sync' },
      { id: 'old', amount: 7000, currencyCode: 'YER' },
      { id: 'reversed', amount: 80000, currencyCode: 'YER', status: 'reversed', statusVerified: true },
    ]);
    expect(summary).toEqual({
      confirmed: { YER: 100000, SAR: 100 }, pending: { YER: 260000 }, unknown: { YER: 7000 },
      counts: { confirmed: 2, pending: 2, unknown: 1, inactive: 1 },
    });
  });

  it('does not treat a legacy Oracle row as confirmed without verified status', () => {
    const legacy = { id: 'oracle-direct:old', amount: 5000, currencyCode: 'YER' };
    expect(collectionSource(legacy)).toBe('oracle_direct_receipt');
    expect(collectionBucket(legacy)).toBe('unknown');
    expect(collectionStatusLabel(legacy)).toBe('الحالة غير متحققة');
    expect(collectionSource({ id: 'oracle-receipt:request' })).toBe('oracle_receipt_request');
    expect(collectionBucket({ status: 'approved', statusVerified: 'false' })).toBe('unknown');
    expect(collectionBucket({ status: 'approved', statusVerified: 'true' })).toBe('confirmed');
  });

  it('counts each local row id once and excludes rejected or cancelled amounts', () => {
    const row = { id: 'recorded', amount: 30, currencyCode: 'SR', status: 'approved', statusVerified: true };
    const summary = collectionSummary([row, row, { id: 'rejected', amount: 50, currencyCode: 'SAR', status: 'rejected' }, { id: 'cancelled', status: 'cancelled', amount: 70, currencyCode: 'SAR' }]);
    expect(summary.confirmed).toEqual({ SAR: 30 });
    expect(summary.counts).toEqual({ confirmed: 1, pending: 0, unknown: 0, inactive: 2 });
    expect(collectionStatusLabel({ status: 'pending_sync' })).toBe('بانتظار المزامنة');
    expect(collectionStatusLabel({ status: 'pending_approval' })).toBe('بانتظار الاعتماد');
  });
});

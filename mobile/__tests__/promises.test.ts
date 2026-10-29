import { describe, expect, it } from '@jest/globals';
import { matchesPromiseFilter, promiseBucket, promiseSettledLate, promiseStatusLabel, promiseSummary } from '../src/utils/promises';

const today = '2026-10-27';

describe('promise work list and history', () => {
  it('counts the actual open promises while keeping approved cancellations out of overdue work', () => {
    const rows = [
      ...Array.from({ length: 2 }, () => ({ status: 'upcoming', dueDate: '2026-11-02' })),
      ...Array.from({ length: 60 }, () => ({ status: 'unfulfilled', dueDate: '2026-09-24' })),
      { status: 'fulfilled', dueDate: '2026-09-24' },
      ...Array.from({ length: 2 }, () => ({ status: 'cancelled_approved', dueDate: '2026-09-24' })),
    ];
    expect(promiseSummary(rows, today)).toEqual({ active: 62, upcoming: 2, today: 0, overdue: 60, fulfilled: 1, cancelled: 2, all: 65 });
    expect(rows.filter(row => matchesPromiseFilter(row, 'active', today))).toHaveLength(62);
    expect(rows.filter(row => matchesPromiseFilter(row, 'overdue', today))).toHaveLength(60);
  });

  it('places partial payments by their due date and retains their precise state label', () => {
    expect(promiseBucket({ status: 'partially_fulfilled', dueDate: `${today}T00:00:00.000Z` }, today)).toBe('today');
    expect(promiseStatusLabel({ status: 'partially_fulfilled', dueDate: '2026-10-26' }, today)).toBe('سداد جزئي · متأخر');
    expect(promiseBucket({ status: 'upcoming', dueDate: '2026-10-26' }, today)).toBe('overdue');
    expect(promiseStatusLabel({ status: 'unfulfilled', dueDate: '2026-10-26' }, today)).toBe('لم يُوفَ به');
  });

  it('keeps late settlements in fulfilled history with the missed deadline visible', () => {
    const row = { status: 'fulfilled', dueDate: '2026-10-08', settlementDate: '2026-10-11' };
    expect(promiseBucket(row, today)).toBe('fulfilled');
    expect(matchesPromiseFilter(row, 'active', today)).toBe(false);
    expect(promiseStatusLabel(row, today)).toBe('تم السداد بعد الموعد');
    expect(promiseStatusLabel({ ...row, settlementDate: '2026-10-08' }, today)).toBe('تم السداد');
    expect(promiseSettledLate({ status: 'fulfilled', settledLate: 1 })).toBe(true);
    expect(promiseSettledLate({ status: 'fulfilled', settledLate: 'false', missedDueDate: 0 })).toBe(false);
    expect(promiseStatusLabel({status:'fulfilled',dueDate:'2026-10-08',settlementDate:'2026-10-08',settledLate:false,missedDueDate:'2026-10-08'},today)).toBe('تم السداد');
    expect(promiseStatusLabel({status:'unfulfilled',dueDate:'2026-10-08',fulfilledAmount:10000},today)).toBe('سداد جزئي · تجاوز الموعد');
  });

  it('supports legacy final states without describing an unknown state as active', () => {
    expect(promiseBucket({ status: 'cancelled', dueDate: '2026-10-01' }, today)).toBe('cancelled');
    expect(promiseBucket({ status: 'paid', dueDate: '2026-10-01' }, today)).toBe('fulfilled');
    expect(promiseStatusLabel({ status: 'fulfilled_late' }, today)).toBe('تم السداد بعد الموعد');
    expect(matchesPromiseFilter({ status: 'unknown' }, 'active', today)).toBe(false);
    expect(matchesPromiseFilter({ status: 'unknown' }, 'all', today)).toBe(true);
    expect(matchesPromiseFilter({ status: 'بانتظار المزامنة', dueDate: '2026-11-02' }, 'active', today)).toBe(true);
    expect(promiseStatusLabel({ status: 'بانتظار المزامنة', dueDate: '2026-11-02' }, today)).toBe('بانتظار المزامنة');
  });
});

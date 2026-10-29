import { nextMonthEndRun } from './aging.scheduler';

describe('nextMonthEndRun', () => {
  it('schedules the last day of the current month at 23:55', () => {
    expect(nextMonthEndRun(new Date(2026, 7, 4, 10)).toString()).toBe(new Date(2026, 7, 31, 23, 55).toString());
  });

  it('moves to the next month after the current close time', () => {
    expect(nextMonthEndRun(new Date(2026, 7, 31, 23, 56)).toString()).toBe(new Date(2026, 8, 30, 23, 55).toString());
  });
});

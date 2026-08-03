import { nextDailyRun } from './risk.scheduler';

describe('risk scheduler', () => {
  it('schedules today when the configured hour is still ahead', () => {
    const now = new Date(2026, 7, 3, 1, 30, 0);
    expect(nextDailyRun(now, 2)).toEqual(new Date(2026, 7, 3, 2, 0, 0));
  });

  it('schedules tomorrow after the configured hour has passed', () => {
    const now = new Date(2026, 7, 3, 2, 0, 1);
    expect(nextDailyRun(now, 2)).toEqual(new Date(2026, 7, 4, 2, 0, 0));
  });
});

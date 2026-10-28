import { describe, expect, it } from '@jest/globals';
import { isLocalToday, localDateKey } from '../src/utils/local-date';

describe('local collection day', () => {
  it('keeps SQLite local timestamps on their written day', () => {
    expect(isLocalToday('2026-09-02 08:15:00', '2026-09-02')).toBe(true);
    expect(isLocalToday('2026-09-01 23:59:59', '2026-09-02')).toBe(false);
  });

  it('converts explicit UTC timestamps into the device local day', () => {
    const timestamp = new Date(2026, 8, 2, 0, 15, 0).toISOString();
    expect(isLocalToday(timestamp, localDateKey(new Date(2026, 8, 2, 12, 0, 0)))).toBe(true);
  });

  it('rejects blank and invalid timestamps', () => {
    expect(isLocalToday('', '2026-09-02')).toBe(false);
    expect(isLocalToday('not-a-date', '2026-09-02')).toBe(false);
  });
});

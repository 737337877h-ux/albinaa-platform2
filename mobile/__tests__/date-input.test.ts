import { describe, expect, it } from '@jest/globals';
import { displayDateFromIso, parseFlexibleDate, taskLabel } from '../src/utils/date-input';

describe('flexible mobile date input', () => {
  const now = new Date('2026-08-12T10:00:00+03:00');

  it.each([
    ['128', '2026-08-12'],
    ['1282026', '2026-08-12'],
    ['12082026', '2026-08-12'],
    ['12-08-2026', '2026-08-12'],
    ['٢٠٢٦-٠٨-١٢', '2026-08-12'],
  ])('parses %s as %s', (input, iso) => {
    expect(parseFlexibleDate(input, now)?.iso).toBe(iso);
  });

  it('rejects impossible dates', () => {
    expect(parseFlexibleDate('3192026', now)).toBeNull();
  });

  it('formats ISO dates and translates generated task codes', () => {
    expect(displayDateFromIso('2026-08-12')).toBe('12-08-2026');
    expect(taskLabel('large_debt_7plus')).toBe('مديونية كبيرة +7 أيام');
  });
});

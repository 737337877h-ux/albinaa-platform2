import { hasExplicitTimeZone, orgCalendarDayUtc, orgDateOnly, orgYear, startOfNextOrgDay, startOfOrgDay } from './org-time';

describe('organization time', () => {
  it('uses the Asia/Aden accounting day at the UTC boundary', () => {
    const instant = new Date('2026-08-04T22:30:00.000Z');
    expect(orgDateOnly(instant)).toBe('2026-08-05');
    expect(orgYear(instant)).toBe(2026);
  });

  it('builds exact local-day UTC bounds', () => {
    expect(startOfOrgDay('2026-08-05').toISOString()).toBe('2026-08-04T21:00:00.000Z');
    expect(startOfNextOrgDay('2026-08-05').toISOString()).toBe('2026-08-05T21:00:00.000Z');
  });

  it.each([
    ['2026-10-29T20:59:59.999Z', '2026-10-29T00:00:00.000Z'],
    ['2026-10-29T21:00:00.000Z', '2026-10-30T00:00:00.000Z'],
    ['2026-12-31T21:00:00.000Z', '2027-01-01T00:00:00.000Z'],
  ])('encodes the Aden calendar date for database date columns at %s', (instant, expected) => {
    expect(orgCalendarDayUtc(new Date(instant)).toISOString()).toBe(expected);
  });

  it('rejects ambiguous timestamps without a zone', () => {
    expect(hasExplicitTimeZone('2026-08-05T15:08')).toBe(false);
    expect(hasExplicitTimeZone('2026-08-05T15:08:00+03:00')).toBe(true);
    expect(hasExplicitTimeZone('2026-08-05T12:08:00Z')).toBe(true);
  });
});

import { hasExplicitTimeZone, orgDateOnly, orgYear, startOfNextOrgDay, startOfOrgDay } from './org-time';

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

  it('rejects ambiguous timestamps without a zone', () => {
    expect(hasExplicitTimeZone('2026-08-05T15:08')).toBe(false);
    expect(hasExplicitTimeZone('2026-08-05T15:08:00+03:00')).toBe(true);
    expect(hasExplicitTimeZone('2026-08-05T12:08:00Z')).toBe(true);
  });
});

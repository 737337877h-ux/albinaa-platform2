import { describe, expect, it } from 'vitest';
import { orgDateTimeLocalToIso, orgDateTimeLocalValue } from './format';

describe('organization date-time', () => {
  it('shows an instant as the matching Asia/Aden wall-clock time', () => {
    expect(orgDateTimeLocalValue('2026-08-05T12:08:00.000Z')).toBe('2026-08-05T15:08');
  });

  it('sends a selected Asia/Aden wall-clock time as an explicit instant', () => {
    expect(orgDateTimeLocalToIso('2026-08-05T15:08')).toBe('2026-08-05T12:08:00.000Z');
  });

  it('keeps the organization accounting day across the UTC boundary', () => {
    expect(orgDateTimeLocalValue('2026-08-04T22:30:00.000Z')).toBe('2026-08-05T01:30');
  });
});

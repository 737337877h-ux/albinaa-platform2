import { afterEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { createRequestId } from './request-id';

afterEach(() => vi.unstubAllGlobals());
describe('request identifiers across browser contexts', () => {
  it('uses the native UUID API when available', () => {
    const randomUUID = vi.fn(() => 'native-id');
    vi.stubGlobal('crypto', { randomUUID });
    expect(createRequestId()).toBe('native-id');
    expect(randomUUID).toHaveBeenCalledOnce();
  });
  it('works on HTTP where randomUUID is missing and produces distinct v4 UUIDs', () => {
    vi.stubGlobal('crypto', { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) });
    const ids = Array.from({ length: 100 }, () => createRequestId());
    expect(new Set(ids).size).toBe(100);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it('fails clearly when secure randomness is unavailable', () => {
    vi.stubGlobal('crypto', undefined);
    expect(() => createRequestId()).toThrow('المتصفح');
  });
});

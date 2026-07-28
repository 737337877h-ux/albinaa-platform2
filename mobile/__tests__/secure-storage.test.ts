import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  getAccessToken, getRefreshToken, setTokens, clearTokens, isAuthenticated,
} from '../src/utils/secure-storage';

describe('secure-storage', () => {
  beforeEach(async () => {
    await clearTokens();
  });

  it('returns null when no tokens stored', async () => {
    expect(await getAccessToken()).toBeNull();
    expect(await getRefreshToken()).toBeNull();
  });

  it('stores and retrieves tokens', async () => {
    await setTokens('access-123', 'refresh-456');
    expect(await getAccessToken()).toBe('access-123');
    expect(await getRefreshToken()).toBe('refresh-456');
  });

  it('clearTokens removes all tokens', async () => {
    await setTokens('access-123', 'refresh-456');
    await clearTokens();
    expect(await getAccessToken()).toBeNull();
    expect(await getRefreshToken()).toBeNull();
  });

  it('isAuthenticated returns false when no token', async () => {
    expect(await isAuthenticated()).toBe(false);
  });

  it('isAuthenticated returns true when token exists', async () => {
    await setTokens('access-123', 'refresh-456');
    expect(await isAuthenticated()).toBe(true);
  });
});

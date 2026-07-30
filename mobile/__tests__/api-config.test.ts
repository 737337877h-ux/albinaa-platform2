import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Mock expo-secure-store
const mockStore: Record<string, string> = {};
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => mockStore[key] ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => { mockStore[key] = value; }),
  deleteItemAsync: jest.fn(async (key: string) => { delete mockStore[key]; }),
}));

// Mock global fetch
const mockFetch: any = jest.fn();
global.fetch = mockFetch;

import { isValidBaseUrl, testConnection } from '../src/config/api';

describe('api config', () => {
  beforeEach(() => {
    Object.keys(mockStore).forEach((k) => delete mockStore[k]);
    mockFetch.mockReset();
  });

  describe('isValidBaseUrl', () => {
    it('accepts http urls', () => {
      expect(isValidBaseUrl('http://192.168.1.10:3000')).toBe(true);
      expect(isValidBaseUrl('http://localhost:3000')).toBe(true);
    });
    it('accepts https urls', () => {
      expect(isValidBaseUrl('https://api.example.com')).toBe(true);
    });
    it('rejects empty', () => {
      expect(isValidBaseUrl('')).toBe(false);
      expect(isValidBaseUrl('   ')).toBe(false);
    });
    it('rejects non-url', () => {
      expect(isValidBaseUrl('192.168.1.10:3000')).toBe(false);
      expect(isValidBaseUrl('ftp://x')).toBe(false);
    });
  });

  describe('testConnection', () => {
    it('returns ok when server returns 200', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });
      const result = await testConnection('http://localhost:3000');
      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);
    });

    it('returns failure with status on 500', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
      const result = await testConnection('http://localhost:3000');
      expect(result.ok).toBe(false);
      expect(result.status).toBe(500);
    });

    it('returns failure on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network request failed'));
      const result = await testConnection('http://localhost:3000');
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Network request failed');
    });

    it('strips trailing slash from base url', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });
      await testConnection('http://localhost:3000/');
      const callArg = mockFetch.mock.calls[0][0];
      expect(callArg).toBe('http://localhost:3000/health');
    });
  });
});

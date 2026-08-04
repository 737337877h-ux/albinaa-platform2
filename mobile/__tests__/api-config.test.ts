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

import { isValidBaseUrl, pingServer } from '../src/config/api';

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

  describe('pingServer', () => {
    it('returns ok with version when health responds 200', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'ok', version: '0.2.0', environment: 'production', uptimeSeconds: 100, timestamp: '2026-01-01T00:00:00Z' }),
      });
      const r = await pingServer('http://localhost:3000');
      expect(r.ok).toBe(true);
      expect(r.status).toBe(200);
      expect(r.version).toBe('0.2.0');
      expect(r.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('returns failure with status on 500', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error', json: async () => ({}) });
      const r = await pingServer('http://localhost:3000');
      expect(r.ok).toBe(false);
      expect(r.status).toBe(500);
      expect(r.error).toContain('500');
    });

    it('returns failure on network error', async () => {
      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
      mockFetch.mockRejectedValueOnce(new Error('Network request failed'));
      const r = await pingServer('http://localhost:3000');
      expect(r.ok).toBe(false);
      expect(r.error).toBe('Network request failed');
      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });

    it('returns failure on timeout', async () => {
      const abortError: any = new Error('Aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValueOnce(abortError);
      const r = await pingServer('http://localhost:3000', 100);
      expect(r.ok).toBe(false);
      expect(r.error).toContain('انتهت المهلة');
    });

    it('rejects empty url', async () => {
      const r = await pingServer('');
      expect(r.ok).toBe(false);
      expect(r.error).toContain('فارغ');
    });

    it('rejects invalid url scheme', async () => {
      const r = await pingServer('ftp://x');
      expect(r.ok).toBe(false);
      expect(r.error).toContain('غير صالح');
    });

    it('strips trailing slash from base url', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
      await pingServer('http://localhost:3000/');
      const callArg = mockFetch.mock.calls[0][0];
      expect(callArg).toBe('http://localhost:3000/health');
    });
  });
});

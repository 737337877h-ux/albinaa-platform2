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

import { getBaseUrl, setStoredBaseUrl, getStoredBaseUrl, isLocalNetworkUrl, isValidBaseUrl, pingServer, getBaseUrlCandidates, prepareOnlineRoute, PUBLIC_API_URL } from '../src/config/api';

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

  it('uses public then LAN for saved production endpoints', async () => {
    mockStore['albinaa.api_base_url'] = 'http://192.168.1.5:18002';
    expect(await getBaseUrlCandidates()).toEqual([PUBLIC_API_URL, 'http://192.168.1.5:18002']);
  });
  it('never fails over an isolated server into production', async () => {
    mockStore['albinaa.api_base_url'] = 'http://192.168.1.5:18003';
    expect(await getBaseUrlCandidates()).toEqual(['http://192.168.1.5:18003']);
  });
  it('respects an explicit LAN-only preference', async () => {
    mockStore['albinaa.api_base_url'] = PUBLIC_API_URL;
    mockStore['albinaa.sync_lan_only'] = 'true';
    expect(await getBaseUrlCandidates()).toEqual(['http://192.168.1.5:18002']);
  });
  it('falls back to LAN when public health fails', async () => {
    mockStore['albinaa.api_base_url'] = PUBLIC_API_URL;
    mockFetch.mockRejectedValueOnce(new Error('offline'));
    mockFetch.mockResolvedValueOnce({ok:true,status:200,json:async () => ({status:'ok'})});
    expect(await prepareOnlineRoute()).toMatchObject({ok:true,route:'lan'});
    expect(mockFetch.mock.calls.map((call: any) => call[0])).toEqual([PUBLIC_API_URL+'/health','http://192.168.1.5:18002/health']);
  });
  it('returns offline when neither production route is reachable', async () => {
    mockStore['albinaa.api_base_url'] = PUBLIC_API_URL;
    mockFetch.mockRejectedValue(new Error('offline'));
    expect(await prepareOnlineRoute()).toMatchObject({ok:false});
  });
  it('uses a healthy office LAN without waiting for a slow public probe, and ignores its late result',async()=>{
    await setStoredBaseUrl(PUBLIC_API_URL);let finish!:(value:any)=>void;
    mockFetch.mockImplementation((url:string)=>url.startsWith(PUBLIC_API_URL)?new Promise(resolve=>{finish=resolve;}):Promise.resolve({ok:true,status:200,json:async()=>({})}));
    expect(await prepareOnlineRoute()).toMatchObject({ok:true,route:'lan'});
    finish({ok:true,status:200,json:async()=>({})});await Promise.resolve();await Promise.resolve();
    expect(await getBaseUrl()).toBe('http://192.168.1.5:18002');
  });
  it('uses public Internet promptly outside the office without waiting for the LAN timeout',async()=>{
    await setStoredBaseUrl(PUBLIC_API_URL);let finish!:(value:any)=>void;
    mockFetch.mockImplementation((url:string)=>url.startsWith(PUBLIC_API_URL)?Promise.resolve({ok:true,status:200,json:async()=>({})}):new Promise(resolve=>{finish=resolve;}));
    expect(await prepareOnlineRoute()).toMatchObject({ok:true,route:'public'});
    finish({ok:false,status:503,json:async()=>({})});await Promise.resolve();
    expect(await getBaseUrl()).toBe(PUBLIC_API_URL);
  });
  it('does not activate an old health result after the operator changes servers',async()=>{
    await setStoredBaseUrl('http://acceptance.local:18003');let finish!:(value:any)=>void;
    mockFetch.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    const pending=prepareOnlineRoute();while(!finish)await Promise.resolve();
    await setStoredBaseUrl('http://other.local:18003');finish({ok:true,status:200,json:async()=>({})});
    expect(await pending).toMatchObject({ok:false});expect(await getBaseUrl()).toBe('http://other.local:18003');
  });

  it('automatically selects public Internet when mobile TLS takes longer than the LAN timeout',async()=>{
    jest.useFakeTimers();
    try {
      await setStoredBaseUrl(PUBLIC_API_URL);
      mockFetch.mockImplementation((url:string)=>url.startsWith(PUBLIC_API_URL)
        ? new Promise(resolve=>setTimeout(()=>resolve({ok:true,status:200,json:async()=>({status:'ok'})}),5_000))
        : Promise.reject(new Error('No route to host')));
      const pending=prepareOnlineRoute(3_500);
      await jest.advanceTimersByTimeAsync(5_001);
      expect(await pending).toMatchObject({ok:true,route:'public'});
      expect(await getBaseUrl()).toBe(PUBLIC_API_URL);
    } finally { jest.useRealTimers(); }
  });

  it('preserves an explicitly selected isolated 18003 endpoint', async () => {
    mockStore['albinaa.api_base_url'] = 'http://192.168.1.5:18003';
    await expect(getStoredBaseUrl()).resolves.toBe('http://192.168.1.5:18003');
    expect(mockStore['albinaa.api_base_url']).toBe('http://192.168.1.5:18003');
  });

  describe('isLocalNetworkUrl', () => {
    it.each([
      'http://192.168.8.148:18001',
      'http://192.168.1.5:18002',
      'http://10.0.0.5:18001',
      'http://172.16.2.20:18001',
      'http://172.31.255.1',
      'http://albinaa.local:18001',
      'https://desktop-tajgfbm.tail16c86c.ts.net/api',
    ])('accepts private LAN address %s', (url) => {
      expect(isLocalNetworkUrl(url)).toBe(true);
    });

    it.each([
      'https://api.albinaa.com',
      'https://desktop-tajgfbm.another-tailnet.ts.net/api',
      'http://desktop-tajgfbm.tail16c86c.ts.net/api',
      'http://172.32.0.1',
      'http://8.8.8.8',
    ])('rejects non-LAN address %s', (url) => {
      expect(isLocalNetworkUrl(url)).toBe(false);
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

    it('finishes on its deadline even when Android ignores fetch cancellation',async()=>{
      jest.useFakeTimers();
      try {
        mockFetch.mockImplementation(()=>new Promise(()=>undefined));
        const pending=pingServer(PUBLIC_API_URL,100);
        await jest.advanceTimersByTimeAsync(100);
        expect(await pending).toMatchObject({ok:false,error:expect.stringContaining('انتهت المهلة')});
        expect(mockFetch.mock.calls[0][1].signal.aborted).toBe(true);
      } finally { jest.useRealTimers(); }
    });

    it('bounds a stalled health response body as well as the headers',async()=>{
      jest.useFakeTimers();
      try {
        mockFetch.mockResolvedValue({ok:true,status:200,json:()=>new Promise(()=>undefined)});
        const pending=pingServer(PUBLIC_API_URL,100);
        await jest.advanceTimersByTimeAsync(100);
        expect(await pending).toMatchObject({ok:false,error:expect.stringContaining('انتهت المهلة')});
      } finally { jest.useRealTimers(); }
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

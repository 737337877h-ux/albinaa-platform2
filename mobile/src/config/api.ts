import * as SecureStore from 'expo-secure-store';

const STORAGE_KEY = 'albinaa.api_base_url';
const LAN_ONLY_KEY = 'albinaa.sync_lan_only';
const DEFAULT_DEV_URL = 'http://localhost:3000';
const DEFAULT_PROD_URL = 'https://api.albinaa.com';

/**
 * ترتيب الأولوية:
 * 1. القيمة المحفوظة في Secure Storage (من شاشة الإعدادات)
 * 2. process.env.EXPO_PUBLIC_API_URL (وقت البناء)
 * 3. localhost في وضع التطوير / api.albinaa.com في الإنتاج
 *
 * يُستخدم فقط داخل هذه الوحدة — لا تستورد من process.env مباشرة في الشاشات.
 */
let cachedBaseUrl: string | null = null;

function defaultFromEnv(): string {
  const fromBuild = process.env.EXPO_PUBLIC_API_URL;
  if (fromBuild && fromBuild.length > 0) return fromBuild;
  return __DEV__ ? DEFAULT_DEV_URL : DEFAULT_PROD_URL;
}

export async function getStoredBaseUrl(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(STORAGE_KEY);
  } catch {
    return null;
  }
}

export async function setStoredBaseUrl(url: string): Promise<void> {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (trimmed.length > 0) {
    await SecureStore.setItemAsync(STORAGE_KEY, trimmed);
  } else {
    await SecureStore.deleteItemAsync(STORAGE_KEY);
  }
  cachedBaseUrl = null;
}

export async function clearStoredBaseUrl(): Promise<void> {
  await SecureStore.deleteItemAsync(STORAGE_KEY);
  cachedBaseUrl = null;
}

export async function getBaseUrl(): Promise<string> {
  if (cachedBaseUrl) return cachedBaseUrl;
  const stored = await getStoredBaseUrl();
  cachedBaseUrl = stored || defaultFromEnv();
  return cachedBaseUrl;
}

export function getDefaultBaseUrl(): string {
  return defaultFromEnv();
}

export function isValidBaseUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  return /^https?:\/\/.+/i.test(trimmed);
}

export function isLocalNetworkUrl(url: string): boolean {
  try {
    const host = new URL(url.trim()).hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')) return true;
    const parts = host.split('.').map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
    if (parts[0] === 10 || parts[0] === 127) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    return parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31;
  } catch {
    return false;
  }
}

export async function getLanOnlySync(): Promise<boolean> {
  const stored = await SecureStore.getItemAsync(LAN_ONLY_KEY);
  return stored !== 'false';
}

export async function setLanOnlySync(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(LAN_ONLY_KEY, enabled ? 'true' : 'false');
}

export interface ServerHealth {
  ok: boolean;
  status?: number;
  latencyMs?: number;
  version?: string;
  environment?: string;
  uptimeSeconds?: number;
  timestamp?: string;
  error?: string;
}

/**
 * يفحص الخادم ويجلب حالته وإصداره مع قياس زمن الاستجابة (Ping).
 */
export async function pingServer(url: string, timeoutMs = 5000): Promise<ServerHealth> {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (!trimmed) {
    return { ok: false, error: 'العنوان فارغ' };
  }
  if (!isValidBaseUrl(trimmed)) {
    return { ok: false, error: 'العنوان غير صالح (يجب أن يبدأ بـ http:// أو https://)' };
  }
  const t0 = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${trimmed}/health`, {
      method: 'GET',
      signal: controller.signal,
    });
    const latency = Date.now() - t0;
    if (res.ok) {
      let body: any = {};
      try { body = await res.json(); } catch { /* ignore */ }
      return {
        ok: true,
        status: res.status,
        latencyMs: latency,
        version: body.version,
        environment: body.environment,
        uptimeSeconds: body.uptimeSeconds,
        timestamp: body.timestamp,
      };
    }
    return {
      ok: false,
      status: res.status,
      latencyMs: latency,
      error: `HTTP ${res.status} ${res.statusText || ''}`.trim(),
    };
  } catch (e: any) {
    const latency = Date.now() - t0;
    let msg = e?.message || 'فشل الاتصال';
    if (e?.name === 'AbortError') msg = `انتهت المهلة بعد ${timeoutMs} مللي ثانية`;
    return { ok: false, latencyMs: latency, error: msg };
  } finally {
    clearTimeout(timeout);
  }
}

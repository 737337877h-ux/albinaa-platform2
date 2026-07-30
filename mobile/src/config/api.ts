import * as SecureStore from 'expo-secure-store';

const STORAGE_KEY = 'albinaa.api_base_url';
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

/**
 * يختبر الوصول للخادم عبر إرسال GET إلى /health أو الجذر.
 * يُعيد true عند نجاح 2xx/3xx، false عند الفشل.
 */
export async function testConnection(url: string, timeoutMs = 5000): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${url.replace(/\/+$/, '')}/health`, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.ok || (res.status >= 200 && res.status < 400)) {
      return { ok: true, status: res.status };
    }
    return { ok: false, status: res.status, error: `HTTP ${res.status}` };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'فشل الاتصال' };
  }
}

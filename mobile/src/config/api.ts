import * as SecureStore from 'expo-secure-store';

const STORAGE_KEY = 'albinaa.api_base_url';
const LAN_ONLY_KEY = 'albinaa.sync_lan_only';
const DEFAULT_DEV_URL = 'http://localhost:3000';
const DEFAULT_PROD_URL = 'http://192.168.1.5:18002';
export const PUBLIC_API_URL = 'https://app.alraqi-erp.com/api';
const PRIVATE_TAILSCALE_URL = 'https://desktop-tajgfbm.tail16c86c.ts.net';
const APPROVED_TAILNET_DNS_SUFFIXES = ['.tail16c86c.ts.net'] as const;

/**
 * ترتيب الأولوية:
 * 1. القيمة المحفوظة في Secure Storage (من شاشة الإعدادات)
 * 2. process.env.EXPO_PUBLIC_API_URL (وقت البناء)
 * 3. localhost في وضع التطوير / app.alraqi-erp.com/api في الإنتاج
 *
 * يُستخدم فقط داخل هذه الوحدة — لا تستورد من process.env مباشرة في الشاشات.
 */
let cachedBaseUrl: string | null = null;

function defaultFromEnv(): string {
  const fromBuild = process.env.EXPO_PUBLIC_API_URL;
  if (fromBuild && fromBuild.length > 0 && ![DEFAULT_PROD_URL, PRIVATE_TAILSCALE_URL].includes(fromBuild)) return fromBuild;
  return __DEV__ ? DEFAULT_DEV_URL : PUBLIC_API_URL;
}

export async function getStoredBaseUrl(): Promise<string | null> {
  try {
    const stored = await SecureStore.getItemAsync(STORAGE_KEY);
    const normalized = stored?.trim().replace(/\/+$/, '') ?? null;
    // 18002 remains the default production backend, but an administrator may
    // explicitly select the isolated 3004/18003 environment for acceptance
    // testing. Never silently rewrite an explicit server choice.
    return normalized;
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
  cachedBaseUrl = (await getBaseUrlCandidates())[0] || (await getStoredBaseUrl()) || defaultFromEnv();
  return cachedBaseUrl;
}

/** Public production endpoint first, office LAN fallback; custom servers stay isolated. */
export async function getBaseUrlCandidates(): Promise<string[]> {
  const stored = await getStoredBaseUrl();
  const selected = stored || defaultFromEnv();
  // Only these exact endpoints share the production database. Never fail over
  // an explicitly selected staging/custom server into production.
  const production = [PUBLIC_API_URL, DEFAULT_PROD_URL, PRIVATE_TAILSCALE_URL];
  const candidates = production.includes(selected)
    ? [PUBLIC_API_URL, DEFAULT_PROD_URL]
    : [selected];
  return await getLanOnlySync() ? candidates.filter(isLocalNetworkUrl) : candidates;
}

export interface OnlineRouteResult {
  ok: boolean;
  url?: string;
  route?: 'explicit' | 'tailscale' | 'lan' | 'public';
  tailscaleUnavailable?: boolean;
  error?: string;
}

/**
 * Resolves the online route without ever exposing a database port to the phone.
 * An explicitly selected acceptance server (such as 3004/18003) is authoritative.
 * Production prefers public HTTPS and falls back to the office LAN.
 */
export async function prepareOnlineRoute(timeoutMs = 3500): Promise<OnlineRouteResult> {
  let failure: OnlineRouteResult = { ok:false, error:'تعذر الاتصال بالخادم؛ تحقق من الإنترنت أو الشبكة المحلية وإعداد المحلية فقط.' };
  for (const url of await getBaseUrlCandidates()) {
    const route = url === PUBLIC_API_URL ? 'public' : url === DEFAULT_PROD_URL ? 'lan' : 'explicit';
    const health = await pingServer(url, timeoutMs);
    if (health.ok) {
      activateRuntimeBaseUrl(url);
      return { ok:true, route, url };
    }
    failure = { ok:false, route, url, error:health.error };
  }
  return failure;
}

export function activateRuntimeBaseUrl(url: string): void {
  cachedBaseUrl = url.trim().replace(/\/+$/, '');
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
    const parsed = new URL(url.trim());
    const host = parsed.hostname.toLowerCase();
    if (
      parsed.protocol === 'https:'
      && APPROVED_TAILNET_DNS_SUFFIXES.some((suffix) => host.endsWith(suffix))
    ) return true;
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
  return stored === 'true';
}

export async function setLanOnlySync(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(LAN_ONLY_KEY, enabled ? 'true' : 'false');
  cachedBaseUrl = null;
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

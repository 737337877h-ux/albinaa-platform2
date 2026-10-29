import axios, { AxiosInstance } from 'axios';
import { canRetryOnAlternateRoute } from './route-retry';
import { activateRuntimeBaseUrl, getBaseUrl, getBaseUrlCandidates, pingServer } from '../config/api';
import { getAccessToken, getRefreshToken, setTokens, clearTokens } from '../utils/secure-storage';

let client: AxiosInstance | null = null;
let clientBuild: Promise<AxiosInstance> | null = null;
let sessionGeneration = 0;
let refreshFlight: Promise<string> | null = null;

async function buildClient(): Promise<AxiosInstance> {
  const baseURL = await getBaseUrl();
  // Let Axios use React Native's native XHR transport. The explicit Axios fetch
  // adapter fails before sending POST requests on some Android builds even when
  // the same LAN host passes the global fetch health probe.
  const c = axios.create({ baseURL, timeout: 15_000 });

  c.interceptors.request.use(async (config) => {
    const generation = sessionGeneration;
    if ((config as any)._sessionGeneration !== undefined && (config as any)._sessionGeneration !== generation) throw new Error('تغيرت جلسة الدخول');
    config.baseURL = await getBaseUrl();
    c.defaults.baseURL = config.baseURL;
    const token = await getAccessToken();
    if (generation !== sessionGeneration) throw new Error('تغيرت جلسة الدخول');
    (config as any)._sessionGeneration = generation;
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  });

  c.interceptors.response.use(
    (res) => res,
    async (error) => {
      const req = error.config;
      // A lost response may follow a committed write. Only reads may be
      // automatically replayed on another route; queued writes keep their IDs.
      if (!error.response && req && canRetryOnAlternateRoute(req.method) && !req._serverRetry) {
        req._serverRetry = true;
        const current = String(req.baseURL || c.defaults.baseURL || '').replace(/\/+$/, '');
        const candidates = await getBaseUrlCandidates();
        for (const candidate of candidates) {
          if (candidate === current) continue;
          const health = await pingServer(candidate, 3_500);
          if (!health.ok) continue;
          activateRuntimeBaseUrl(candidate);
          c.defaults.baseURL = candidate;
          req.baseURL = candidate;
          return c(req);
        }
      }
      if (error.response?.status !== 401 || !req || req._retry || /\/auth\/(login|refresh)/.test(req.url ?? '')) return Promise.reject(error);
      req._retry = true;
      const generation = sessionGeneration;
      if (req._sessionGeneration !== generation) throw new Error('تغيرت جلسة الدخول؛ أعد فتح الصفحة');
      const currentToken = await getAccessToken();
      if (generation !== sessionGeneration) throw new Error('تغيرت جلسة الدخول');
      // A slow 401 for the previous token must not rotate the new session again.
      if (currentToken && req.headers.Authorization !== `Bearer ${currentToken}`) {
        req.headers.Authorization = `Bearer ${currentToken}`;
        return c(req);
      }
      if (!refreshFlight) {
       const flight = (async () => {
        const refreshToken = await getRefreshToken();
        if (!refreshToken) throw new Error('انتهت الجلسة، يرجى تسجيل الدخول مجددًا عند الاتصال');
        // Session refresh must follow the route chosen by the latest health
        // check, not the public URL captured when this client was created.
        const activeBaseUrl = (await getBaseUrl()).replace(/\/+$/, '');
        try {
          const { data } = await axios.post(`${activeBaseUrl}/auth/refresh`, { refreshToken }, { timeout: 8_000 });
          if (generation !== sessionGeneration) throw new Error('تغيرت جلسة الدخول');
          await setTokens(data.accessToken, data.refreshToken);
          return data.accessToken as string;
        } catch (refreshError) {
          // Never erase a newer login, nor credentials on network/temporary/server failures.
          if ((refreshError as any)?.response?.status === 401 && await getRefreshToken() === refreshToken && generation === sessionGeneration) await clearTokens();
          throw refreshError;
        }
       })();
       refreshFlight = flight;
       void flight.finally(() => { if (refreshFlight === flight) refreshFlight = null; }).catch(() => undefined);
      }
      const token = await refreshFlight;
      if (generation !== sessionGeneration) throw new Error('تغيرت جلسة الدخول');
      req.headers.Authorization = `Bearer ${token}`;
      return c(req);
    },
  );

  return c;
}

export async function getClient(): Promise<AxiosInstance> {
  if (client) return client;
  if (!clientBuild) {
    clientBuild = buildClient().then((built) => { client = built; return built; })
      .finally(() => { clientBuild = null; });
  }
  return clientBuild;
}

/**
 * يُعيد إنشاء العميل بعد تغيير عنوان الخادم من الإعدادات.
 * يجب استدعاؤها من شاشة الإعدادات بعد حفظ عنوان جديد.
 */
export async function resetClient(): Promise<AxiosInstance> {
  // A logout or server/account switch must not inherit a refresh operation or
  // rejected request queue from the previous session.
  sessionGeneration += 1;
  refreshFlight = null;
  client = await buildClient();
  return client;
}

export default new Proxy({} as AxiosInstance, {
  get(_target, prop) {
    if (!client) {
      throw new Error('Axios client not initialized — call getClient() first');
    }
    return (client as any)[prop];
  },
});

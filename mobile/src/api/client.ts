import axios, { AxiosInstance } from 'axios';
import { getBaseUrl } from '../config/api';
import { getAccessToken, getRefreshToken, setTokens, clearTokens } from '../utils/secure-storage';

let client: AxiosInstance | null = null;
let isRefreshing = false;
let pendingRequests: Array<{
  resolve: (token: string) => void;
  reject: (error: unknown) => void;
}> = [];

async function buildClient(): Promise<AxiosInstance> {
  const baseURL = await getBaseUrl();
  const c = axios.create({ baseURL, timeout: 15_000 });

  c.interceptors.request.use(async (config) => {
    const token = await getAccessToken();
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  });

  c.interceptors.response.use(
    (res) => res,
    async (error) => {
      const req = error.config;
      if (error.response?.status !== 401 || req._retry) return Promise.reject(error);
      req._retry = true;

      if (isRefreshing) {
        return new Promise<string>((resolve, reject) => pendingRequests.push({ resolve, reject }))
          .then((token) => {
            req.headers.Authorization = `Bearer ${token}`;
            return c(req);
          });
      }

      isRefreshing = true;
      try {
        const refreshToken = await getRefreshToken();
        if (!refreshToken) throw new Error('No refresh token');
        const { data } = await axios.post(`${baseURL}/auth/refresh`, { refreshToken });
        await setTokens(data.accessToken, data.refreshToken);
        pendingRequests.forEach((pending) => pending.resolve(data.accessToken));
        pendingRequests = [];
        req.headers.Authorization = `Bearer ${data.accessToken}`;
        return c(req);
      } catch (refreshError) {
        pendingRequests.forEach((pending) => pending.reject(refreshError));
        pendingRequests = [];
        const status = (refreshError as any)?.response?.status;
        // A disconnected LAN is not a logout. Clear credentials only when the
        // server explicitly rejects the refresh token.
        if ([400, 401, 403].includes(status)) await clearTokens();
        throw refreshError;
      } finally {
        isRefreshing = false;
      }
    },
  );

  return c;
}

export async function getClient(): Promise<AxiosInstance> {
  if (!client) client = await buildClient();
  return client;
}

/**
 * يُعيد إنشاء العميل بعد تغيير عنوان الخادم من الإعدادات.
 * يجب استدعاؤها من شاشة الإعدادات بعد حفظ عنوان جديد.
 */
export async function resetClient(): Promise<AxiosInstance> {
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

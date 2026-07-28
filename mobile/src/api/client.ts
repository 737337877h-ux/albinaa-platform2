import axios from 'axios';
import { API_BASE_URL } from '../utils/constants';
import { getAccessToken, getRefreshToken, setTokens, clearTokens } from '../utils/secure-storage';

const client = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15_000,
});

let isRefreshing = false;
let pendingRequests: Array<(token: string) => void> = [];

client.interceptors.request.use(async (config) => {
  const token = await getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

client.interceptors.response.use(
  (res) => res,
  async (error) => {
    const req = error.config;
    if (error.response?.status !== 401 || req._retry) return Promise.reject(error);
    req._retry = true;

    if (isRefreshing) {
      return new Promise((resolve) => pendingRequests.push((token) => {
        req.headers.Authorization = `Bearer ${token}`;
        resolve(client(req));
      }));
    }

    isRefreshing = true;
    try {
      const refreshToken = await getRefreshToken();
      if (!refreshToken) throw new Error('No refresh token');
      const { data } = await axios.post(`${API_BASE_URL}/auth/refresh`, { refreshToken });
      await setTokens(data.accessToken, data.refreshToken);
      pendingRequests.forEach((cb) => cb(data.accessToken));
      pendingRequests = [];
      req.headers.Authorization = `Bearer ${data.accessToken}`;
      return client(req);
    } catch (refreshError) {
      await clearTokens();
      pendingRequests = [];
      throw refreshError;
    } finally {
      isRefreshing = false;
    }
  },
);

export default client;

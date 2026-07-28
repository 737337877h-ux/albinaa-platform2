import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import { API_BASE_URL } from '../utils/constants';

const TOKEN_KEY = 'access_token';
const REFRESH_TOKEN_KEY = 'refresh_token';

const client = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15_000,
});

let isRefreshing = false;
let pendingRequests: Array<(token: string) => void> = [];

client.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
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
      const refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
      if (!refreshToken) throw new Error('No refresh token');
      const { data } = await axios.post(`${API_BASE_URL}/auth/refresh`, { refreshToken });
      await SecureStore.setItemAsync(TOKEN_KEY, data.accessToken);
      await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, data.refreshToken);
      pendingRequests.forEach((cb) => cb(data.accessToken));
      pendingRequests = [];
      req.headers.Authorization = `Bearer ${data.accessToken}`;
      return client(req);
    } catch (refreshError) {
      await SecureStore.deleteItemAsync(TOKEN_KEY);
      await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
      pendingRequests = [];
      throw refreshError;
    } finally {
      isRefreshing = false;
    }
  },
);

export async function setTokens(accessToken: string, refreshToken: string) {
  await SecureStore.setItemAsync(TOKEN_KEY, accessToken);
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken);
}

export async function clearTokens() {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
}

export default client;

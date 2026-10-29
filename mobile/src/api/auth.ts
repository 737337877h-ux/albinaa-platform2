import { getClient } from './client';
import { setTokens } from '../utils/secure-storage';

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

export interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  organizationId: string;
  permissions: string[];
  roles: string[];
}

export async function login(username: string, password: string): Promise<LoginResponse> {
  const client = await getClient();
  const { data } = await client.post<LoginResponse>('/auth/login', { username, password });
  await setTokens(data.accessToken, data.refreshToken);
  // The generic web login response intentionally contains only public identity
  // fields. Hydrate the mobile identity from /auth/me so offline data ownership,
  // assignment scope and permissions are never based on missing fields.
  const user = await getMe();
  return { ...data, user };
}

export async function refreshToken(token: string): Promise<LoginResponse> {
  const client = await getClient();
  const { data } = await client.post<LoginResponse>('/auth/refresh', { refreshToken: token });
  await setTokens(data.accessToken, data.refreshToken);
  return data;
}

export async function getMe(): Promise<AuthUser> {
  const client = await getClient();
  const { data } = await client.get<AuthUser>('/auth/me');
  return data;
}

export async function logout(token: string) {
  try {
    const client = await getClient();
    await client.post('/auth/logout', { refreshToken: token });
  } catch { /* ignore */ }
}

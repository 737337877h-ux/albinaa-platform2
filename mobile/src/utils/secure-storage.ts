import * as SecureStore from 'expo-secure-store';
import type { AuthUser } from '../api/auth';

const TOKEN_KEY = 'access_token';
const REFRESH_TOKEN_KEY = 'refresh_token';
const CACHED_USER_KEY = 'albinaa.cached_user';

export async function getAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function getRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
}

export async function setTokens(accessToken: string, refreshToken: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, accessToken);
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken);
}

export async function clearTokens(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
}

export async function getCachedUser(): Promise<AuthUser | null> {
  const value = await SecureStore.getItemAsync(CACHED_USER_KEY);
  if (!value) return null;
  try {
    return JSON.parse(value) as AuthUser;
  } catch {
    await SecureStore.deleteItemAsync(CACHED_USER_KEY);
    return null;
  }
}

export async function setCachedUser(user: AuthUser): Promise<void> {
  await SecureStore.setItemAsync(CACHED_USER_KEY, JSON.stringify(user));
}

export async function clearCachedUser(): Promise<void> {
  await SecureStore.deleteItemAsync(CACHED_USER_KEY);
}

export async function clearSession(): Promise<void> {
  await Promise.all([clearTokens(), clearCachedUser()]);
}

export async function isAuthenticated(): Promise<boolean> {
  const token = await getAccessToken();
  return token !== null;
}

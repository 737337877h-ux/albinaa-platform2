import * as SecureStore from 'expo-secure-store';
import type { AuthUser } from '../api/auth';

const TOKEN_KEY = 'access_token';
const REFRESH_TOKEN_KEY = 'refresh_token';
const SESSION_KEY = 'albinaa.session.v2';

async function tokens(): Promise<{accessToken: string; refreshToken: string} | null> {
  const value = await SecureStore.getItemAsync(SESSION_KEY);
  if (value !== null) return JSON.parse(value);
  // Existing installations migrate on the next successful login/refresh.
  const [accessToken, refreshToken] = await Promise.all([
    SecureStore.getItemAsync(TOKEN_KEY), SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
  ]);
  return accessToken || refreshToken ? {accessToken: accessToken || '', refreshToken: refreshToken || ''} : null;
}
const CACHED_USER_KEY = 'albinaa.cached_user';
const BIOMETRIC_KEY = 'albinaa.biometric_enabled';
const ACTIVITY_KEY = 'albinaa.last_user_activity';
export async function getLastUserActivity() { return Number(await SecureStore.getItemAsync(ACTIVITY_KEY) || 0); }
let activityWrite: Promise<void> = Promise.resolve();
export function setLastUserActivity(value: number) {
  activityWrite = activityWrite.catch(() => undefined).then(() => SecureStore.setItemAsync(ACTIVITY_KEY, String(value)));
  return activityWrite;
}
const REMEMBER_ME_KEY = 'albinaa.remember_me';
const REMEMBERED_USERNAME_KEY = 'albinaa.remembered_username';

export async function getAccessToken(): Promise<string | null> {
  return (await tokens())?.accessToken || null;
}

export async function getRefreshToken(): Promise<string | null> {
  return (await tokens())?.refreshToken || null;
}

export async function setTokens(accessToken: string, refreshToken: string): Promise<void> {
  if (!accessToken || !refreshToken) throw new Error('استجابة جلسة غير مكتملة');
  // A single encrypted write cannot leave a new access token paired with an old refresh token.
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify({accessToken, refreshToken}));
}

export async function clearTokens(): Promise<void> {
  // Tombstone also prevents obsolete legacy tokens from becoming active again.
  await SecureStore.setItemAsync(SESSION_KEY, 'null');
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
  await (await import('../db/database')).purgeInventoryCosts(user.permissions??[]);
  await SecureStore.setItemAsync(CACHED_USER_KEY, JSON.stringify(user));
}

export async function clearCachedUser(): Promise<void> {
  await SecureStore.deleteItemAsync(CACHED_USER_KEY);
}

export async function clearSession(): Promise<void> {
  await Promise.all([clearTokens(), clearCachedUser()]);
}

export async function isBiometricEnabled(): Promise<boolean> {
  return (await SecureStore.getItemAsync(BIOMETRIC_KEY)) === 'true';
}

export async function setBiometricEnabled(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(BIOMETRIC_KEY, enabled ? 'true' : 'false');
}

export async function isRememberMeEnabled(): Promise<boolean> {
  return (await SecureStore.getItemAsync(REMEMBER_ME_KEY)) === 'true';
}

export async function getRememberedUsername(): Promise<string> {
  return (await SecureStore.getItemAsync(REMEMBERED_USERNAME_KEY)) || '';
}

export async function setRememberMe(enabled: boolean, username?: string): Promise<void> {
  await SecureStore.setItemAsync(REMEMBER_ME_KEY, enabled ? 'true' : 'false');
  if (enabled && username?.trim()) {
    await SecureStore.setItemAsync(REMEMBERED_USERNAME_KEY, username.trim());
  } else if (!enabled) {
    await SecureStore.deleteItemAsync(REMEMBERED_USERNAME_KEY);
  }
}

export async function isAuthenticated(): Promise<boolean> {
  const token = await getAccessToken();
  return token !== null;
}

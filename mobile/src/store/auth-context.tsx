import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import { AuthUser, login as apiLogin, logout as apiLogout, getMe } from '../api/auth';
import {
  clearTokens, getAccessToken, getCachedUser, isBiometricEnabled, isRememberMeEnabled,
  setCachedUser, setRememberMe,
} from '../utils/secure-storage';
import { ensureDataOwner } from '../db/database';
import { registerPushDevice, unregisterPushDevice } from '../utils/push-notifications';
import { resetClient } from '../api/client';

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (username: string, password: string, rememberMe?: boolean) => Promise<void>;
  logout: () => Promise<void>;
  unlockOffline: () => Promise<boolean>;
  cachedUser: AuthUser | null;
}

const AuthContext = createContext<AuthState>({
  user: null,
  isLoading: true,
  isAuthenticated: false,
  login: async () => {},
  logout: async () => {},
  unlockOffline: async () => false,
  cachedUser: null,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [cachedUser, setLocalCachedUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const token = await SecureStore.getItemAsync('access_token');
        const cached = await getCachedUser();
        setLocalCachedUser(cached);
        if (cached) {
          await ensureDataOwner(`${cached.organizationId}:${cached.id}`);
          const biometric = await isBiometricEnabled();
          if (!biometric) setUser(cached);
          if (token) {
            try {
              const me = await getMe();
              await ensureDataOwner(`${me.organizationId}:${me.id}`);
              await setCachedUser(me);
              setLocalCachedUser(me);
              if (!biometric) setUser(me);
            } catch { /* keep encrypted identity, tokens, and offline data */ }
          }
        } else if (token) {
          const me = await getMe();
          await ensureDataOwner(`${me.organizationId}:${me.id}`);
          await setCachedUser(me);
          setUser(me);
        }
      } catch { /* local database remains available */ } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (user) registerPushDevice().catch(() => undefined);
  }, [user]);

  const login = useCallback(async (username: string, password: string, rememberMe = false) => {
    await resetClient();
    const data = await apiLogin(username, password);
    await ensureDataOwner(`${data.user.organizationId}:${data.user.id}`);
    await setCachedUser(data.user);
    await setRememberMe(rememberMe, username);
    setLocalCachedUser(data.user);
    setUser(data.user);
  }, []);

  const logout = useCallback(async () => {
    const [rememberMe, biometric] = await Promise.all([
      isRememberMeEnabled(), isBiometricEnabled(),
    ]);
    if (rememberMe && biometric) {
      // Treat sign-out as an encrypted device lock. The refresh token remains
      // in SecureStore so biometric unlock can reconnect and resume sync.
      await resetClient();
      setUser(null);
      return;
    }
    await unregisterPushDevice();
    try {
      const refreshToken = await SecureStore.getItemAsync('refresh_token');
      if (refreshToken) await apiLogout(refreshToken);
    } catch { /* ignore */ }
    // Logging out locks server access but deliberately keeps the encrypted
    // local identity and business cache so the device can be unlocked offline.
    await clearTokens();
    await resetClient();
    setUser(null);
  }, []);

  const unlockOffline = useCallback(async () => {
    const cached = await getCachedUser();
    if (!cached) return false;
    const biometric = await isBiometricEnabled();
    if (biometric) {
      const available = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!available || !enrolled) return false;
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'فتح تطبيق الراقي', cancelLabel: 'إلغاء', fallbackLabel: 'استخدام رمز الهاتف',
      });
      if (!result.success) return false;
    }
    await ensureDataOwner(`${cached.organizationId}:${cached.id}`);
    let activeUser = cached;
    if (await getAccessToken()) {
      try {
        await resetClient();
        activeUser = await getMe();
        await ensureDataOwner(`${activeUser.organizationId}:${activeUser.id}`);
        await setCachedUser(activeUser);
      } catch { /* network unavailable: continue with the encrypted snapshot */ }
    }
    setLocalCachedUser(activeUser);
    setUser(activeUser);
    return true;
  }, []);

  return (
    <AuthContext.Provider value={{ user, cachedUser, isLoading, isAuthenticated: !!user, login, logout, unlockOffline }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { AppState, View } from 'react-native';
import { SessionGate, sessionExpired, listenUserActivity } from '../utils/session-lock';
import { verifyBiometric } from '../utils/biometric-unlock';
import { AuthUser, login as apiLogin, logout as apiLogout, getMe } from '../api/auth';
import {
  clearTokens, getAccessToken, getRefreshToken, getCachedUser, isBiometricEnabled, isRememberMeEnabled,
  setCachedUser, setRememberMe, getLastUserActivity, setLastUserActivity,
} from '../utils/secure-storage';
import { ensureDataOwner, purgeInventoryCosts } from '../db/database';
import { registerPushDevice, unregisterPushDevice } from '../utils/push-notifications';
import { resetClient } from '../api/client';
import { registerBusinessBackgroundSync, unregisterBusinessBackgroundSync } from '../utils/background-sync';

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (username: string, password: string, rememberMe?: boolean) => Promise<void>;
  logout: () => Promise<void>;
  unlockOffline: () => Promise<boolean>;
  refreshUser: () => Promise<AuthUser | null>;
  cachedUser: AuthUser | null;
}

const AuthContext = createContext<AuthState>({
  user: null,
  isLoading: true,
  isAuthenticated: false,
  login: async () => {},
  logout: async () => {},
  unlockOffline: async () => false,
  refreshUser: async () => null,
  cachedUser: null,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [cachedUser, setLocalCachedUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const gate = useRef(new SessionGate());
  const lastPersisted = useRef(0);
  const unlockBusy = useRef(false);
  const persistActivity = useCallback((value: number) => {
    lastPersisted.current = value;
    void setLastUserActivity(value).catch(() => undefined);
  }, []);
  const openSession = useCallback((current: AuthUser) => {
    gate.current.open(); persistActivity(gate.current.lastActivity); setUser(current);
  }, [persistActivity]);
  const lockSession = useCallback(() => {
    gate.current.close(); persistActivity(0); setUser(null);
    void unregisterBusinessBackgroundSync().catch(() => undefined);
    void resetClient();
  }, [persistActivity]);
  const touchActivity = useCallback(() => {
    if (!gate.current.active) return;
    if (sessionExpired(gate.current.lastActivity)) { lockSession(); return; }
    gate.current.lastActivity = Date.now();
    if (Date.now() - lastPersisted.current >= 15000) persistActivity(gate.current.lastActivity);
  }, [lockSession, persistActivity]);
  useEffect(() => listenUserActivity(touchActivity), [touchActivity]);
  useEffect(() => {
    const check = () => { if (gate.current.active && sessionExpired(gate.current.lastActivity)) lockSession(); };
    const timer = setInterval(check, 1000);
    const sub = AppState.addEventListener('change', state => {
      check();
      if (state !== 'active' && gate.current.active) persistActivity(gate.current.lastActivity);
    });
    return () => { clearInterval(timer); sub.remove(); };
  }, [lockSession, persistActivity]);

  useEffect(() => {
    (async () => {
      try {
        const token = await getAccessToken();
        const cached = await getCachedUser();
        setLocalCachedUser(cached);
        if (cached) {
          await ensureDataOwner(`${cached.organizationId}:${cached.id}`);
          await purgeInventoryCosts(cached?.permissions??[]);
          const biometric = await isBiometricEnabled();
          const lastActivity = await getLastUserActivity();
          if (!biometric && token && !sessionExpired(lastActivity)) {
            gate.current.open(lastActivity); setUser(cached);
          }
          // The validated local identity can render immediately while online
          // permissions are refreshed; biometric locking remains unchanged.
          setIsLoading(false);
          if (token) {
            const version = gate.current.version;
            try {
              const me = await getMe();
              await ensureDataOwner(`${me.organizationId}:${me.id}`);
              await setCachedUser(me);
              setLocalCachedUser(me);
              if (!biometric && gate.current.accepts(version)) setUser(me);
            } catch { /* keep encrypted identity, tokens, and offline data */ }
          }
        } else if (token) {
          const me = await getMe();
          await ensureDataOwner(`${me.organizationId}:${me.id}`);
          await setCachedUser(me);
          // A token alone must never bypass the device lock after a restart.
          setLocalCachedUser(me);
        }
      } catch { /* local database remains available */ } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (user) {
      registerPushDevice().then((registered) => {
        if (!registered) console.warn('[Push] الجهاز غير مسجل للإشعارات البعيدة');
      }).catch((error) => console.warn('[Push] خطأ تسجيل غير متوقع', error));
      registerBusinessBackgroundSync().then((registered) => {
        if (!registered) console.warn('[BackgroundSync] خدمة المهام الخلفية غير متاحة على الجهاز');
      }).catch((error) => console.warn('[BackgroundSync] تعذر تسجيل المزامنة الخلفية', error));
    }
  }, [user]);

  const login = useCallback(async (username: string, password: string, rememberMe = false) => {
    await resetClient();
    const data = await apiLogin(username, password);
    await ensureDataOwner(`${data.user.organizationId}:${data.user.id}`);
    await setCachedUser(data.user);
    await setRememberMe(rememberMe, username);
    setLocalCachedUser(data.user);
    openSession(data.user);
  }, [openSession]);

  const logout = useCallback(async () => {
    lockSession();
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
    await unregisterBusinessBackgroundSync().catch(() => undefined);
    try {
      const refreshToken = await getRefreshToken();
      if (refreshToken) await apiLogout(refreshToken);
    } catch { /* ignore */ }
    // Logging out locks server access but deliberately keeps the encrypted
    // local identity and business cache so the device can be unlocked offline.
    await clearTokens();
    await resetClient();
    setUser(null);
  }, [lockSession]);

  const unlockOffline = useCallback(async () => {
    if (unlockBusy.current) return false;
    unlockBusy.current = true;
    const version = gate.current.version;
    try {
    const cached = await getCachedUser();
    if (!cached) return false;
    const biometric = await isBiometricEnabled();
    if (!await verifyBiometric(biometric)) return false;
    if (gate.current.version !== version) return false;
    await ensureDataOwner(`${cached.organizationId}:${cached.id}`);
    // Offline unlock must finish using local storage even when an expired
    // token exists. SyncProvider refreshes permissions when syncing online.
    setLocalCachedUser(cached);
    openSession(cached);
    return true;
    } catch { return false; } finally { unlockBusy.current = false; }
  }, [openSession]);

  const refreshUser = useCallback(async () => {
    const version = gate.current.version;
    if (!gate.current.accepts(version)) return null;
    if (!await getAccessToken()) return null;
    const current = await getMe();
    if (!gate.current.accepts(version)) return null;
    await ensureDataOwner(`${current.organizationId}:${current.id}`);
    await setCachedUser(current);
    setLocalCachedUser(current);
    if (gate.current.accepts(version)) setUser(current);
    return current;
  }, []);

  return (
    <AuthContext.Provider value={{ user, cachedUser, isLoading, isAuthenticated: !!user, login, logout, unlockOffline, refreshUser }}>
      <View style={{ flex: 1 }} onStartShouldSetResponderCapture={() => { touchActivity(); return false; }} onTouchMove={touchActivity}>{children}</View>
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

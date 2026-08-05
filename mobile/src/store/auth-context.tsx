import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import * as SecureStore from 'expo-secure-store';
import { AuthUser, login as apiLogin, logout as apiLogout, getMe } from '../api/auth';
import {
  clearSession, getCachedUser, setCachedUser,
} from '../utils/secure-storage';
import { ensureDataOwner } from '../db/database';

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  isLoading: true,
  isAuthenticated: false,
  login: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const token = await SecureStore.getItemAsync('access_token');
        const cached = await getCachedUser();
        if (token && cached) {
          await ensureDataOwner(`${cached.organizationId}:${cached.id}`);
          // Open immediately from the encrypted cached identity. A network
          // validation follows, but lack of connectivity must not lock the
          // collector out of an already-provisioned device.
          setUser(cached);
          try {
            const me = await getMe();
            await ensureDataOwner(`${me.organizationId}:${me.id}`);
            await setCachedUser(me);
            setUser(me);
          } catch (error: any) {
            // Only an explicit server-side authentication rejection invalidates
            // the offline session. Network errors keep the cached user active.
            if ([400, 401, 403].includes(error?.response?.status)) {
              await clearSession();
              setUser(null);
            }
          }
        } else if (token) {
          const me = await getMe();
          await ensureDataOwner(`${me.organizationId}:${me.id}`);
          await setCachedUser(me);
          setUser(me);
        }
      } catch (error: any) {
        if ([400, 401, 403].includes(error?.response?.status)) await clearSession();
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const data = await apiLogin(username, password);
    await ensureDataOwner(`${data.user.organizationId}:${data.user.id}`);
    await setCachedUser(data.user);
    setUser(data.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      const refreshToken = await SecureStore.getItemAsync('refresh_token');
      if (refreshToken) await apiLogout(refreshToken);
    } catch { /* ignore */ }
    await clearSession();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, isAuthenticated: !!user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

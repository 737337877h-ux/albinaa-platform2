import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import * as SecureStore from 'expo-secure-store';
import { AuthUser, login as apiLogin, logout as apiLogout, getMe } from '../api/auth';
import { clearTokens } from '../utils/secure-storage';
import { dedupeTable } from '../db/database';

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
        // Clean duplicates from previous buggy syncs (one-time per app start)
        await dedupeTable('customers');
        await dedupeTable('tasks');
        await dedupeTable('followups');
        await dedupeTable('promises');
        await dedupeTable('collections');
        const token = await SecureStore.getItemAsync('access_token');
        if (token) {
          const me = await getMe();
          setUser(me);
        }
      } catch {
        await clearTokens();
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const data = await apiLogin(username, password);
    setUser(data.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      const refreshToken = await SecureStore.getItemAsync('refresh_token');
      if (refreshToken) await apiLogout(refreshToken);
    } catch { /* ignore */ }
    await clearTokens();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, isAuthenticated: !!user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

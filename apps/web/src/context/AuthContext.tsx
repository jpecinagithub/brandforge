import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { get, post } from '@/lib/api';
import type { User, Workspace } from '@/lib/types';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (name: string, email: string, password: string) => Promise<void>;
  startDemo: () => Promise<{ user: User; workspace: Workspace }>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  refresh: () => Promise<void>;
  setUser: (u: User | null) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await get<{ user: User }>('/api/v1/auth/me');
      setUser(res.user);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await post<{ user: User }>('/api/v1/auth/login', { email, password });
    setUser(res.user);
    return res.user;
  }, []);

  const register = useCallback(async (name: string, email: string, password: string) => {
    await post('/api/v1/auth/register', { name, email, password });
    // Session is NOT created until email verification — stay logged out.
  }, []);

  const startDemo = useCallback(async () => {
    const res = await post<{ user: User; workspace: Workspace }>('/api/v1/auth/demo');
    setUser(res.user);
    return res;
  }, []);

  const logout = useCallback(async () => {
    try {
      await post('/api/v1/auth/logout');
    } finally {
      setUser(null);
    }
  }, []);

  const logoutAll = useCallback(async () => {
    try {
      await post('/api/v1/auth/logout-all');
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, register, startDemo, logout, logoutAll, refresh, setUser }),
    [user, loading, login, register, startDemo, logout, logoutAll, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

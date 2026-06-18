import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { api } from './api';

export interface AdminPrincipal {
  id: string;
  name: string;
}

interface AdminAuthValue {
  admin: AdminPrincipal | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AdminAuthValue | null>(null);

export function useAdminAuth(): AdminAuthValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAdminAuth must be used within AdminAuthProvider');
  return ctx;
}

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<AdminPrincipal | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void api<AdminPrincipal>('/auth/admin/me')
      .then((me) => setAdmin(me))
      .catch(() => setAdmin(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    await api('/auth/admin/login', { method: 'POST', body: { email, password } });
    const me = await api<AdminPrincipal>('/auth/admin/me');
    setAdmin(me);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('/auth/admin/logout', { method: 'POST' });
    } catch {
      /* ignore */
    }
    setAdmin(null);
  }, []);

  return <Ctx.Provider value={{ admin, loading, login, logout }}>{children}</Ctx.Provider>;
}

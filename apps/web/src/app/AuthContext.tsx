import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { api, setBarberToken, getBarberToken, getShopSlug } from '../api';

export interface Principal {
  kind: 'owner' | 'barber';
  id: string;
  name: string;
  shopId: string;
}

interface AuthContextValue {
  principal: Principal | null;
  loading: boolean;
  loginOwner: (email: string, password: string) => Promise<void>;
  loginBarber: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

interface MeResponse {
  id: string;
  shopId: string;
  name: string;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    // Resolve this app's pinned shop once. If it's missing/inactive, nobody is
    // signed in (every tenant-scoped call would 404 anyway).
    let shopId: string | null = null;
    try {
      const { shop } = await api<{ shop: { id: string } }>('/api/shop');
      shopId = shop.id;
    } catch {
      shopId = null;
    }

    if (shopId) {
      try {
        const me = await api<MeResponse>('/auth/owner/me');
        if (me.shopId === shopId) {
          setPrincipal({ kind: 'owner', id: me.id, name: me.name, shopId: me.shopId });
          return;
        }
        // Session belongs to a DIFFERENT shop than this build serves — drop it so we
        // never render another shop's (empty) console.
        await api('/auth/owner/logout', { method: 'POST' }).catch(() => undefined);
      } catch {
        /* not an owner */
      }
      if (getBarberToken()) {
        try {
          const me = await api<MeResponse>('/auth/barber/me');
          if (me.shopId === shopId) {
            setPrincipal({ kind: 'barber', id: me.id, name: me.name, shopId: me.shopId });
            return;
          }
          setBarberToken(null);
        } catch {
          setBarberToken(null);
        }
      }
    }
    setPrincipal(null);
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const loginOwner = useCallback(async (email: string, password: string) => {
    setBarberToken(null); // owner mode uses the session cookie only
    // Resolve THIS app's pinned shop first — a missing/inactive shop 404s here with
    // "Shop not found" before we even authenticate.
    const { shop } = await api<{ shop: { id: string } }>('/api/shop');
    const r = await api<{ name: string; shopId: string }>('/auth/owner/login', {
      method: 'POST',
      body: { email, password },
    });
    // The credentials may be valid but for a DIFFERENT shop. Reject instead of
    // dropping them into an empty console that 404s on every tenant-scoped call.
    if (r.shopId !== shop.id) {
      await api('/auth/owner/logout', { method: 'POST' }).catch(() => undefined);
      throw new Error(`This account doesn't manage ${getShopSlug()}.`);
    }
    // /me gives us the owner id too
    const me = await api<MeResponse>('/auth/owner/me');
    setPrincipal({ kind: 'owner', id: me.id, name: r.name, shopId: r.shopId });
  }, []);

  const loginBarber = useCallback(async (email: string, password: string) => {
    // Resolve the current shop (slug → id) and clear any owner session so
    // requireStaff resolves us as the barber.
    const { shop } = await api<{ shop: { id: string } }>('/api/shop');
    try {
      await api('/auth/owner/logout', { method: 'POST' });
    } catch {
      /* no owner session */
    }
    const r = await api<{ token: string; barber: { id: string; name: string; shopId: string } }>(
      '/auth/barber/login',
      { method: 'POST', body: { email, password, shopId: shop.id } },
    );
    setBarberToken(r.token);
    setPrincipal({ kind: 'barber', id: r.barber.id, name: r.barber.name, shopId: r.barber.shopId });
  }, []);

  const logout = useCallback(async () => {
    setBarberToken(null);
    try {
      await api('/auth/owner/logout', { method: 'POST' });
    } catch {
      /* ignore */
    }
    setPrincipal(null);
  }, []);

  return (
    <AuthContext.Provider value={{ principal, loading, loginOwner, loginBarber, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

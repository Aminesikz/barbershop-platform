import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import type { Shop } from '@barber/shared-types';
import {
  api,
  setBarberToken,
  getBarberToken,
  getShopSlug,
  onUnauthorized,
  SIGNED_OUT_MESSAGE,
} from '../api';
import { useToast } from '../components/Toast';

export interface Principal {
  kind: 'owner' | 'barber';
  id: string;
  name: string;
  shopId: string;
}

interface AuthContextValue {
  principal: Principal | null;
  /** The shop this page maps to (from the hostname). null = unknown/inactive shop. */
  shop: Shop | null;
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
  const toast = useToast();
  const [principal, setPrincipalState] = useState<Principal | null>(null);
  const [shop, setShop] = useState<Shop | null>(null);
  const [loading, setLoading] = useState(true);

  // Mirror of `principal` that updates SYNCHRONOUSLY, so the 401 listener below
  // can tell "session died underneath us" from "we just aren't logged in" without
  // waiting for a re-render (an intentional logout clears this before the server
  // round-trip, so its own 401 can't race a spurious toast).
  const principalRef = useRef<Principal | null>(null);
  const setPrincipal = useCallback((p: Principal | null) => {
    principalRef.current = p;
    setPrincipalState(p);
  }, []);

  // A 401 while someone is signed in means the session/token no longer exists
  // (logged out in another tab — the cookie is shared across the whole domain —
  // or expired). Drop to the login screen instead of a half-logged-in console.
  useEffect(() => {
    onUnauthorized(() => {
      if (!principalRef.current) return;
      setPrincipal(null);
      setBarberToken(null);
      toast(SIGNED_OUT_MESSAGE, 'error');
    });
    return () => onUnauthorized(null);
  }, [setPrincipal, toast]);

  const refresh = useCallback(async () => {
    setLoading(true);
    // Resolve the shop this page maps to (from the hostname-derived slug). A
    // missing/inactive shop 404s → shop stays null and the app shows ShopNotFound.
    // No slug at all (bare apex / reserved subdomain) → skip the guaranteed-404
    // lookup entirely; the app shows the platform landing page.
    let resolved: Shop | null = null;
    if (getShopSlug()) {
      try {
        const r = await api<{ shop: Shop }>('/api/shop');
        resolved = r.shop;
      } catch {
        resolved = null;
      }
    }
    setShop(resolved);

    if (resolved) {
      try {
        const me = await api<MeResponse>('/auth/owner/me');
        if (me.shopId === resolved.id) {
          setPrincipal({ kind: 'owner', id: me.id, name: me.name, shopId: me.shopId });
          return;
        }
        // Session belongs to a DIFFERENT shop — drop it so we never render another
        // shop's (empty) console.
        await api('/auth/owner/logout', { method: 'POST' }).catch(() => undefined);
      } catch {
        /* not an owner */
      }
      if (getBarberToken()) {
        try {
          const me = await api<MeResponse>('/auth/barber/me');
          if (me.shopId === resolved.id) {
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
  }, [setPrincipal]);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const loginOwner = useCallback(async (email: string, password: string) => {
    setBarberToken(null); // owner mode uses the session cookie only
    const r0 = await api<{ shop: Shop }>('/api/shop');
    setShop(r0.shop);
    const r = await api<{ name: string; shopId: string }>('/auth/owner/login', {
      method: 'POST',
      body: { email, password },
    });
    // Credentials may be valid but for a DIFFERENT shop. Reject instead of dropping
    // them into an empty console that 404s on every tenant-scoped call.
    if (r.shopId !== r0.shop.id) {
      await api('/auth/owner/logout', { method: 'POST' }).catch(() => undefined);
      throw new Error(`This account doesn't manage ${r0.shop.name ?? r0.shop.slug}.`);
    }
    const me = await api<MeResponse>('/auth/owner/me');
    setPrincipal({ kind: 'owner', id: me.id, name: r.name, shopId: r.shopId });
  }, [setPrincipal]);

  const loginBarber = useCallback(async (email: string, password: string) => {
    // Resolve the current shop (slug → id) and clear any owner session so
    // requireStaff resolves us as the barber.
    const r0 = await api<{ shop: Shop }>('/api/shop');
    setShop(r0.shop);
    try {
      await api('/auth/owner/logout', { method: 'POST' });
    } catch {
      /* no owner session */
    }
    const r = await api<{ token: string; barber: { id: string; name: string; shopId: string } }>(
      '/auth/barber/login',
      { method: 'POST', body: { email, password, shopId: r0.shop.id } },
    );
    setBarberToken(r.token);
    setPrincipal({ kind: 'barber', id: r.barber.id, name: r.barber.name, shopId: r.barber.shopId });
  }, [setPrincipal]);

  const logout = useCallback(async () => {
    // Clear local auth FIRST: for barbers the owner/logout call below answers 401
    // (no owner session), and the 401 listener must see us as already signed out.
    setPrincipal(null);
    setBarberToken(null);
    try {
      await api('/auth/owner/logout', { method: 'POST' });
    } catch {
      /* ignore */
    }
  }, [setPrincipal]);

  return (
    <AuthContext.Provider value={{ principal, shop, loading, loginOwner, loginBarber, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

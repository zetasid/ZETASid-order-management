import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSession, login, logout, setCsrfToken, ApiError, type AuthSession } from '@workspace/api-client-react';

type Auth = {
  user: AuthSession['user'] | null; loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};
const Context = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [user, setUser] = useState<AuthSession['user'] | null>(null);
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const restoring = useRef<AbortController | null>(null);
  const changing = useRef(false);
  const clear = useCallback(async () => {
    generation.current++; restoring.current?.abort();
    setUser(null); setCsrfToken(null); setLoading(false);
    await client.cancelQueries();
    client.clear();
  }, [client]);
  const restore = useCallback(async () => {
    if (changing.current) return;
    restoring.current?.abort();
    const controller = new AbortController();
    restoring.current = controller;
    const ticket = ++generation.current;
    try {
      const session = await getSession({ signal: controller.signal });
      if (ticket !== generation.current) return;
      setCsrfToken(session.csrfToken); setUser(session.user);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) await clear();
    } finally { if (ticket === generation.current) setLoading(false); }
  }, [clear]);
  useEffect(() => {
    void restore();
    const expired = () => { void clear(); };
    const focus = () => { void restore(); };
    const otherTab = (event: StorageEvent) => {
      if (event.key === 'zetas-auth-logout') void clear();
    };
    window.addEventListener('zetas:session-expired', expired);
    window.addEventListener('focus', focus);
    window.addEventListener('storage', otherTab);
    return () => {
      restoring.current?.abort();
      window.removeEventListener('zetas:session-expired', expired);
      window.removeEventListener('focus', focus);
      window.removeEventListener('storage', otherTab);
    };
  }, [clear, restore]);
  const signIn = async (email: string, password: string) => {
    changing.current = true; generation.current++; restoring.current?.abort();
    try {
      await client.cancelQueries(); client.clear();
      const session = await login({ email: email.trim(), password });
      setCsrfToken(session.csrfToken); setUser(session.user);
    } finally { changing.current = false; setLoading(false); }
  };
  const signOut = async () => {
    changing.current = true; generation.current++; restoring.current?.abort();
    try {
      try { await logout(); } catch (error) {
        if (!(error instanceof ApiError && error.status === 401)) throw error;
      }
      await clear();
      // This nonsensitive event clears other tabs; no credentials are stored.
      try { localStorage.setItem('zetas-auth-logout', String(Date.now())); } catch { /* Storage may be disabled. */ }
    } finally {
      changing.current = false;
    }
  };
  return <Context.Provider value={{ user, loading, signIn, signOut }}>{children}</Context.Provider>;
}
export function useAuth() {
  const auth = useContext(Context);
  if (!auth) throw new Error('Auth provider unavailable');
  return auth;
}
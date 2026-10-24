import { createContext, useCallback, useEffect, useRef, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, apiPost, setAccessToken, setRefreshHandler } from '../lib/apiClient';
import type { AuthResponse, PublicUser } from '../lib/types';

type Status = 'loading' | 'signedIn' | 'signedOut' | 'offline';

export type AuthContextValue = {
  status: Status;
  user: PublicUser | null;
  signIn(res: AuthResponse): void;
  setUser(u: PublicUser): void;
  signOut(): Promise<void>;
  /** Re-attempts the session refresh after a transient boot failure (status 'offline'). */
  retry(): void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

type Session = { status: Status; user: PublicUser | null };

/** Shared by every caller in this tab so a rotating refresh token is presented once. */
let inflight: Promise<string | null> | null = null;

export function AuthProvider({ children, initialUser }: { children: ReactNode; initialUser?: PublicUser | null }) {
  const [session, setSession] = useState<Session>(() =>
    initialUser === undefined
      ? { status: 'loading', user: null }
      : { status: initialUser ? 'signedIn' : 'signedOut', user: initialUser },
  );
  // Set during the first render so children's effects (which run before ours) already see the token.
  useState(() => {
    if (initialUser) setAccessToken('test-token');
  });

  // Bumped by every sign-in/sign-out so a refresh that was in flight meanwhile cannot overwrite the newer state.
  const generation = useRef(0);

  const clear = useCallback(() => {
    generation.current += 1;
    setAccessToken(null);
    setSession({ status: 'signedOut', user: null });
  }, []);

  const refresh = useCallback((): Promise<string | null> => {
    if (inflight) return inflight;
    const run = async (): Promise<string | null> => {
      const gen = generation.current;
      try {
        const res = await apiPost<AuthResponse>('/auth/refresh', {});
        if (generation.current !== gen) return null;
        setAccessToken(res.accessToken);
        setSession({ status: 'signedIn', user: res.user });
        return res.accessToken;
      } catch (err) {
        if (generation.current !== gen) return null;
        if (err instanceof ApiError && err.status === 401) {
          clear();
        } else {
          // Network error, 5xx or 429: the refresh token may well still be valid, so keep what we have.
          // At boot there is no session yet, so surface 'offline' instead of pretending the player is signed out.
          setSession((s) => (s.status === 'loading' || s.status === 'offline' ? { status: 'offline', user: null } : s));
        }
        return null;
      }
    };
    const guarded = async (): Promise<string | null> => {
      const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
      if (!locks) return run();
      try {
        return await locks.request('auth-refresh', () => run());
      } catch {
        // The Locks API itself failed (e.g. SecurityError in a sandboxed frame); run() never rejects.
        return run();
      }
    };
    const p = guarded().finally(() => {
      inflight = null;
    });
    inflight = p;
    return p;
  }, [clear]);

  useLayoutEffect(() => {
    setRefreshHandler(refresh);
    if (initialUser === undefined) void refresh();
    return () => setRefreshHandler(null);
    // initialUser is only meaningful at mount.
  }, [refresh]);

  const retry = useCallback(() => {
    setSession((s) => (s.status === 'offline' ? { status: 'loading', user: null } : s));
    void refresh();
  }, [refresh]);

  const offline = session.status === 'offline';
  useEffect(() => {
    if (!offline) return;
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [offline, retry]);

  const signIn = useCallback((res: AuthResponse) => {
    generation.current += 1;
    setAccessToken(res.accessToken);
    setSession({ status: 'signedIn', user: res.user });
  }, []);

  const setUser = useCallback((u: PublicUser) => setSession((s) => ({ ...s, user: u })), []);

  const signOut = useCallback(async () => {
    generation.current += 1;
    try {
      await apiPost('/auth/logout', {});
    } catch {
      // Local state is cleared regardless.
    }
    clear();
  }, [clear]);

  const value = useMemo<AuthContextValue>(
    () => ({ ...session, signIn, setUser, signOut, retry }),
    [session, signIn, setUser, signOut, retry],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

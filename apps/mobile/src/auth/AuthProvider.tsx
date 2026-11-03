import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import type { PublicUser } from '@booking/shared';
import { ApiError, apiPost, setAccessToken, setRefreshHandler } from '../lib/api';
import { getRefreshToken, setRefreshToken } from '../lib/secureToken';
import { AuthContext, type AuthContextValue, type AuthStatus, type NativeAuthResponse } from './useAuth';

type Session = { status: AuthStatus; user: PublicUser | null };

/** Shared by every caller so a rotating refresh token is presented once: reuse revokes the whole family. */
let inflight: Promise<string | null> | null = null;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>({ status: 'loading', user: null });

  // Bumped by every sign-in/sign-out so a refresh that was in flight meanwhile cannot overwrite the newer state.
  const generation = useRef(0);
  // The newest refresh token, held in memory so a failed SecureStore write cannot strand us on a spent one.
  // undefined = not read from storage yet.
  const memToken = useRef<string | null | undefined>(undefined);
  const readToken = useCallback(async () => (memToken.current !== undefined ? memToken.current : getRefreshToken()), []);

  const clear = useCallback(async () => {
    generation.current += 1;
    setAccessToken(null);
    memToken.current = null;
    setSession({ status: 'signedOut', user: null });
    await setRefreshToken(null).catch(() => undefined);
  }, []);

  const refresh = useCallback((): Promise<string | null> => {
    if (inflight) return inflight;
    const run = async (): Promise<string | null> => {
      const gen = generation.current;
      try {
        const stored = await readToken();
        if (generation.current !== gen) return null;
        if (!stored) {
          setSession({ status: 'signedOut', user: null });
          return null;
        }
        const res = await apiPost<NativeAuthResponse>('/auth/refresh', { refreshToken: stored });
        if (generation.current !== gen) return null;
        // Persist the rotated token before anything else: the old one is now spent.
        // The server has already spent the old token, so a failed write must not discard the new pair.
        await setRefreshToken(res.refreshToken).catch(() => undefined);
        if (generation.current !== gen) return null;
        memToken.current = res.refreshToken;
        setAccessToken(res.accessToken);
        setSession({ status: 'signedIn', user: res.user });
        return res.accessToken;
      } catch (err) {
        if (generation.current !== gen) return null;
        if (err instanceof ApiError && err.status === 401) {
          await clear();
        } else {
          // Network error, 5xx or 429: the refresh token may well still be valid, so keep what we have.
          // At boot there is no session yet, so surface 'offline' instead of pretending the player is signed out.
          setSession((s) => (s.status === 'loading' || s.status === 'offline' ? { status: 'offline', user: null } : s));
        }
        return null;
      }
    };
    const p = run().finally(() => {
      inflight = null;
    });
    inflight = p;
    return p;
  }, [clear, readToken]);

  useLayoutEffect(() => {
    setRefreshHandler(refresh);
    void refresh();
    return () => setRefreshHandler(null);
  }, [refresh]);

  const retry = useCallback(() => {
    setSession((s) => (s.status === 'offline' ? { status: 'loading', user: null } : s));
    void refresh();
  }, [refresh]);

  const offline = session.status === 'offline';
  useEffect(() => {
    if (!offline) return;
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') retry();
    });
    return () => sub.remove();
  }, [offline, retry]);

  const signIn = useCallback(async (res: NativeAuthResponse) => {
    generation.current += 1;
    memToken.current = res.refreshToken;
    await setRefreshToken(res.refreshToken).catch(() => undefined);
    setAccessToken(res.accessToken);
    setSession({ status: 'signedIn', user: res.user });
  }, []);

  const setUser = useCallback((u: PublicUser) => setSession((s) => ({ ...s, user: u })), []);

  const signOut = useCallback(async () => {
    generation.current += 1;
    try {
      const refreshToken = await readToken();
      if (refreshToken) await apiPost('/auth/logout', { refreshToken });
    } catch {
      // Local state is cleared regardless.
    }
    await clear();
  }, [clear, readToken]);

  const value = useMemo<AuthContextValue>(
    () => ({ ...session, signIn, setUser, signOut, retry }),
    [session, signIn, setUser, signOut, retry],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

import { createContext, useContext } from 'react';
import type { AuthResponse, PublicUser } from '@booking/shared';

export type AuthStatus = 'loading' | 'signedIn' | 'signedOut' | 'offline';

/** What native clients get from every auth endpoint: the refresh token travels in the body, not a cookie. */
export type NativeAuthResponse = AuthResponse & { refreshToken: string };

export type AuthContextValue = {
  status: AuthStatus;
  user: PublicUser | null;
  signIn(res: NativeAuthResponse): Promise<void>;
  setUser(u: PublicUser): void;
  signOut(): Promise<void>;
  /** Re-attempts the session refresh after a transient boot failure (status 'offline'). */
  retry(): void;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

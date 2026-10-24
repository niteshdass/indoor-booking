import type { PublicUser } from '../lib/types';

/** Stub until Task 4 adds AuthProvider: always signed out. */
export function useAuth(): { user: PublicUser | null } {
  return { user: null };
}

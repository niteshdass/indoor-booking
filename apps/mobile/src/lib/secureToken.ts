import * as SecureStore from 'expo-secure-store';

const KEY = 'rt';

/** The long-lived refresh token lives in the OS keychain/keystore, never in plain storage. */
export function getRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(KEY);
}

export async function setRefreshToken(t: string | null): Promise<void> {
  if (t) await SecureStore.setItemAsync(KEY, t);
  else await SecureStore.deleteItemAsync(KEY);
}

/**
 * Browser storage that belongs to the signed-in user, not to the device: setup drafts (address, wallet
 * numbers) and the last business opened. Forgotten on sign-out so the next person on a shared computer
 * does not see them. Theme, language and layout choices stay.
 */
const USER_KEY_PREFIXES = ['setup-draft', 'owner.last'];

export function forgetUserStorage(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && USER_KEY_PREFIXES.some((p) => k === p || k.startsWith(`${p}:`))) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
  } catch {
    // Storage blocked: nothing was kept to forget.
  }
}

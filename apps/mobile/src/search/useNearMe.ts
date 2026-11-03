import { useCallback, useEffect, useState } from 'react';
import * as Location from 'expo-location';

export type Coords = { lat: number; lng: number };

/** Set once the player says no (or the system blocks the prompt): we never ask again this session. */
let decidedNo = false;

/** For tests: forget the session's decision. */
export function __resetLocationDecision(): void {
  decidedNo = false;
}

/**
 * Foreground location on request. `blocked` means the player cannot or will not share a location, so the screen
 * shows the city search instead; once true it never asks again.
 */
export function useNearMe(): {
  blocked: boolean;
  locating: boolean;
  /** The last attempt failed for another reason than permission (no fix, services off). */
  failed: boolean;
  locate(): Promise<Coords | null>;
} {
  const [blocked, setBlocked] = useState(decidedNo);
  const [locating, setLocating] = useState(false);
  const [failed, setFailed] = useState(false);

  const block = useCallback(() => {
    decidedNo = true;
    setBlocked(true);
  }, []);

  useEffect(() => {
    if (decidedNo) return;
    let live = true;
    Location.getForegroundPermissionsAsync()
      .then((p) => {
        if (live && p.status === 'denied' && !p.canAskAgain) block();
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [block]);

  const locate = useCallback(async (): Promise<Coords | null> => {
    if (decidedNo) return null;
    setLocating(true);
    setFailed(false);
    try {
      let perm = await Location.getForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        if (perm.status === 'denied' && !perm.canAskAgain) {
          block();
          return null;
        }
        perm = await Location.requestForegroundPermissionsAsync();
      }
      if (perm.status !== 'granted') {
        block();
        return null;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      return { lat: pos.coords.latitude, lng: pos.coords.longitude };
    } catch {
      setFailed(true);
      return null;
    } finally {
      setLocating(false);
    }
  }, [block]);

  return { blocked, locating, failed, locate };
}

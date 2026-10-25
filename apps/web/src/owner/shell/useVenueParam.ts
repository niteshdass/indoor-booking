import { useCallback } from 'react';
import { useSearchParams } from 'react-router';
import { useOwner } from '../OwnerProvider';
import type { OwnerVenue } from '../types';

/** The venue chosen by `?venue=`, else the owner's first venue; the setter keeps the other search params. */
export function useVenueParam(): [venue: OwnerVenue | null, setVenueId: (id: string) => void] {
  const { venues } = useOwner();
  const [params, setParams] = useSearchParams();
  const id = params.get('venue');
  const venue = venues.find((v) => v.id === id) ?? venues[0] ?? null;
  const setVenueId = useCallback(
    (next: string) =>
      setParams(
        (prev) => {
          const copy = new URLSearchParams(prev);
          copy.set('venue', next);
          return copy;
        },
        { replace: true },
      ),
    [setParams],
  );
  return [venue, setVenueId];
}

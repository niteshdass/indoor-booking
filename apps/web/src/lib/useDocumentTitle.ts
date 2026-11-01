import { useEffect } from 'react';
import { useLocation } from 'react-router';

export const BRAND = 'BookaTurf';

/** Tab title "<title> · BookaTurf" (bare brand without one); re-applied on every page change. */
export function useDocumentTitle(title?: string | null): void {
  const { pathname } = useLocation();
  useEffect(() => {
    document.title = title ? `${title} · ${BRAND}` : BRAND;
  }, [title, pathname]);
}

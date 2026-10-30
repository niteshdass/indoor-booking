import { useCallback, useRef, useState } from 'react';

const NONE: ReadonlySet<string> = new Set();

/**
 * Keeps a row on screen while one of its dialogs is open, even after a refresh or the clock drops it from its list, so
 * the dialog is not torn down under someone's fingers. `keep(rows)` returns the rows plus the held ones (as last seen)
 * at the end; `opened(key, isOpen)` is what each row reports.
 */
export function useKeepWhileOpen<T>(keyOf: (row: T) => string) {
  const [open, setOpen] = useState<ReadonlySet<string>>(NONE);
  const last = useRef(new Map<string, T>());

  const keep = (rows: T[]): T[] => {
    const shown = new Map(rows.map((r) => [keyOf(r), r] as const));
    const held = [...open].flatMap((k) => (shown.has(k) || !last.current.has(k) ? [] : [last.current.get(k)!]));
    last.current = new Map([...shown, ...held.map((r) => [keyOf(r), r] as const)]);
    return held.length > 0 ? [...rows, ...held] : rows;
  };

  const opened = useCallback(
    (key: string, isOpen: boolean) =>
      setOpen((s) => {
        if (s.has(key) === isOpen) return s;
        const next = new Set(s);
        if (isOpen) next.add(key);
        else next.delete(key);
        return next;
      }),
    [],
  );

  return { keep, opened };
}

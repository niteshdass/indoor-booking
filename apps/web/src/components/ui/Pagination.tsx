import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './Pagination.module.css';

/** Rows on one page of a list table. */
export const PAGE_SIZE = 25;

type Options = {
  pageSize?: number;
  /** A change (new filters, a new search) sends the list back to page 1. */
  resetKey?: unknown;
  /** Controlled page, e.g. from the URL; leave out to keep the page in local state. */
  page?: number;
  onPage?: (page: number) => void;
};

/** One page of `items`. The page is clamped to the pages that exist, so a shorter list never shows an empty page. */
export function usePagination<T>(items: readonly T[], options: Options = {}) {
  const pageSize = options.pageSize ?? PAGE_SIZE;
  const [own, setOwn] = useState({ key: options.resetKey, page: 1 });
  const wanted = options.page ?? (Object.is(own.key, options.resetKey) ? own.page : 1);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(Math.max(1, wanted), pageCount);
  const setPage = (next: number) => (options.onPage ? options.onPage(next) : setOwn({ key: options.resetKey, page: next }));
  return { rows: items.slice((page - 1) * pageSize, page * pageSize), page, setPage, pageSize, total: items.length };
}

/** Page numbers to show: the first, the last and the current one with its neighbours; `null` marks a gap. */
export function pageList(page: number, count: number): (number | null)[] {
  const keep = new Set([1, count, page - 1, page, page + 1].filter((n) => n >= 1 && n <= count));
  const sorted = [...keep].sort((a, b) => a - b);
  const out: (number | null)[] = [];
  sorted.forEach((n, i) => {
    const prev = sorted[i - 1];
    if (prev !== undefined && n - prev === 2) out.push(prev + 1);
    else if (prev !== undefined && n - prev > 2) out.push(null);
    out.push(n);
  });
  return out;
}

export type PaginationProps = {
  page: number;
  pageSize: number;
  /** Rows loaded so far. */
  total: number;
  onPage: (page: number) => void;
  /** The server has rows past `total`; Next stays enabled on the last loaded page. */
  more?: boolean;
  /** The next server batch is loading. */
  loading?: boolean;
};

/**
 * Pager under a list table: the shown range on the start side, previous / page numbers / next on the end side.
 * Renders nothing while everything fits on one page. Put it right after the `Table`: a page change scrolls
 * back to the table's top when that has left the screen.
 */
export function Pagination({ page, pageSize, total, onPage, more = false, loading = false }: PaginationProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLElement>(null);
  const count = Math.max(1, Math.ceil(total / pageSize));
  if (count <= 1 && !more) return null;

  const go = (next: number) => {
    onPage(next);
    const table = ref.current?.previousElementSibling;
    if (table && table.getBoundingClientRect().top < 0) table.scrollIntoView?.({ block: 'start' });
  };
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <nav ref={ref} className={styles.pager} aria-label={t('pagination.label')}>
      <p className={styles.range}>{t(more ? 'pagination.rangeMore' : 'pagination.range', { from, to, total })}</p>
      <div className={styles.controls}>
        <button type="button" className={styles.step} aria-label={t('pagination.previous')} disabled={page <= 1} onClick={() => go(page - 1)}>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
        <ol className={styles.pages}>
          {pageList(page, count).map((n, i) =>
            n === null ? (
              <li key={`gap${i}`} className={styles.gap} aria-hidden="true">
                …
              </li>
            ) : (
              <li key={n}>
                <button
                  type="button"
                  className={styles.page}
                  aria-label={t('pagination.page', { page: n })}
                  aria-current={n === page ? 'page' : undefined}
                  onClick={() => n !== page && go(n)}
                >
                  {n}
                </button>
              </li>
            ),
          )}
        </ol>
        {/* Phones show the position as text instead of the numbers. */}
        <span className={styles.position}>{t('pagination.position', { page, count })}</span>
        <button
          type="button"
          className={styles.step}
          aria-label={t('pagination.next')}
          aria-busy={loading || undefined}
          disabled={loading || (page >= count && !more)}
          onClick={() => go(page + 1)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      </div>
    </nav>
  );
}

/**
 * `usePagination` as a wrapper, for lists only known after a component's early returns:
 * `children` renders the table for one page of rows, and the pager follows it. For a list the server hands
 * out in batches, `more` says another batch exists and `onMore` fetches it (resolving false on failure)
 * when Next leaves the rows loaded so far.
 */
export function Paged<T>({
  items,
  pageSize,
  resetKey,
  more,
  loading,
  onMore,
  children,
}: {
  items: readonly T[];
  pageSize?: number;
  resetKey?: unknown;
  more?: boolean;
  loading?: boolean;
  onMore?: () => Promise<boolean>;
  children: (rows: T[]) => ReactNode;
}) {
  const pg = usePagination(items, { pageSize, resetKey });
  const go = async (page: number) => {
    // A page past the loaded rows needs the next batch first; on failure stay put.
    if ((page - 1) * pg.pageSize >= pg.total && onMore && !(await onMore())) return;
    pg.setPage(page);
  };
  return (
    <>
      {children(pg.rows)}
      <Pagination page={pg.page} pageSize={pg.pageSize} total={pg.total} more={more} loading={loading} onPage={(n) => void go(n)} />
    </>
  );
}

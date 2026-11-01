import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Spinner } from '../components/ui/Spinner';
import { Skeleton } from '../components/ui/Skeleton';
import { errorMessage } from '../lib/errors';
import { ResultCard, type ResultLayout } from './ResultCard';
import { SearchForm } from './SearchForm';
import { criteriaFromParams, criteriaToParams, type Bbox, type Criteria } from './searchParams';
import { useSearch } from './useSearch';
import styles from './SearchPage.module.css';
import { useDocumentTitle } from '../lib/useDocumentTitle';

const ResultsMap = lazy(() => import('./ResultsMap').then((m) => ({ default: m.ResultsMap })));

const LG = '(min-width: 1024px)';
const LAYOUT_KEY = 'search.layout';

const LAYOUT_ICONS: Record<ResultLayout, string> = {
  rows: 'M3 5h6v5H3zM12 6h9M12 9h6M3 14h6v5H3zM12 15h9M12 18h6',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
};

/** Rows or grid, remembered in this browser only; storage may be unavailable. */
function useLayout(): [ResultLayout, (l: ResultLayout) => void] {
  const [layout, setLayout] = useState<ResultLayout>(() => {
    try {
      return localStorage.getItem(LAYOUT_KEY) === 'grid' ? 'grid' : 'rows';
    } catch {
      return 'rows';
    }
  });
  const choose = (l: ResultLayout) => {
    setLayout(l);
    try {
      localStorage.setItem(LAYOUT_KEY, l);
    } catch {
      // Not remembered; the choice still holds for this visit.
    }
  };
  return [layout, choose];
}

/** True at the lg breakpoint and up; false where matchMedia is missing. */
function useIsWide(): boolean {
  const query = () => (typeof window.matchMedia === 'function' ? window.matchMedia(LG) : null);
  const [wide, setWide] = useState(() => query()?.matches ?? false);
  useEffect(() => {
    const mq = query();
    if (!mq) return;
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}

export function SearchPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('search.title'));
  const [params, setParams] = useSearchParams();
  const criteria = useMemo(() => criteriaFromParams(params), [params]);
  const { results, status, error, hasMore, loadMore, retry } = useSearch(criteria);

  const currencies = useMemo(() => {
    return [...new Set(results.map((r) => r.currency))];
  }, [results]);

  const navigate = useNavigate();
  const wide = useIsWide();
  const [view, setView] = useState<'list' | 'map'>('list');
  const [layout, setLayout] = useLayout();
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const listHidden = !wide && view !== 'list';
  const mapHidden = !wide && view !== 'map';

  const onChange = (c: Criteria) => setParams(criteriaToParams(c));
  // The first move adds a history entry; later ones replace it, so back skips every pan.
  const onArea = (bbox: Bbox) =>
    setParams(criteriaToParams({ ...criteria, bbox }), { replace: criteria.bbox !== null });
  const clearArea = () => onChange({ ...criteria, bbox: null });
  const loading = status === 'loading';

  // The map fits a new search, but not a new area: it is already showing that area.
  const mapKey = criteriaToParams({ ...criteria, bbox: null }).toString() + (criteria.bbox ? '|area' : '');
  // Keep the old pins while a new search has nothing yet, so moving the map does not blank it.
  const [pins, setPins] = useState({ results, key: mapKey });
  if ((!loading || results.length > 0) && (pins.results !== results || pins.key !== mapKey)) {
    setPins({ results, key: mapKey });
  }
  const loadMoreButton = status === 'idle' && hasMore && (
    <div className={styles.more}>
      <Button variant="secondary" size="lg" icon="chevronDown" onClick={loadMore}>
        {t('search.loadMore')}
      </Button>
    </div>
  );

  const filtered = params.toString() !== '';

  return (
    <main className={styles.page}>
      <div className={styles.main}>
        <div className={styles.top}>
          <h1 className={styles.title}>{t('search.title')}</h1>
          <SearchForm value={criteria} onChange={onChange} currencies={currencies} autoLocate />
        </div>

        <section
          className={styles.results}
          aria-label={t('search.resultsLabel')}
          aria-busy={loading}
        >
          <div className={styles.toolbar}>
            <p className={styles.count}>
              {results.length > 0 &&
                t(hasMore ? 'search.countMore' : 'search.count', { count: results.length })}
            </p>
            <div className={styles.tools}>
              {!listHidden && (
                <div
                  className={[styles.toggle, styles.layoutToggle].join(' ')}
                  role="group"
                  aria-label={t('search.layout.label')}
                >
                  {(['rows', 'grid'] as const).map((l) => (
                    <button
                      key={l}
                      type="button"
                      className={[styles.toggleBtn, styles.iconBtn].join(' ')}
                      aria-pressed={layout === l}
                      aria-label={t(`search.layout.${l}`)}
                      title={t(`search.layout.${l}`)}
                      onClick={() => setLayout(l)}
                    >
                      <svg className={styles.toggleIcon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d={LAYOUT_ICONS[l]} />
                      </svg>
                    </button>
                  ))}
                </div>
              )}
              <div className={styles.toggle} role="group" aria-label={t('search.view.label')}>
                {(['list', 'map'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={styles.toggleBtn}
                    aria-pressed={view === v}
                    onClick={() => setView(v)}
                  >
                    {t(`search.view.${v}`)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className={styles.body}>
            <div className={styles.listPane} hidden={listHidden}>
              {criteria.bbox && (
                <div className={styles.area}>
                  <p className={styles.areaText}>{t('search.areaActive')}</p>
                  <Button size="sm" variant="secondary" icon="close" onClick={clearArea}>
                    {t('search.areaClear')}
                  </Button>
                </div>
              )}

              {status === 'error' && (
                <Alert tone="danger" className={styles.alert}>
                  <span>{errorMessage(error, t)}</span>
                  <Button size="sm" variant="secondary" icon="refresh" onClick={retry}>
                    {t('search.retry')}
                  </Button>
                </Alert>
              )}

              {results.length > 0 && (
                <ul className={[styles.list, layout === 'grid' && styles.grid].filter(Boolean).join(' ')}>
                  {results.map((r) => (
                    <li key={r.slug} className={styles.item}>
                      <ResultCard
                        r={r}
                        layout={layout}
                        active={activeSlug === r.slug}
                        onActive={setActiveSlug}
                      />
                    </li>
                  ))}
                </ul>
              )}

              {loading && <Skeleton kind="list" label={t('common.loading')} />}

              {status === 'idle' && !hasMore && results.length === 0 && (
                <EmptyState
                  title={t('search.emptyTitle')}
                  description={t('search.empty')}
                  action={
                    filtered && (
                      <Button to="/search" variant="secondary" size="lg" icon="close">
                        {t('search.clearFilters')}
                      </Button>
                    )
                  }
                />
              )}

              {loadMoreButton}
            </div>
          </div>
        </section>
      </div>
      <div className={styles.mapPane} hidden={mapHidden}>
        <Suspense
          fallback={
            <div className={styles.loading}>
              <Spinner label={t('common.loading')} />
            </div>
          }
        >
          <ResultsMap
            results={pins.results}
            center={criteria.near}
            bbox={criteria.bbox}
            activeSlug={activeSlug}
            onActive={setActiveSlug}
            fitKey={pins.key}
            onArea={onArea}
            onSelect={(slug) => {
              const r = pins.results.find((x) => x.slug === slug);
              navigate(`/venues/${slug}${r ? `?date=${r.date}` : ''}`);
            }}
          />
        </Suspense>
        {!wide && loadMoreButton}
      </div>
    </main>
  );
}

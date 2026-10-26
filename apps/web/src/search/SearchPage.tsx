import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Spinner } from '../components/ui/Spinner';
import { Skeleton } from '../components/ui/Skeleton';
import { SportCourt } from '../landing/SportCourt';
import { errorMessage } from '../lib/errors';
import { ResultCard } from './ResultCard';
import { SearchForm } from './SearchForm';
import { criteriaFromParams, criteriaToParams, type Criteria } from './searchParams';
import { useSearch } from './useSearch';
import styles from './SearchPage.module.css';

const ResultsMap = lazy(() => import('./ResultsMap').then((m) => ({ default: m.ResultsMap })));

const DEFAULT_RADIUS_KM = 10;
const LG = '(min-width: 1024px)';

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
  const [params, setParams] = useSearchParams();
  const criteria = useMemo(() => criteriaFromParams(params), [params]);
  const { results, status, error, hasMore, loadMore, retry } = useSearch(criteria);

  const currencies = useMemo(() => {
    return [...new Set(results.map((r) => r.currency))];
  }, [results]);

  const navigate = useNavigate();
  const wide = useIsWide();
  const [view, setView] = useState<'list' | 'map'>('list');
  const listHidden = !wide && view !== 'list';
  const mapHidden = !wide && view !== 'map';

  const onChange = (c: Criteria) => setParams(criteriaToParams(c));
  const onSearchArea = (center: { lat: number; lng: number }) =>
    onChange({ ...criteria, near: center, radiusKm: criteria.radiusKm ?? DEFAULT_RADIUS_KM });
  const loading = status === 'loading';
  const loadMoreButton = status === 'idle' && hasMore && (
    <div className={styles.more}>
      <Button variant="secondary" size="lg" onClick={loadMore}>
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
          <SearchForm value={criteria} onChange={onChange} currencies={currencies} />
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

          <div className={styles.body}>
            <div className={styles.listPane} hidden={listHidden}>
              {status === 'error' && (
                <Alert tone="danger" className={styles.alert}>
                  <span>{errorMessage(error, t)}</span>
                  <Button size="sm" variant="secondary" onClick={retry}>
                    {t('search.retry')}
                  </Button>
                </Alert>
              )}

              {results.length > 0 && (
                <ul className={styles.list}>
                  {results.map((r) => (
                    <li key={r.slug} className={styles.item}>
                      <ResultCard r={r} />
                    </li>
                  ))}
                </ul>
              )}

              {loading && <Skeleton kind="list" label={t('common.loading')} />}

              {status === 'idle' && !hasMore && results.length === 0 && (
                <div className={styles.empty}>
                  <span className={styles.emptyArt} aria-hidden="true">
                    <SportCourt sport="tennis" className={styles.emptyCourt} />
                  </span>
                  <h2 className={styles.emptyTitle}>{t('search.emptyTitle')}</h2>
                  <p>{t('search.empty')}</p>
                  {filtered && (
                    <Button to="/search" variant="secondary" size="lg">
                      {t('search.clearFilters')}
                    </Button>
                  )}
                </div>
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
            results={results}
            center={criteria.near}
            fitKey={criteriaToParams(criteria).toString()}
            onSearchArea={onSearchArea}
            onSelect={(slug) => {
              const r = results.find((x) => x.slug === slug);
              navigate(`/venues/${slug}${r ? `?date=${r.date}` : ''}`);
            }}
          />
        </Suspense>
        {!wide && loadMoreButton}
      </div>
    </main>
  );
}

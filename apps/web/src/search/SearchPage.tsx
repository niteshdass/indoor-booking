import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Spinner } from '../components/ui/Spinner';
import { errorMessage } from '../lib/errors';
import { ResultCard } from './ResultCard';
import { SearchForm } from './SearchForm';
import { criteriaFromParams, criteriaToParams, type Criteria } from './searchParams';
import { useSearch } from './useSearch';
import styles from './SearchPage.module.css';

const SKELETONS = [0, 1, 2];

export function SearchPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const criteria = useMemo(() => criteriaFromParams(params), [params]);
  const { results, status, error, hasMore, loadMore, retry } = useSearch(criteria);

  const currencies = useMemo(() => {
    const set = new Set(results.map((r) => r.currency));
    if (criteria.currency) set.add(criteria.currency);
    return [...set];
  }, [results, criteria.currency]);

  const onChange = (c: Criteria) => setParams(criteriaToParams(c));
  const loading = status === 'loading';

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>{t('search.title')}</h1>
      <SearchForm value={criteria} onChange={onChange} currencies={currencies} />

      <section className={styles.results} aria-label={t('search.resultsLabel')} aria-busy={loading}>
        <div className={styles.toolbar}>
          {results.length > 0 && <p className={styles.count}>{t('search.count', { count: results.length })}</p>}
          {/* Map toggle goes here (Task 9). */}
        </div>

        {status === 'error' && (
          <Alert tone="danger" className={styles.alert}>
            <span>{errorMessage(error, t)}</span>
            <Button size="sm" variant="secondary" onClick={retry}>
              {t('search.retry')}
            </Button>
          </Alert>
        )}

        {results.length > 0 && (
          <ul className={styles.grid}>
            {results.map((r) => (
              <li key={r.slug} className={styles.item}>
                <ResultCard r={r} />
              </li>
            ))}
          </ul>
        )}

        {loading && (
          <>
            <div className={styles.loading}>
              <Spinner label={t('common.loading')} />
            </div>
            {results.length === 0 && (
              <ul className={styles.grid} aria-hidden="true">
                {SKELETONS.map((i) => (
                  <li key={i} className={styles.skeleton} />
                ))}
              </ul>
            )}
          </>
        )}

        {status === 'idle' && !hasMore && results.length === 0 && <p className={styles.empty}>{t('search.empty')}</p>}

        {status === 'idle' && hasMore && (
          <div className={styles.more}>
            <Button variant="secondary" size="lg" onClick={loadMore}>
              {t('search.loadMore')}
            </Button>
          </div>
        )}
      </section>
    </main>
  );
}

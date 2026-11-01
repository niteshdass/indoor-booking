import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { localParts } from '@booking/shared';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { SportCourt } from '../landing/SportCourt';
import { apiGet, ApiError } from '../lib/apiClient';
import { errorMessage } from '../lib/errors';
import { formatRating } from '../lib/format';
import type { PublicVenue } from '../lib/types';
import { NotFoundPage } from '../pages/NotFoundPage';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { DateStrip } from './DateStrip';
import { ReviewsSection } from './ReviewsSection';
import { SlotsPanel } from './SlotsPanel';
import { VenueAbout } from './VenueAbout';
import { VenueGallery } from './VenueGallery';
import styles from './VenuePage.module.css';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const ICONS = {
  pin: 'M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  share: 'M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6',
  check: 'M5 12.5l4.5 4.5L19 7.5',
};

function Icon({ d }: { d: string }) {
  return (
    <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  );
}

function validDate(s: string | null): s is string {
  if (!s || !ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
}

type State =
  | { status: 'loading' }
  | { status: 'ready'; venue: PublicVenue }
  | { status: 'not_found' }
  | { status: 'error'; error: unknown };

/** Native share sheet where there is one, otherwise copies the link and says so for a moment. */
function ShareButton({ title }: { title: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const onShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
      } catch {
        // Dismissed by the user.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard access: nothing to do.
    }
  };
  return (
    <Button variant="secondary" onClick={() => void onShare()} className={styles.share}>
      <Icon d={copied ? ICONS.check : ICONS.share} />
      <span role="status">{copied ? t('venue.linkCopied') : t('venue.share')}</span>
    </Button>
  );
}

export function VenuePage() {
  const { slug = '' } = useParams();
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  // Shown once: remembered locally, then dropped from history state so a refresh does not bring it back.
  const [slotTaken] = useState(() => (location.state as { notice?: string } | null)?.notice === 'slot_taken');
  useEffect(() => {
    if (slotTaken) navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: null });
    // Only on mount.
  }, []);
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  /** Slots picked per day on each court, for the court tabs and the date strip. */
  const [picked, setPicked] = useState<Record<string, Record<string, number>>>({});

  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    apiGet<{ venue: PublicVenue }>(`/venues/${encodeURIComponent(slug)}`).then(
      (r) => live && setState({ status: 'ready', venue: r.venue }),
      (error: unknown) => {
        if (!live) return;
        setState(error instanceof ApiError && error.status === 404 ? { status: 'not_found' } : { status: 'error', error });
      },
    );
    return () => {
      live = false;
    };
  }, [slug, attempt]);

  const update = useCallback(
    (patch: Record<string, string>) => {
      const next = new URLSearchParams(params);
      for (const [k, v] of Object.entries(patch)) next.set(k, v);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );
  // `slot` is a one-shot pick from a search card; dropped once handled so a reload does not pick it again.
  const preselect = params.get('slot');
  const onPreselected = useCallback(() => {
    const next = new URLSearchParams(params);
    next.delete('slot');
    setParams(next, { replace: true });
  }, [params, setParams]);
  useDocumentTitle(state.status === 'ready' ? state.venue.name : null);

  if (state.status === 'not_found') return <NotFoundPage />;
  if (state.status === 'loading') {
    return (
      <main className={styles.page}>
        <Skeleton kind="detail" label={t('common.loading')} />
      </main>
    );
  }
  if (state.status === 'error') {
    return (
      <main className={styles.page}>
        <Alert tone="danger" className={styles.alert}>
          <span>{errorMessage(state.error, t)}</span>
          <Button size="sm" variant="secondary" icon="refresh" onClick={() => setAttempt((n) => n + 1)}>
            {t('search.retry')}
          </Button>
        </Alert>
      </main>
    );
  }

  const { venue } = state;
  const today = localParts(new Date(), venue.timezone).date;
  const dateParam = params.get('date');
  const date = validDate(dateParam) ? dateParam : today;
  const turf = venue.turfs.find((x) => x.id === params.get('turf')) ?? venue.turfs[0];
  const sports = [...new Set(venue.turfs.flatMap((x) => x.sports))];

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = venue.turfs.findIndex((x) => x.id === turf?.id);
    const n = venue.turfs.length;
    let to = -1;
    if (e.key === 'ArrowRight') to = (i + 1) % n;
    else if (e.key === 'ArrowLeft') to = (i - 1 + n) % n;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = n - 1;
    if (to < 0) return;
    e.preventDefault();
    const target = venue.turfs[to]!;
    update({ turf: target.id });
    document.getElementById(`turf-tab-${target.id}`)?.focus();
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{venue.name}</h1>
          <ShareButton title={venue.name} />
        </div>
        <div className={styles.meta}>
          {venue.rating && (
            <a className={styles.rating} href="#reviews">
              <span className={styles.star} aria-hidden="true">
                ★
              </span>
              <span className={styles.ratingValue}>{formatRating(venue.rating.average, lang)}</span>
              <span className={styles.ratingCount}>{t('reviews.summaryCount', { count: venue.rating.count })}</span>
            </a>
          )}
          <span className={styles.place}>
            <Icon d={ICONS.pin} />
            <span>
              {venue.address}, {venue.city}
            </span>
          </span>
        </div>
        {sports.length > 0 && (
          <ul className={styles.sports} aria-label={t('venue.sports')}>
            {sports.map((s) => (
              <li key={s} className={styles.sport}>
                {t(`sports.${s}`)}
              </li>
            ))}
          </ul>
        )}
      </header>

      <VenueGallery photos={venue.photos} name={venue.name} sport={sports[0] ?? 'futsal'} />

      <section className={styles.book} aria-labelledby="venue-book-heading">
        <div className={styles.bookHead}>
          <h2 id="venue-book-heading" className={styles.heading}>
            {t('venue.book')}
          </h2>
          {venue.turfs.length > 0 && (
            <span className={styles.headNote}>{t('venue.courtCount', { count: venue.turfs.length })}</span>
          )}
        </div>
        {turf ? (
          <>
            <div className={styles.tabs} role="tablist" aria-label={t('venue.turfs')} onKeyDown={onTabKey}>
              {venue.turfs.map((x) => {
                const active = x.id === turf.id;
                const count = Object.values(picked[x.id] ?? {}).reduce((n, c) => n + c, 0);
                return (
                  <button
                    key={x.id}
                    id={`turf-tab-${x.id}`}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    aria-controls="turf-panel"
                    tabIndex={active ? 0 : -1}
                    className={[styles.tab, active ? styles.tabActive : ''].filter(Boolean).join(' ')}
                    onClick={() => update({ turf: x.id })}
                  >
                    <SportCourt sport={x.sports[0] ?? 'futsal'} className={styles.tabCourt} />
                    <span className={styles.tabText}>
                      <span className={styles.tabName}>{x.name}</span>
                      <span className={styles.tabKind}>
                        {[
                          t(x.indoor ? 'venue.indoor' : 'venue.outdoor'),
                          ...x.sports.map((s) => t(`sports.${s}`)),
                          t('venue.slotLength', { count: x.slotLengthMin }),
                        ].join(' · ')}
                      </span>
                    </span>
                    {count > 0 && (
                      <span className={styles.tabBadge}>
                        <span aria-hidden="true">{count}</span>
                        <span className={styles.hidden}>{t('slots.picked', { count })}</span>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <DateStrip today={today} value={date} onChange={(d) => update({ date: d })} marked={picked[turf.id] ?? {}} timeZone={venue.timezone} />

            {slotTaken && (
              <Alert tone="warning" className={styles.alert}>
                {t('errors.slot_taken')}
              </Alert>
            )}

            <SlotsPanel
              slug={slug}
              turfs={venue.turfs}
              turfId={turf.id}
              date={date}
              tabId={`turf-tab-${turf.id}`}
              onOpen={(id, d) => update({ turf: id, date: d })}
              onPicked={setPicked}
              preselect={preselect}
              onPreselected={onPreselected}
            />
          </>
        ) : (
          <EmptyState size="sm" title={t('venue.noTurfs')} />
        )}
      </section>

      <hr className={styles.rule} />
      <VenueAbout venue={venue} />
      <hr className={styles.rule} />
      <ReviewsSection slug={slug} timeZone={venue.timezone} rating={venue.rating} />
    </main>
  );
}

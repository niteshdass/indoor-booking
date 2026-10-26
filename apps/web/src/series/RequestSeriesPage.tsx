import { useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { addDays, localParts } from '@booking/shared';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { Skeleton } from '../components/ui/Skeleton';
import { ApiError, apiPost } from '../lib/apiClient';
import { errorMessage } from '../lib/errors';
import { formatDateTime } from '../lib/format';
import type { PublicVenue, SlotDay } from '../lib/types';
import { useResource } from '../owner/useResource';
import { NotFoundPage } from '../pages/NotFoundPage';
import { defaultPattern, ISO_DATE, isPatternOk, patternBody, useStartTimeSync } from './pattern';
import { SeriesForm } from './SeriesForm';
import { SeriesPreviewList } from './SeriesPreviewList';
import type { SeriesJson, SeriesPattern, SeriesPreview } from './types';
import styles from './RequestSeriesPage.module.css';

/** Player: ask a venue for a weekly booking after checking which dates are free. */
export function RequestSeriesPage() {
  const { slug = '' } = useParams();
  const { t } = useTranslation();
  const venue = useResource<{ venue: PublicVenue }>(`/venues/${encodeURIComponent(slug)}`);

  let body;
  if (venue.state.status === 'error') {
    if (venue.state.error instanceof ApiError && venue.state.error.status === 404) return <NotFoundPage />;
    body = (
      <Alert tone="danger" className={styles.alert}>
        <span>{errorMessage(venue.state.error, t)}</span>
        <Button size="sm" variant="secondary" onClick={venue.reload}>
          {t('search.retry')}
        </Button>
      </Alert>
    );
  } else if (venue.state.status !== 'ready') {
    body = (
      <Skeleton kind="detail" label={t('common.loading')} />
    );
  } else {
    body = <Request venue={venue.state.data.venue} />;
  }

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>{t('series.player.requestTitle')}</h1>
      {body}
    </main>
  );
}

function Request({ venue }: { venue: PublicVenue }) {
  const { t, i18n } = useTranslation();
  const [params] = useSearchParams();
  const lang = i18n.language;
  const today = localParts(new Date(), venue.timezone).date;
  const tomorrow = addDays(today, 1);
  const wantedDate = params.get('date') ?? '';
  const [turfId, setTurfId] = useState(() => venue.turfs.find((x) => x.id === params.get('turfId'))?.id ?? venue.turfs[0]?.id ?? '');
  const [pattern, setPattern] = useState<SeriesPattern>(() =>
    defaultPattern(ISO_DATE.test(wantedDate) && wantedDate >= tomorrow ? wantedDate : tomorrow),
  );
  const [preview, setPreview] = useState<SeriesPreview | null>(null);
  const [checking, setChecking] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [sent, setSent] = useState<SeriesJson | null>(null);
  const busy = useRef(false);

  const turf = venue.turfs.find((x) => x.id === turfId);
  const base = `/venues/${encodeURIComponent(venue.slug)}/turfs/${encodeURIComponent(turfId)}`;
  const slots = useResource<{ day: SlotDay }>(turf ? `${base}/slots?date=${ISO_DATE.test(pattern.firstDate) ? pattern.firstDate : tomorrow}` : null);
  const slotTimes = slots.state.status === 'ready' ? slots.state.data.day.slots.map((s) => s.localStart) : [];
  useStartTimeSync(slotTimes, slots.state.status === 'ready', setPattern);

  if (!turf) return <p className={styles.muted}>{t('venue.noTurfs')}</p>;

  if (sent) {
    return (
      <div className={styles.sent}>
        <Alert tone="success">
          {sent.respondBy
            ? t('series.player.sent', { when: formatDateTime(sent.respondBy, venue.timezone, lang) })
            : t('series.player.sentNoDate')}
        </Alert>
        <Button to="/me/bookings" variant="brand" size="lg">
          {t('series.player.toBookings')}
        </Button>
      </div>
    );
  }

  const edit = (next: SeriesPattern) => {
    setPattern(next);
    setPreview(null);
    setError(null);
  };
  const patternOk = isPatternOk(pattern);

  const run = async <T,>(set: (v: boolean) => void, call: () => Promise<T>, done: (v: T) => void) => {
    if (busy.current) return;
    busy.current = true;
    set(true);
    setError(null);
    try {
      done(await call());
    } catch (e) {
      setError(e);
    } finally {
      busy.current = false;
      set(false);
    }
  };
  const checkDates = () => {
    if (!patternOk) return;
    setPreview(null);
    void run(setChecking, () => apiPost<{ preview: SeriesPreview }>(`${base}/series/preview`, patternBody(pattern)), (r) => setPreview(r.preview));
  };
  const send = () => {
    if (!preview || preview.freeCount === 0) return;
    void run(setSending, () => apiPost<{ series: SeriesJson }>(`${base}/series`, patternBody(pattern)), (r) => setSent(r.series));
  };

  return (
    <form
      className={styles.form}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (preview) send();
        else checkDates();
      }}
    >
      <p className={styles.muted}>{t('series.player.intro')}</p>
      <section className={styles.card} aria-label={venue.name}>
        <h2 className={styles.venue}>{venue.name}</h2>
        <Select
          layout="stacked"
          label={t('series.player.turf')}
          value={turfId}
          options={venue.turfs.map((x) => ({ value: x.id, label: x.name }))}
          onChange={(e) => {
            setTurfId(e.target.value);
            setPreview(null);
            setError(null);
          }}
        />
        <SeriesForm value={pattern} onChange={edit} tone="brand" slotTimes={slotTimes} slotMinutes={turf.slotLengthMin} />
        <Button type="button" variant="secondary" size="lg" loading={checking} disabled={!patternOk} onClick={checkDates}>
          {t('series.check')}
        </Button>
      </section>

      {preview && (
        <section className={styles.card} aria-live="polite">
          <SeriesPreviewList preview={preview} timeZone={venue.timezone} />
          <Button type="button" variant="brand" size="lg" block loading={sending} disabled={preview.freeCount === 0} onClick={send}>
            {t('series.player.send')}
          </Button>
        </section>
      )}

      {error !== null && <Alert tone="danger">{errorMessage(error, t)}</Alert>}
    </form>
  );
}

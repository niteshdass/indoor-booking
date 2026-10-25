import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { addDays, localParts, weekdayOf, type SeriesJson, type SeriesPattern, type SeriesPreview } from '@booking/shared';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { PhoneInput } from '../../components/ui/PhoneInput';
import { Select } from '../../components/ui/Select';
import { Spinner } from '../../components/ui/Spinner';
import { TextField } from '../../components/ui/TextField';
import { apiPost } from '../../lib/apiClient';
import { errorMessage } from '../../lib/errors';
import { SeriesForm } from '../../series/SeriesForm';
import { SeriesPreviewList } from '../../series/SeriesPreviewList';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import { useOwnerTitle } from '../shell/OwnerShell';
import { useVenueParam } from '../shell/useVenueParam';
import { VenueSelect } from '../shell/VenueSelect';
import type { OwnerSlotDay, OwnerTurf, OwnerVenue } from '../types';
import { useResource } from '../useResource';
import styles from '../walkin/WalkInPage.module.css';

/** Owner: book a weekly series for a customer after checking which dates are free. */
export function NewSeriesPage() {
  const { t } = useTranslation();
  const [venue] = useVenueParam();
  useOwnerTitle(t('series.newTitle'));
  if (!venue) return <p className={styles.empty}>{t('owner.today.noVenues')}</p>;
  return (
    <div className={styles.page}>
      <VenueSelect />
      <SeriesVenue key={venue.id} venue={venue} />
    </div>
  );
}

function SeriesVenue({ venue }: { venue: OwnerVenue }) {
  const { t } = useTranslation();
  const { ownerId } = useOwner();
  const turfs = useResource<{ turfs: OwnerTurf[] }>(ownerPath(ownerId, `/venues/${encodeURIComponent(venue.id)}/turfs`));
  if (turfs.state.status === 'error') {
    return (
      <Alert tone="danger">
        <p className={styles.empty}>{errorMessage(turfs.state.error, t)}</p>
        <Button variant="secondary" onClick={turfs.reload}>
          {t('auth.retry')}
        </Button>
      </Alert>
    );
  }
  if (turfs.state.status !== 'ready') return <Spinner label={t('common.loading')} />;
  const active = turfs.state.data.turfs.filter((x) => x.active);
  if (active.length === 0) return <p className={styles.empty}>{t('owner.walkIn.noTurfs')}</p>;
  return <SeriesBuilder venue={venue} turfs={active} />;
}

function SeriesBuilder({ venue, turfs }: { venue: OwnerVenue; turfs: OwnerTurf[] }) {
  const { t } = useTranslation();
  const { ownerId } = useOwner();
  const navigate = useNavigate();
  const today = localParts(new Date(), venue.timezone).date;
  const [turfId, setTurfId] = useState(turfs[0]!.id);
  const [pattern, setPattern] = useState<SeriesPattern>(() => ({
    weekdays: [weekdayOf(addDays(today, 1))],
    startTime: '',
    slotCount: 1,
    firstDate: addDays(today, 1),
    endDate: null,
    count: 10,
  }));
  const [preview, setPreview] = useState<SeriesPreview | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [tried, setTried] = useState(false);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const busy = useRef(false);

  const base = ownerPath(ownerId, `/venues/${encodeURIComponent(venue.id)}/turfs/${encodeURIComponent(turfId)}`);
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(pattern.firstDate);
  const slots = useResource<{ day: OwnerSlotDay }>(`${base}/slots?date=${validDate ? pattern.firstDate : today}`);
  const slotTimes = slots.state.status === 'ready' ? slots.state.data.day.slots.map((s) => s.localStart) : [];
  const timesKey = slotTimes.join(',');

  // Keep the start time on one the first date offers.
  useEffect(() => {
    if (slots.state.status !== 'ready') return;
    setPattern((p) => (slotTimes.includes(p.startTime) || slotTimes.length === 0 ? p : { ...p, startTime: slotTimes[0]! }));
  }, [timesKey, slots.state.status]);

  const edit = (next: SeriesPattern) => {
    setPattern(next);
    setPreview(null);
    setError(null);
  };

  const endOk = pattern.count !== null ? pattern.count >= 1 : pattern.endDate !== null && pattern.endDate >= pattern.firstDate;
  const patternOk = pattern.weekdays.length > 0 && pattern.startTime !== '' && validDate && endOk;

  const body = {
    weekdays: pattern.weekdays,
    startTime: pattern.startTime,
    slotCount: pattern.slotCount,
    firstDate: pattern.firstDate,
    endDate: pattern.endDate,
    count: pattern.count,
  };

  const checkDates = async () => {
    if (!patternOk) return;
    setChecking(true);
    setError(null);
    setPreview(null);
    try {
      const res = await apiPost<{ preview: SeriesPreview }>(`${base}/series/preview`, body);
      setPreview(res.preview);
    } catch (e) {
      setError(e);
    } finally {
      setChecking(false);
    }
  };

  const nameOk = name.trim().length >= 1 && name.trim().length <= 80;
  const phoneOk = phone !== '';

  const book = async () => {
    if (busy.current || !preview || preview.freeCount === 0) return;
    setTried(true);
    if (!nameOk || !phoneOk) return;
    busy.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiPost<{ series: SeriesJson }>(`${base}/series`, { ...body, customer: { name: name.trim(), phone } });
      navigate(`/owner/${encodeURIComponent(ownerId)}/series/${encodeURIComponent(res.series.id)}`);
    } catch (e) {
      setError(e);
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  };

  return (
    <form
      className={styles.form}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void (preview ? book() : checkDates());
      }}
    >
      <section className={styles.card}>
        <Select
          layout="stacked"
          label={t('owner.walkIn.turf')}
          value={turfId}
          options={turfs.map((x) => ({ value: x.id, label: x.name }))}
          onChange={(e) => {
            setTurfId(e.target.value);
            setPreview(null);
            setError(null);
          }}
        />
        <SeriesForm value={pattern} onChange={edit} tone="portal" slotTimes={slotTimes} />
        <Button type="button" variant="secondary" loading={checking} disabled={!patternOk} onClick={() => void checkDates()}>
          {t('series.check')}
        </Button>
      </section>

      {preview && (
        <section className={styles.card} aria-live="polite">
          <SeriesPreviewList preview={preview} timeZone={venue.timezone} />
        </section>
      )}

      {preview && (
        <section className={styles.card}>
          <h2 className={styles.heading}>{t('owner.walkIn.customer')}</h2>
          <TextField
            label={t('owner.walkIn.name')}
            value={name}
            maxLength={80}
            autoComplete="off"
            error={tried && !nameOk ? t('owner.walkIn.nameRequired') : undefined}
            onChange={(e) => setName(e.target.value)}
          />
          <PhoneInput
            label={t('owner.walkIn.phoneLabel')}
            value={phone}
            onChange={setPhone}
            error={tried && !phoneOk ? t('owner.walkIn.phoneRequired') : undefined}
          />
          <Button type="button" size="lg" loading={submitting} disabled={preview.freeCount === 0} onClick={() => void book()}>
            {t('series.book', { count: preview.freeCount })}
          </Button>
        </section>
      )}

      {error !== null && <Alert tone="danger">{errorMessage(error, t)}</Alert>}
    </form>
  );
}

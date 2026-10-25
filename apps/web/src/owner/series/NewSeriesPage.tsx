import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { addDays, localParts, weekdayOf, type SeriesJson, type SeriesPattern, type SeriesPreview } from '@booking/shared';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { apiPost } from '../../lib/apiClient';
import { errorMessage } from '../../lib/errors';
import { SeriesForm } from '../../series/SeriesForm';
import { SeriesPreviewList } from '../../series/SeriesPreviewList';
import { CustomerFields, customerErrors, type Customer } from '../CustomerFields';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import { useOwnerTitle } from '../shell/OwnerShell';
import { useVenueParam } from '../shell/useVenueParam';
import { VenueSelect } from '../shell/VenueSelect';
import type { OwnerSlotDay, OwnerTurf, OwnerVenue } from '../types';
import { ActiveTurfs } from '../turfs/ActiveTurfs';
import { useResource } from '../useResource';
import styles from '../ownerForm.module.css';

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
  return <ActiveTurfs venue={venue}>{(turfs) => <SeriesBuilder venue={venue} turfs={turfs} />}</ActiveTurfs>;
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
  const [customer, setCustomer] = useState<Customer>({ name: '', phone: '' });
  const [tried, setTried] = useState(false);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const busy = useRef(false);

  const turf = turfs.find((x) => x.id === turfId) ?? turfs[0]!;
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

  const book = async () => {
    if (busy.current || !preview || preview.freeCount === 0) return;
    setTried(true);
    const bad = customerErrors(customer);
    if (bad.name || bad.phone) return;
    busy.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiPost<{ series: SeriesJson }>(`${base}/series`, { ...body, customer: { name: customer.name.trim(), phone: customer.phone } });
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
        <SeriesForm value={pattern} onChange={edit} tone="portal" slotTimes={slotTimes} slotMinutes={turf.slotLengthMin} />
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
          <CustomerFields value={customer} onChange={setCustomer} tried={tried} />
          <Button type="button" size="lg" loading={submitting} disabled={preview.freeCount === 0} onClick={() => void book()}>
            {t('series.book', { count: preview.freeCount })}
          </Button>
        </section>
      )}

      {error !== null && <Alert tone="danger">{errorMessage(error, t)}</Alert>}
    </form>
  );
}

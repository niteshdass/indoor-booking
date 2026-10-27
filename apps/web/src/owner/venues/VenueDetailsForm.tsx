import { useCallback, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { AMENITIES } from '@booking/shared';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox';
import { Select } from '../../components/ui/Select';
import { TextField } from '../../components/ui/TextField';
import { apiPatch, apiPost } from '../../lib/apiClient';
import { errorMessage } from '../../lib/errors';
import { countryOptions, currencyOptions, localTimeZone, timeZoneOptions } from '../../lib/regions';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import type { OwnerVenue } from '../types';
import { LocationPicker } from './LocationPicker';
import { PhotoUploader } from './PhotoUploader';
import { draftFromVenue, parseCoord, validateVenue, venueBody, type VenueDraft } from './venueForm';
import styles from './venues.module.css';

/** Create (`venue` null) or edit form for the venue's own fields; read-only when `readOnly`. */
export function VenueForm({ venue, readOnly }: { venue: OwnerVenue | null; readOnly: boolean }) {
  const { t, i18n } = useTranslation();
  const { ownerId, owner, reloadVenues } = useOwner();
  const navigate = useNavigate();
  const isNew = venue === null;
  const [saved, setSaved] = useState(venue);
  const [draft, setDraft] = useState<VenueDraft>(() =>
    venue
      ? draftFromVenue(venue)
      : {
          name: '',
          slug: '',
          address: '',
          city: '',
          country: owner.country,
          timezone: localTimeZone(),
          currency: owner.defaultCurrency,
          lat: '',
          lng: '',
          amenities: [],
          photos: [],
        },
  );
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  const [uploading, setUploading] = useState(false);

  const lang = i18n.language;
  const countries = useMemo(() => countryOptions(lang, draft.country), [lang, draft.country]);
  const currencies = useMemo(() => currencyOptions(lang, draft.currency), [lang, draft.currency]);
  const zones = useMemo(() => timeZoneOptions(draft.timezone), [draft.timezone]);
  // An empty first row until a value is chosen, so the select never silently shows the first entry.
  const pick = (options: { value: string; label: string }[], value: string, placeholder: string) =>
    value ? options : [{ value: '', label: placeholder }, ...options];

  const errors = validateVenue(draft, isNew);
  const msg = (k: keyof VenueDraft) => (submitted && errors[k] ? t(errors[k]!) : undefined);
  const set = <K extends keyof VenueDraft>(k: K, v: VenueDraft[K]) => {
    setDone(false);
    setDraft((d) => ({ ...d, [k]: v }));
  };
  const text = (k: 'name' | 'slug' | 'address' | 'city') => ({
    value: draft[k],
    disabled: readOnly,
    error: msg(k),
    onChange: (e: { target: { value: string } }) => set(k, e.target.value),
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setError(null);
    if (busy || uploading || Object.keys(errors).length > 0) return;
    const body = venueBody(draft, saved);
    if (saved && Object.keys(body).length === 0) {
      setDone(true);
      return;
    }
    setBusy(true);
    try {
      if (!saved) {
        const { venue: created } = await apiPost<{ venue: OwnerVenue }>(ownerPath(ownerId, '/venues'), body);
        reloadVenues();
        navigate(`/owner/${ownerId}/venues/${encodeURIComponent(created.id)}`);
        return;
      }
      const { venue: next } = await apiPatch<{ venue: OwnerVenue }>(ownerPath(ownerId, `/venues/${encodeURIComponent(saved.id)}`), body);
      setSaved(next);
      setDraft(draftFromVenue(next));
      setDone(true);
      reloadVenues();
    } catch (err) {
      setError(err);
    }
    setBusy(false);
  };

  const lat = parseCoord(draft.lat, 90);
  const lng = parseCoord(draft.lng, 180);
  const setPhotos = (fn: (photos: VenueDraft['photos']) => VenueDraft['photos']) => {
    setDone(false);
    setDraft((d) => ({ ...d, photos: fn(d.photos) }));
  };
  const onUploading = useCallback((on: boolean) => setUploading(on), []);

  return (
    <form className={styles.formLayout} onSubmit={submit} noValidate>
      <div className={styles.formMain}>
      {error !== null && <Alert tone="danger">{errorMessage(error, t)}</Alert>}
      {done && <Alert tone="success">{t('owner.venues.saved')}</Alert>}
      <section className={styles.formCard}>
        <div className={styles.grid}>
          <TextField className={styles.wide} label={t('owner.venues.name')} maxLength={100} {...text('name')} />
          <TextField label={t('owner.venues.slug')} hint={t('owner.venues.slugHint')} maxLength={60} {...text('slug')} />
          <TextField className={styles.wide} label={t('owner.venues.address')} maxLength={300} {...text('address')} />
          <TextField label={t('owner.venues.city')} maxLength={100} {...text('city')} />
          <Select
            layout="stacked"
            size="lg"
            label={t('owner.venues.country')}
            options={pick(countries, draft.country, t('owner.venues.chooseCountry'))}
            value={draft.country}
            disabled={readOnly}
            error={msg('country')}
            onChange={(e) => set('country', e.target.value)}
          />
          <Select
            layout="stacked"
            size="lg"
            label={t('owner.venues.timezone')}
            options={pick(zones, draft.timezone, t('owner.venues.chooseTimezone'))}
            value={draft.timezone}
            disabled={readOnly}
            error={msg('timezone')}
            onChange={(e) => set('timezone', e.target.value)}
          />
          <Select
            layout="stacked"
            size="lg"
            label={t('owner.venues.currency')}
            hint={isNew ? t('owner.venues.currencyHint') : t('owner.venues.currencyLocked')}
            options={pick(currencies, draft.currency, t('owner.venues.chooseCurrency'))}
            value={draft.currency}
            disabled={readOnly || !isNew}
            error={msg('currency')}
            onChange={(e) => set('currency', e.target.value)}
          />
        </div>
      </section>

      <section className={styles.formCard}>
        <div className={styles.headRow}>
          <h2 className={styles.heading}>{t('owner.venues.location')}</h2>
          <p className={styles.hint}>{t('owner.venues.locationHint')}</p>
        </div>
        <div className={styles.location}>
          {!readOnly && (
            <LocationPicker
              lat={lat}
              lng={lng}
              onChange={(a, b) => {
                setDone(false);
                setDraft((d) => ({ ...d, lat: String(a), lng: String(b) }));
              }}
            />
          )}
          <div className={styles.coords}>
            <TextField
              label={t('owner.venues.latitude')}
              inputMode="decimal"
              value={draft.lat}
              disabled={readOnly}
              error={msg('lat')}
              onChange={(e) => set('lat', e.target.value)}
            />
            <TextField
              label={t('owner.venues.longitude')}
              inputMode="decimal"
              value={draft.lng}
              disabled={readOnly}
              error={msg('lng')}
              onChange={(e) => set('lng', e.target.value)}
            />
          </div>
        </div>
      </section>

      <section className={styles.formCard}>
        <fieldset className={styles.fieldset}>
          <legend className={styles.heading}>{t('venue.amenities')}</legend>
          <div className={styles.checks}>
            {AMENITIES.map((a) => (
              <Checkbox
                key={a}
                label={t(`amenities.${a}`)}
                checked={draft.amenities.includes(a)}
                disabled={readOnly}
                onChange={(on) => set('amenities', on ? [...draft.amenities, a] : draft.amenities.filter((x) => x !== a))}
              />
            ))}
          </div>
        </fieldset>
      </section>

      </div>

      <aside className={styles.formSide}>
        <section className={styles.formCard}>
          <h2 className={styles.heading}>{t('owner.venues.photos')}</h2>
          <PhotoUploader
            photos={draft.photos}
            readOnly={readOnly}
            error={msg('photos')}
            onAdd={(photo) => setPhotos((all) => [...all, photo])}
            onRemove={(i) => setPhotos((all) => all.filter((_, j) => j !== i))}
            onAlt={(i, alt) => setPhotos((all) => all.map((p, j) => (j === i ? { ...p, alt } : p)))}
            onBusy={onUploading}
          />
          {!readOnly && (
            <Button type="submit" block loading={busy} disabled={uploading}>
              {t(isNew ? 'owner.venues.create' : 'owner.venues.save')}
            </Button>
          )}
          {!readOnly && uploading && <p className={styles.hint}>{t('owner.venues.waitUploads')}</p>}
        </section>
      </aside>
    </form>
  );
}

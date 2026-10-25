import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { AMENITIES } from '@booking/shared';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox';
import { TextField } from '../../components/ui/TextField';
import { apiPatch, apiPost } from '../../lib/apiClient';
import { errorMessage } from '../../lib/errors';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import type { OwnerVenue } from '../types';
import { LocationPicker } from './LocationPicker';
import { draftFromVenue, MAX_PHOTOS, parseCoord, validateVenue, venueBody, type VenueDraft } from './venueForm';
import styles from './venues.module.css';

/** Create (`venue` null) or edit form for the venue's own fields; read-only when `readOnly`. */
export function VenueForm({ venue, readOnly }: { venue: OwnerVenue | null; readOnly: boolean }) {
  const { t } = useTranslation();
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
          timezone: '',
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

  const errors = validateVenue(draft, isNew);
  const msg = (k: keyof VenueDraft) => (submitted && errors[k] ? t(errors[k]!) : undefined);
  const set = <K extends keyof VenueDraft>(k: K, v: VenueDraft[K]) => {
    setDone(false);
    setDraft((d) => ({ ...d, [k]: v }));
  };
  const text = (k: 'name' | 'slug' | 'address' | 'city' | 'timezone') => ({
    value: draft[k],
    disabled: readOnly,
    error: msg(k),
    onChange: (e: { target: { value: string } }) => set(k, e.target.value),
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setError(null);
    if (busy || Object.keys(errors).length > 0) return;
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
  const setPhoto = (i: number, patch: Partial<VenueDraft['photos'][number]>) =>
    set('photos', draft.photos.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  return (
    <form className={styles.stack} onSubmit={submit} noValidate>
      {error !== null && <Alert tone="danger">{errorMessage(error, t)}</Alert>}
      {done && <Alert tone="success">{t('owner.venues.saved')}</Alert>}
      <section className={styles.card}>
        <div className={styles.grid}>
          <TextField label={t('owner.venues.name')} maxLength={100} {...text('name')} />
          <TextField label={t('owner.venues.slug')} hint={t('owner.venues.slugHint')} maxLength={60} {...text('slug')} />
          <TextField label={t('owner.venues.address')} maxLength={300} {...text('address')} />
          <TextField label={t('owner.venues.city')} maxLength={100} {...text('city')} />
          <TextField
            label={t('owner.venues.country')}
            hint={t('owner.venues.countryHint')}
            maxLength={2}
            value={draft.country}
            disabled={readOnly}
            error={msg('country')}
            onChange={(e) => set('country', e.target.value.toUpperCase())}
          />
          <TextField label={t('owner.venues.timezone')} hint={t('owner.venues.timezoneHint')} {...text('timezone')} />
          <TextField
            label={t('owner.venues.currency')}
            hint={isNew ? t('owner.venues.currencyHint') : t('owner.venues.currencyLocked')}
            maxLength={3}
            value={draft.currency}
            disabled={readOnly || !isNew}
            error={msg('currency')}
            onChange={(e) => set('currency', e.target.value.toUpperCase())}
          />
        </div>
      </section>

      <section className={styles.card}>
        <h2 className={styles.heading}>{t('owner.venues.location')}</h2>
        <p className={styles.muted}>{t('owner.venues.locationHint')}</p>
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

      <section className={styles.card}>
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

      <section className={styles.card}>
        <h2 className={styles.heading}>{t('owner.venues.photos')}</h2>
        {draft.photos.map((p, i) => (
          <div key={i} className={styles.photoRow}>
            <TextField
              label={t('owner.venues.photoUrl', { n: i + 1 })}
              type="url"
              value={p.url}
              disabled={readOnly}
              onChange={(e) => setPhoto(i, { url: e.target.value })}
            />
            <TextField
              label={t('owner.venues.photoAlt', { n: i + 1 })}
              maxLength={200}
              value={p.alt}
              disabled={readOnly}
              onChange={(e) => setPhoto(i, { alt: e.target.value })}
            />
            {!readOnly && (
              <Button variant="ghost" onClick={() => set('photos', draft.photos.filter((_, j) => j !== i))}>
                {t('owner.venues.removePhoto', { n: i + 1 })}
              </Button>
            )}
          </div>
        ))}
        {msg('photos') && <p className={styles.error}>{msg('photos')}</p>}
        {!readOnly && draft.photos.length < MAX_PHOTOS && (
          <div>
            <Button variant="secondary" onClick={() => set('photos', [...draft.photos, { url: '', alt: '' }])}>
              {t('owner.venues.addPhoto')}
            </Button>
          </div>
        )}
      </section>

      {!readOnly && (
        <div>
          <Button type="submit" loading={busy}>
            {t(isNew ? 'owner.venues.create' : 'owner.venues.save')}
          </Button>
        </div>
      )}
    </form>
  );
}

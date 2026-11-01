import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  InvalidMoneyError,
  MAX_SEARCH_RADIUS_KM,
  SEARCH_RADII_KM,
  SPORTS,
  currencyExponent,
  parseMoney,
} from '@booking/shared';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { Spinner } from '../components/ui/Spinner';
import { TextField } from '../components/ui/TextField';
import { criteriaToParams, type Criteria } from './searchParams';
import styles from './SearchForm.module.css';

export type SearchFormProps = {
  value: Criteria;
  onChange(c: Criteria): void;
  currencies: string[];
  /** Locate the player once on mount when the criteria carry no location; failures stay silent. */
  autoLocate?: boolean;
};

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;
/** Distance applied when a location is set without one chosen. */
const DEFAULT_RADIUS = String(SEARCH_RADII_KM[0]);

const ICONS = {
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  pin: 'M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M16 4v4M10 10v4M18 16v4',
  x: 'M18 6 6 18M6 6l12 12',
  chevron: 'm6 9 6 6 6-6',
};

function Icon({ d }: { d: string }) {
  return (
    <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  );
}

function minorToDecimal(minor: number | null, currency: string | null): string {
  if (minor === null || !currency) return '';
  const exp = currencyExponent(currency);
  if (exp === 0) return String(minor);
  const s = String(minor).padStart(exp + 1, '0');
  return `${s.slice(0, -exp)}.${s.slice(-exp)}`;
}

function radiusChoice(r: number | null): string {
  if (r === null) return 'any';
  return (SEARCH_RADII_KM as readonly number[]).includes(r) ? String(r) : 'custom';
}

type Texts = {
  radiusChoice: string;
  customRadius: string;
  min: string;
  max: string;
  priceDirty: boolean;
};

function textsFrom(v: Criteria): Texts {
  const choice = radiusChoice(v.radiusKm);
  return {
    radiusChoice: choice,
    customRadius: choice === 'custom' ? String(v.radiusKm) : '',
    min: minorToDecimal(v.minPrice, v.currency),
    max: minorToDecimal(v.maxPrice, v.currency),
    priceDirty: false,
  };
}

type Errors = { radius?: true; min?: true; max?: true; range?: true; time?: true };

/** A single comma is a decimal separator (Russian keyboards); anything else is left for parseMoney to judge. */
const normaliseDecimal = (s: string) =>
  !s.includes('.') && s.split(',').length === 2 ? s.replace(',', '.') : s;

export function SearchForm({ value, onChange, currencies, autoLocate = false }: SearchFormProps) {
  const { t } = useTranslation();
  const id = useId();
  const [draft, setDraft] = useState<Criteria>(value);
  const [texts, setTexts] = useState<Texts>(() => textsFrom(value));
  const [errors, setErrors] = useState<Errors>({});
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<'denied' | 'unavailable' | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  // Location, distance and sort apply at once: they ask for a submit that runs after the state lands.
  const submitPending = useRef(false);
  useEffect(() => {
    if (!submitPending.current) return;
    submitPending.current = false;
    formRef.current?.requestSubmit();
  }, [draft, texts]);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Re-sync when the criteria change from outside (URL navigation).
  const valueKey = criteriaToParams(value).toString();
  useEffect(() => {
    setDraft(value);
    setTexts(textsFrom(value));
    setErrors({});
    setLocationError(null);
    // valueKey stands in for `value`: a new object with the same content must not reset edits.
  }, [valueKey]);

  // Move focus to the first invalid field once the (possibly just reopened) filters are rendered.
  useEffect(() => {
    if (Object.keys(errors).length > 0)
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors]);

  const patch = (p: Partial<Criteria>) => setDraft((d) => ({ ...d, ...p }));
  // The URL's currency stays selectable even when no result in view uses it.
  const currencyOptions = [
    ...new Set([value.currency, ...currencies].filter((c): c is string => Boolean(c))),
  ];
  const priceCurrency =
    draft.currency && currencyOptions.includes(draft.currency)
      ? draft.currency
      : (currencyOptions[0] ?? null);

  function locate(silent = false) {
    setLocationError(null);
    if (!('geolocation' in navigator) || !navigator.geolocation) {
      if (!silent) setLocationError('unavailable');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!mounted.current) return;
        patch({ near: { lat: round4(pos.coords.latitude), lng: round4(pos.coords.longitude) } });
        setTexts((x) => (x.radiusChoice === 'any' ? { ...x, radiusChoice: DEFAULT_RADIUS } : x));
        setLocationError(null);
        setLocating(false);
        submitPending.current = true;
      },
      (err) => {
        if (!mounted.current) return;
        // Only code 1 is a refusal; unavailable (2) and timeout (3) usually mean the OS has location off.
        if (!silent) setLocationError(err.code === 1 ? 'denied' : 'unavailable');
        setLocating(false);
      },
      // A fix up to five minutes old is fine for distance search and avoids a slow fresh lookup.
      { timeout: 15000, maximumAge: 300000 },
    );
  }

  // Once per page: a link or reload that already carries a location keeps it.
  useEffect(() => {
    if (!autoLocate || value.near) return;
    let live = true;
    const perms = navigator.permissions?.query({ name: 'geolocation' });
    if (!perms) locate(true);
    else
      perms.then(
        (st) => live && st.state !== 'denied' && locate(true),
        () => live && locate(true),
      );
    return () => {
      live = false;
    };
    // Mount only; later criteria changes must not locate again.
  }, []);

  function submit(e: FormEvent) {
    e.preventDefault();
    const next: Errors = {};
    let radiusKm: number | null = null;
    if (draft.near) {
      if (texts.radiusChoice === 'custom') {
        const n = Number(texts.customRadius);
        if (/^\d+(\.\d+)?$/.test(texts.customRadius.trim()) && n >= 1 && n <= MAX_SEARCH_RADIUS_KM)
          radiusKm = n;
        else next.radius = true;
      } else if (texts.radiusChoice !== 'any') {
        radiusKm = Number(texts.radiusChoice);
      }
    }

    // Untouched price text keeps the filter exactly as it came in; edited text is parsed with the
    // currency it is shown in, so an amount is never re-denominated.
    let currency: string | null = draft.currency;
    let minPrice: number | null = draft.minPrice;
    let maxPrice: number | null = draft.maxPrice;
    if (texts.priceDirty) {
      currency = draft.currency;
      minPrice = null;
      maxPrice = null;
      const minText = normaliseDecimal(texts.min.trim());
      const maxText = normaliseDecimal(texts.max.trim());
      if (priceCurrency) {
        try {
          if (minText) minPrice = parseMoney(minText, priceCurrency);
        } catch (err) {
          if (!(err instanceof InvalidMoneyError)) throw err;
          next.min = true;
        }
        try {
          if (maxText) maxPrice = parseMoney(maxText, priceCurrency);
        } catch (err) {
          if (!(err instanceof InvalidMoneyError)) throw err;
          next.max = true;
        }
      }
      if (!next.min && !next.max && minPrice !== null && maxPrice !== null && minPrice > maxPrice)
        next.range = true;
    }

    // The currency shown by default is applied only once an amount is entered; without an amount it would
    // only hide venues priced in other currencies, so it is not sent at all.
    if (texts.priceDirty && (minPrice !== null || maxPrice !== null)) currency = priceCurrency;
    if (minPrice === null && maxPrice === null) currency = null;

    const hasFrom = Boolean(draft.from);
    const hasTo = Boolean(draft.to);
    if (hasFrom !== hasTo || (hasFrom && draft.from === draft.to)) next.time = true;

    setErrors(next);
    if (next.time || next.min || next.max || next.range) setMoreOpen(true);
    if (Object.keys(next).length > 0) return;

    onChange({
      ...draft,
      radiusKm,
      currency,
      minPrice,
      maxPrice,
    });
  }

  const radiusOptions = [
    { value: 'any', label: t('search.anyDistance') },
    ...SEARCH_RADII_KM.map((r) => ({ value: String(r), label: t('search.km', { count: r }) })),
    { value: 'custom', label: t('search.customOption') },
  ];
  const sportOptions = [
    { value: '', label: t('search.anySport') },
    ...SPORTS.map((s) => ({ value: s, label: t(`sports.${s}`) })),
  ];
  const sortOptions = [
    { value: 'default', label: t('search.sortDefault') },
    { value: 'rating', label: t('search.sortRating') },
  ];
  const indoorOptions = [
    { value: '', label: t('search.indoorAny') },
    { value: 'indoor', label: t('search.indoor') },
    { value: 'outdoor', label: t('search.outdoor') },
  ];
  const priceError = errors.range ? t('search.priceRange') : t('search.priceInvalid');

  const activeMore =
    (value.indoor !== null ? 1 : 0) +
    (value.from && value.to ? 1 : 0) +
    (value.available ? 1 : 0) +
    (value.minPrice !== null || value.maxPrice !== null ? 1 : 0);

  return (
    <form
      ref={formRef}
      className={styles.form}
      onSubmit={submit}
      noValidate
      aria-label={t('search.title')}
    >
      <div className={styles.bar}>
        <div className={styles.barField}>
          <label htmlFor={`${id}-sport`}>{t('search.sport')}</label>
          <span className={styles.selectWrap}>
            <select
              id={`${id}-sport`}
              value={draft.sport ?? ''}
              onChange={(e) =>
                patch({ sport: e.target.value ? (e.target.value as Criteria['sport']) : null })
              }
            >
              {sportOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <Icon d={ICONS.chevron} />
          </span>
        </div>
        <div className={styles.barField}>
          <label htmlFor={`${id}-date`}>{t('search.date')}</label>
          <input
            id={`${id}-date`}
            type="date"
            value={draft.date ?? ''}
            aria-describedby={`${id}-date-hint`}
            onChange={(e) => patch({ date: e.target.value || null })}
          />
          <span id={`${id}-date-hint`} className={styles.srOnly}>
            {t('search.dateHint')}
          </span>
        </div>
        <Button type="submit" variant="brand" className={styles.submit}>
          <Icon d={ICONS.search} />
          {t('search.submit')}
        </Button>
      </div>

      <div className={styles.chips}>
        {draft.near ? (
          <span className={`${styles.chip} ${styles.chipOn}`}>
            <Icon d={ICONS.pin} />
            {t('search.locationSet')}
            <button
              type="button"
              className={styles.chipClear}
              aria-label={t('search.clearLocation')}
              onClick={() => {
                patch({ near: null, radiusKm: null });
                submitPending.current = true;
              }}
            >
              <Icon d={ICONS.x} />
            </button>
          </span>
        ) : (
          <button
            type="button"
            className={styles.chip}
            disabled={locating}
            aria-busy={locating || undefined}
            onClick={() => locate()}
          >
            {locating ? <Spinner label={t('common.loading')} /> : <Icon d={ICONS.pin} />}
            {t('search.useMyLocation')}
          </button>
        )}

        <Select
          icon="distance"
          label={t('search.radius')}
          disabled={!draft.near}
          title={draft.near ? undefined : t('search.radiusNeedsLocation')}
          aria-describedby={draft.near ? undefined : `${id}-radius-hint`}
          value={draft.near ? texts.radiusChoice : 'any'}
          onChange={(e) => {
            setTexts((x) => ({ ...x, radiusChoice: e.target.value }));
            // A custom distance waits for its number and the Search button.
            if (e.target.value !== 'custom') submitPending.current = true;
          }}
          options={radiusOptions}
          className={styles.chipSelect}
        />

        <Select
          icon="sort"
          label={t('search.sort')}
          value={draft.sort}
          onChange={(e) => {
            patch({ sort: e.target.value === 'rating' ? 'rating' : 'default' });
            submitPending.current = true;
          }}
          options={sortOptions}
          className={styles.chipSelect}
        />

        <button
          type="button"
          className={[styles.chip, moreOpen && styles.chipOn].filter(Boolean).join(' ')}
          aria-expanded={moreOpen}
          aria-controls={`${id}-more`}
          onClick={() => setMoreOpen((o) => !o)}
        >
          <Icon d={ICONS.sliders} />
          <span>{t('search.moreFilters')}</span>
          {activeMore > 0 && <span className={styles.count}>{activeMore}</span>}
        </button>
      </div>

      {!draft.near && (
        <span id={`${id}-radius-hint`} className={styles.srOnly}>
          {t('search.radiusNeedsLocation')}
        </span>
      )}
      {locationError && !draft.near && (
        <p className={styles.error} role="alert">
          {t(locationError === 'denied' ? 'search.locationDenied' : 'search.locationUnavailable')}
        </p>
      )}
      {draft.near && texts.radiusChoice === 'custom' && (
        <div className={styles.custom}>
          <TextField
            icon="distance"
            label={t('search.customRadius')}
            type="number"
            inputMode="decimal"
            min={1}
            max={MAX_SEARCH_RADIUS_KM}
            value={texts.customRadius}
            error={
              errors.radius ? t('search.radiusInvalid', { max: MAX_SEARCH_RADIUS_KM }) : undefined
            }
            onChange={(e) => setTexts((x) => ({ ...x, customRadius: e.target.value }))}
          />
        </div>
      )}

      <div id={`${id}-more`} className={styles.panel} hidden={!moreOpen}>
        <Select
          icon="indoor"
          layout="stacked"
          label={t('search.indoorLabel')}
          value={draft.indoor === null ? '' : draft.indoor ? 'indoor' : 'outdoor'}
          onChange={(e) =>
            patch({ indoor: e.target.value === '' ? null : e.target.value === 'indoor' })
          }
          options={indoorOptions}
          className={styles.wide}
        />

        <TextField
          label={t('search.timeFrom')}
          type="time"
          step={1800}
          value={draft.from ?? ''}
          aria-describedby={`${id}-time-hint`}
          onChange={(e) => patch({ from: e.target.value || null })}
        />
        <TextField
          label={t('search.timeTo')}
          type="time"
          step={1800}
          value={draft.to ?? ''}
          error={errors.time ? t('search.timeInvalid') : undefined}
          onChange={(e) => patch({ to: e.target.value || null })}
        />
        <span id={`${id}-time-hint`} className={styles.srOnly}>
          {t('search.timeHint')}
        </span>

        {currencyOptions.length > 0 && (
          <fieldset className={styles.prices}>
            <legend className={styles.srOnly}>{t('search.price')}</legend>
            <Select
              icon="money"
              layout="stacked"
              label={t('search.currency')}
              value={priceCurrency ?? ''}
              onChange={(e) => {
                // Amounts typed under another currency would change meaning, so they are cleared.
                patch({ currency: e.target.value, minPrice: null, maxPrice: null });
                setTexts((x) => ({ ...x, min: '', max: '', priceDirty: false }));
              }}
              options={currencyOptions.map((c) => ({ value: c, label: c }))}
              className={styles.wide}
            />
            <TextField
              icon="money"
              label={t('search.minPrice')}
              inputMode="decimal"
              value={texts.min}
              error={errors.min || errors.range ? priceError : undefined}
              onChange={(e) => setTexts((x) => ({ ...x, min: e.target.value, priceDirty: true }))}
            />
            <TextField
              icon="money"
              label={t('search.maxPrice')}
              inputMode="decimal"
              value={texts.max}
              error={errors.max ? priceError : undefined}
              onChange={(e) => setTexts((x) => ({ ...x, max: e.target.value, priceDirty: true }))}
            />
          </fieldset>
        )}

        <label className={styles.check}>
          <input
            type="checkbox"
            checked={draft.available}
            onChange={(e) => patch({ available: e.target.checked })}
          />
          <span>{t('search.availableOnly')}</span>
        </label>
      </div>
    </form>
  );
}

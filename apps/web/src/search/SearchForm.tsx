import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { InvalidMoneyError, MAX_SEARCH_RADIUS_KM, SEARCH_RADII_KM, SPORTS, currencyExponent, parseMoney } from '@booking/shared';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { TextField } from '../components/ui/TextField';
import { criteriaToParams, type Criteria } from './searchParams';
import styles from './SearchForm.module.css';

export type SearchFormProps = {
  value: Criteria;
  onChange(c: Criteria): void;
  currencies: string[];
};

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

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

type Texts = { radiusChoice: string; customRadius: string; min: string; max: string; priceDirty: boolean };

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
const normaliseDecimal = (s: string) => (!s.includes('.') && s.split(',').length === 2 ? s.replace(',', '.') : s);

export function SearchForm({ value, onChange, currencies }: SearchFormProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Criteria>(value);
  const [texts, setTexts] = useState<Texts>(() => textsFrom(value));
  const [errors, setErrors] = useState<Errors>({});
  const [locating, setLocating] = useState(false);
  const [locationDenied, setLocationDenied] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
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
    setLocationDenied(false);
    // valueKey stands in for `value`: a new object with the same content must not reset edits.
  }, [valueKey]);

  // Move focus to the first invalid field once the (possibly just reopened) filters are rendered.
  useEffect(() => {
    if (Object.keys(errors).length > 0) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors]);

  const patch = (p: Partial<Criteria>) => setDraft((d) => ({ ...d, ...p }));
  // The URL's currency stays selectable even when no result in view uses it.
  const currencyOptions = [...new Set([value.currency, ...currencies].filter((c): c is string => Boolean(c)))];
  const priceCurrency = draft.currency && currencyOptions.includes(draft.currency) ? draft.currency : (currencyOptions[0] ?? null);

  function locate() {
    setLocationDenied(false);
    if (!('geolocation' in navigator) || !navigator.geolocation) {
      setLocationDenied(true);
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!mounted.current) return;
        patch({ near: { lat: round4(pos.coords.latitude), lng: round4(pos.coords.longitude) } });
        setLocating(false);
      },
      () => {
        if (!mounted.current) return;
        setLocationDenied(true);
        setLocating(false);
      },
      { timeout: 10000 },
    );
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const next: Errors = {};
    let radiusKm: number | null = null;
    if (draft.near) {
      if (texts.radiusChoice === 'custom') {
        const n = Number(texts.customRadius);
        if (/^\d+(\.\d+)?$/.test(texts.customRadius.trim()) && n >= 1 && n <= MAX_SEARCH_RADIUS_KM) radiusKm = n;
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
      if (!next.min && !next.max && minPrice !== null && maxPrice !== null && minPrice > maxPrice) next.range = true;
    }

    // The currency shown by default is applied only once an amount is entered.
    if (texts.priceDirty && (minPrice !== null || maxPrice !== null)) currency = priceCurrency;

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
  const sportOptions = [{ value: '', label: t('search.anySport') }, ...SPORTS.map((s) => ({ value: s, label: t(`sports.${s}`) }))];
  const indoorOptions = [
    { value: '', label: t('search.indoorAny') },
    { value: 'indoor', label: t('search.indoor') },
    { value: 'outdoor', label: t('search.outdoor') },
  ];
  const priceError = errors.range ? t('search.priceRange') : t('search.priceInvalid');

  return (
    <form ref={formRef} className={styles.form} onSubmit={submit} noValidate aria-label={t('search.title')}>
      <div className={styles.location}>
        <Button type="button" variant="secondary" size="lg" loading={locating} onClick={locate}>
          {t('search.useMyLocation')}
        </Button>
        {draft.near && (
          <>
            <span className={styles.coords}>{t('search.locationSet')}</span>
            <Button type="button" variant="ghost" size="lg" onClick={() => patch({ near: null, radiusKm: null })}>
              {t('search.clearLocation')}
            </Button>
          </>
        )}
      </div>
      {locationDenied && <p className={styles.error} role="alert">{t('search.locationDenied')}</p>}

      <div className={styles.field}>
        <Select
          size="lg"
          label={t('search.radius')}
          disabled={!draft.near}
          value={draft.near ? texts.radiusChoice : 'any'}
          onChange={(e) => setTexts((x) => ({ ...x, radiusChoice: e.target.value }))}
          options={radiusOptions}
          className={styles.stacked}
        />
        {!draft.near && <p className={styles.hint}>{t('search.radiusNeedsLocation')}</p>}
        {draft.near && texts.radiusChoice === 'custom' && (
          <TextField
            label={t('search.customRadius')}
            type="number"
            inputMode="decimal"
            min={1}
            max={MAX_SEARCH_RADIUS_KM}
            value={texts.customRadius}
            error={errors.radius ? t('search.radiusInvalid', { max: MAX_SEARCH_RADIUS_KM }) : undefined}
            onChange={(e) => setTexts((x) => ({ ...x, customRadius: e.target.value }))}
          />
        )}
      </div>

      <Select
        size="lg"
        label={t('search.sport')}
        value={draft.sport ?? ''}
        onChange={(e) => patch({ sport: e.target.value ? (e.target.value as Criteria['sport']) : null })}
        options={sportOptions}
        className={styles.stacked}
      />

      <TextField label={t('search.date')} type="date" hint={t('search.dateHint')} value={draft.date ?? ''} onChange={(e) => patch({ date: e.target.value || null })} />

      <details className={styles.more} open={moreOpen} onToggle={(e) => setMoreOpen(e.currentTarget.open)}>
        <summary className={styles.summary}>{t('search.moreFilters')}</summary>
        <div className={styles.moreBody}>
          <Select
            size="lg"
            label={t('search.indoorLabel')}
            value={draft.indoor === null ? '' : draft.indoor ? 'indoor' : 'outdoor'}
            onChange={(e) => patch({ indoor: e.target.value === '' ? null : e.target.value === 'indoor' })}
            options={indoorOptions}
            className={styles.stacked}
          />

          <div className={styles.pair}>
            <TextField label={t('search.timeFrom')} type="time" step={1800} value={draft.from ?? ''} onChange={(e) => patch({ from: e.target.value || null })} />
            <TextField label={t('search.timeTo')} type="time" step={1800} value={draft.to ?? ''} error={errors.time ? t('search.timeInvalid') : undefined} onChange={(e) => patch({ to: e.target.value || null })} />
          </div>
          <p className={styles.hint}>{t('search.timeHint')}</p>

          <label className={styles.check}>
            <input type="checkbox" checked={draft.available} onChange={(e) => patch({ available: e.target.checked })} />
            <span>{t('search.availableOnly')}</span>
          </label>

          {currencyOptions.length > 0 && (
            <fieldset className={styles.prices}>
              <legend className={styles.legend}>{t('search.price')}</legend>
              <Select
                size="lg"
                label={t('search.currency')}
                value={priceCurrency ?? ''}
                onChange={(e) => {
                  // Amounts typed under another currency would change meaning, so they are cleared.
                  patch({ currency: e.target.value, minPrice: null, maxPrice: null });
                  setTexts((x) => ({ ...x, min: '', max: '', priceDirty: false }));
                }}
                options={currencyOptions.map((c) => ({ value: c, label: c }))}
                className={styles.stacked}
              />
              <div className={styles.pair}>
                <TextField
                  label={t('search.minPrice')}
                  inputMode="decimal"
                  value={texts.min}
                  error={errors.min || errors.range ? priceError : undefined}
                  onChange={(e) => setTexts((x) => ({ ...x, min: e.target.value, priceDirty: true }))}
                />
                <TextField
                  label={t('search.maxPrice')}
                  inputMode="decimal"
                  value={texts.max}
                  error={errors.max ? priceError : undefined}
                  onChange={(e) => setTexts((x) => ({ ...x, max: e.target.value, priceDirty: true }))}
                />
              </div>
            </fieldset>
          )}
        </div>
      </details>

      <Button type="submit" variant="brand" size="lg" block>
        {t('search.submit')}
      </Button>
    </form>
  );
}

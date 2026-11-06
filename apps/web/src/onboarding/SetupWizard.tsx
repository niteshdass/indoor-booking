import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { MAX_SETUP_TURFS, WALLET_PROVIDERS, WEEKDAYS, type SetupResult, type Sport, type Weekday } from '@booking/shared';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Checkbox } from '../components/ui/Checkbox';
import { Icon } from '../components/ui/Icon';
import { Select } from '../components/ui/Select';
import { TextField } from '../components/ui/TextField';
import { SUPPORTED_LANGUAGES } from '../i18n';
import { SportCourt } from '../landing/SportCourt';
import { ApiError } from '../lib/apiClient';
import { errorMessage } from '../lib/errors';
import { money } from '../lib/format';
import { countryOptions, currencyOptions, defaultZoneFor, timeZoneOptions } from '../lib/regions';
import { useSports } from '../lib/sports';
import { PROVIDER_NAMES } from '../lib/wallets';
import { weekdayNames } from '../owner/settings/HoursEditor';
import {
  HOURS_PRESETS,
  SLOT_LENGTHS,
  STEPS,
  clampTurfs,
  hasWallets,
  openTimes,
  priceMinor,
  stepErrors,
  turfName,
  type Answers,
  type HoursPreset,
  type Step,
} from './answers';
import { ChoiceTiles, Counter, PickTiles } from './Tiles';
import { useDraft } from './useDraft';
import styles from './onboarding.module.css';

const LocationPicker = lazy(() => import('../owner/venues/LocationPicker').then((m) => ({ default: m.LocationPicker })));

const NAME_MAX = 100;
const TURF_NAME_MAX = 60;

export type SetupWizardProps = {
  /** `business`: someone new, who may also pick another country; `venue`: one more venue for a running business. */
  mode: 'business' | 'venue';
  /** Where this browser keeps the unfinished answers. */
  draftKey: string;
  initial: Answers;
  mapLinkPath: string;
  submit(answers: Answers): Promise<SetupResult>;
  /** What to show once the venue is created. */
  done(result: SetupResult, answers: Answers): ReactNode;
};

/** "6:00 am" in the reader's language from "06:00"; a closing "00:00" reads as midnight. */
function useClock() {
  const { t, i18n } = useTranslation();
  const fmt = new Intl.DateTimeFormat(i18n.language, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
  return (hhmm: string, closing = false) => {
    if (closing && hhmm === '00:00') return t('onboarding.hours.midnight');
    const [h, m] = hhmm.split(':').map(Number);
    return fmt.format(new Date(Date.UTC(2024, 0, 1, h ?? 0, m ?? 0)));
  };
}

function currencySign(currency: string, lang: string): string {
  try {
    const part = new Intl.NumberFormat(lang, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' })
      .formatToParts(0)
      .find((p) => p.type === 'currency');
    return part?.value ?? currency;
  } catch {
    return currency;
  }
}

/**
 * The easy venue setup: one plain question per screen with big tiles, for owners who ran their turf on paper.
 * Answers are kept in this browser until the venue is created, so a dropped connection loses nothing.
 */
export function SetupWizard({ mode, draftKey, initial, mapLinkPath, submit, done }: SetupWizardProps) {
  const { t } = useTranslation();
  const { answers: a, step, update, goTo, clear } = useDraft(draftKey, initial);
  const [tried, setTried] = useState<Partial<Record<Step, boolean>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<SetupResult | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const shownStep = useRef(step);
  const numbered = (n: number) => t('onboarding.turfs.numbered', { n });

  const index = STEPS.indexOf(step);
  const errors = stepErrors(step, a, numbered);
  const shown = tried[step] ? errors : [];
  const err = (key: string) => (shown.includes(key) ? t(`onboarding.err.${key}`) : undefined);

  // A new screen reads from its question, for screen readers and for a phone scrolled down.
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    root.current?.querySelector('h1')?.focus({ preventScroll: true });
    if (window.scrollY > 0) window.scrollTo(0, 0);
  }, [step]);

  if (result) return <>{done(result, a)}</>;
  const pending = error instanceof ApiError && error.code === 'application_pending';

  const next = async (e: FormEvent) => {
    e.preventDefault();
    if (errors.length > 0) {
      setTried((s) => ({ ...s, [step]: true }));
      return;
    }
    if (step !== 'review') {
      goTo(STEPS[index + 1]!);
      return;
    }
    // Every screen was passed, but a draft from another visit may have skipped one.
    const open = STEPS.find((s) => stepErrors(s, a, numbered).length > 0);
    if (open) {
      setTried((s) => ({ ...s, [open]: true }));
      goTo(open);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await submit(a);
      clear();
      setResult(r);
    } catch (caught) {
      setError(caught);
      setBusy(false);
    }
  };

  const screens: Record<Step, ReactNode> = {
    name: <NameStep a={a} update={update} err={err} mode={mode} />,
    place: <PlaceStep a={a} update={update} err={err} mapLinkPath={mapLinkPath} />,
    turfs: <TurfsStep a={a} update={update} err={err} numbered={numbered} />,
    hours: <HoursStep a={a} update={update} err={err} />,
    price: <PriceStep a={a} update={update} err={err} />,
    payment: <PaymentStep a={a} update={update} err={err} />,
    review: <ReviewStep a={a} update={update} mode={mode} numbered={numbered} edit={goTo} />,
  };

  return (
    <div ref={root} className={styles.wizard}>
      <div className={styles.progress}>
        <p className={styles.stepOf}>{t('onboarding.stepOf', { n: index + 1, total: STEPS.length })}</p>
        <ol className={styles.bar} aria-hidden="true">
          {STEPS.map((s, i) => (
            <li key={s} className={i <= index ? styles.barDone : undefined} />
          ))}
        </ol>
      </div>

      <form className={styles.screen} onSubmit={(e) => void next(e)} noValidate>
        <div className={styles.ask}>
          <h1 tabIndex={-1} className={styles.question}>
            {t(`onboarding.${step}.question`)}
          </h1>
          <p className={styles.lead}>{t(`onboarding.${step}.lead`)}</p>
        </div>

        {screens[step]}

        {error !== null && (
          <Alert tone={pending ? 'info' : 'danger'}>
            {errorMessage(error, t)}
            {pending && (
              <>
                {' '}
                <Link to="/owner">{t('apply.seeStatus')}</Link>
              </>
            )}
          </Alert>
        )}

        <div className={styles.nav}>
          {index > 0 && (
            <Button variant="secondary" size="lg" icon="arrowLeft" onClick={() => goTo(STEPS[index - 1]!)} disabled={busy}>
              {t('onboarding.back')}
            </Button>
          )}
          <Button type="submit" variant="brand" size="lg" icon={step === 'review' ? 'check' : undefined} loading={busy} className={styles.next}>
            {step === 'review' ? t('onboarding.finish') : t('onboarding.next')}
          </Button>
        </div>
        {step === 'name' && <p className={styles.saved}>{t('onboarding.savedHere')}</p>}
      </form>
    </div>
  );
}

type StepProps = { a: Answers; update(patch: Partial<Answers>): void; err(key: string): string | undefined };

function NameStep({ a, update, err, mode }: StepProps & { mode: SetupWizardProps['mode'] }) {
  const { t, i18n } = useTranslation();
  return (
    <>
      <ChoiceTiles
        name="language"
        legend={t('onboarding.name.language')}
        size="chip"
        value={(SUPPORTED_LANGUAGES as readonly string[]).includes(i18n.language) ? i18n.language : 'en'}
        options={SUPPORTED_LANGUAGES.map((l) => ({ value: l, label: t(`apply.locale.${l}`) }))}
        onChange={(l) => void i18n.changeLanguage(l)}
      />
      <TextField
        className={styles.big}
        icon="venue"
        label={t('onboarding.name.label')}
        hint={t('onboarding.name.hint')}
        maxLength={NAME_MAX}
        autoComplete="organization"
        value={a.name}
        error={err('name')}
        onChange={(e) => update({ name: e.target.value })}
      />
      {mode === 'business' && (
        <details className={styles.more}>
          <summary className={styles.moreSummary}>
            <Icon name="globe" />
            {t('onboarding.name.elsewhere')}
          </summary>
          <div className={styles.moreBody}>
            <Select
              icon="globe"
              layout="stacked"
              label={t('apply.country')}
              value={a.country}
              options={countryOptions(i18n.language, a.country)}
              onChange={(e) => update({ country: e.target.value })}
            />
            <Select
              icon="money"
              layout="stacked"
              label={t('apply.currency')}
              hint={t('apply.currencyHint')}
              value={a.currency}
              options={currencyOptions(i18n.language, a.currency)}
              onChange={(e) => update({ currency: e.target.value })}
            />
          </div>
        </details>
      )}
    </>
  );
}

function PlaceStep({ a, update, err, mapLinkPath }: StepProps & { mapLinkPath: string }) {
  const { t } = useTranslation();
  // Drafts saved before the field existed have no timezone.
  const zone = a.timezone || defaultZoneFor(a.country);
  const zones = useMemo(() => timeZoneOptions(zone), [zone]);
  return (
    <>
      <div className={styles.fields}>
        <TextField icon="city" label={t('onboarding.place.city')} maxLength={100} autoComplete="address-level2" value={a.city} error={err('city')} onChange={(e) => update({ city: e.target.value })} />
        <TextField
          icon="pin"
          label={t('onboarding.place.address')}
          hint={t('onboarding.place.addressHint')}
          maxLength={300}
          autoComplete="street-address"
          value={a.address}
          error={err('address')}
          onChange={(e) => update({ address: e.target.value })}
        />
        <Select
          icon="timezone"
          layout="stacked"
          label={t('onboarding.place.timezone')}
          hint={t('onboarding.place.timezoneHint')}
          value={zone}
          options={zones}
          onChange={(e) => update({ timezone: e.target.value })}
        />
      </div>
      <div className={styles.group}>
        <p className={styles.legend}>{t('onboarding.place.map')}</p>
        <p className={styles.groupHint}>{t('onboarding.place.mapHint')}</p>
        <Suspense fallback={<div className={styles.mapWait} />}>
          <LocationPicker
            lat={a.lat}
            lng={a.lng}
            country={a.country}
            mapLinkPath={mapLinkPath}
            onChange={(lat, lng) => update({ lat, lng })}
            onPlace={(p) =>
              update({
                ...(a.city ? {} : { city: p.city ?? '' }),
                ...(a.address ? {} : { address: p.label.split(', ').slice(0, 3).join(', ').slice(0, 300) }),
              })
            }
          />
        </Suspense>
        {err('pin') && (
          <p className={styles.error} role="alert">
            {err('pin')}
          </p>
        )}
      </div>
    </>
  );
}

function TurfsStep({ a, update, err, numbered }: StepProps & { numbered(n: number): string }) {
  const { t } = useTranslation();
  const offered = useSports(a.sports);
  const setName = (i: number, name: string) => {
    const names = [...a.turfNames];
    names[i] = name;
    update({ turfNames: names });
  };
  return (
    <>
      <div className={styles.group}>
        <p className={styles.legend}>{t('onboarding.turfs.count')}</p>
        <Counter
          label={t('onboarding.turfs.count')}
          less={t('onboarding.turfs.less')}
          more={t('onboarding.turfs.more')}
          value={a.turfCount}
          min={1}
          max={MAX_SETUP_TURFS}
          onChange={(n) => update({ turfCount: clampTurfs(n) })}
        />
      </div>
      <PickTiles<Sport>
        legend={t('onboarding.turfs.sports')}
        hint={t('onboarding.turfs.sportsHint')}
        size="wide"
        value={a.sports}
        error={err('sports')}
        options={offered.map((s) => ({ value: s, label: t(`sports.${s}`), art: <SportCourt sport={s} className={styles.court} /> }))}
        onChange={(sports) => update({ sports })}
      />
      <ChoiceTiles
        name="indoor"
        legend={t('onboarding.turfs.roof')}
        value={a.indoor ? 'indoor' : 'open'}
        options={[
          { value: 'open', label: t('onboarding.turfs.open') },
          { value: 'indoor', label: t('onboarding.turfs.indoor') },
        ]}
        onChange={(v) => update({ indoor: v === 'indoor' })}
      />
      <details className={styles.more} open={err('turfNames') ? true : undefined}>
        <summary className={styles.moreSummary}>
          <Icon name="edit" />
          {t('onboarding.turfs.rename')}
        </summary>
        <div className={styles.moreBody}>
          {Array.from({ length: a.turfCount }, (_, i) => (
            <TextField
              key={i}
              icon="court"
              label={t('onboarding.turfs.nameOf', { n: i + 1 })}
              placeholder={numbered(i + 1)}
              maxLength={TURF_NAME_MAX}
              value={a.turfNames[i] ?? ''}
              onChange={(e) => setName(i, e.target.value)}
            />
          ))}
          {err('turfNames') && (
            <p className={styles.error} role="alert">
              {err('turfNames')}
            </p>
          )}
        </div>
      </details>
      <p className={styles.note}>{t('onboarding.turfs.later')}</p>
    </>
  );
}

const lengthKey = (min: number) => `onboarding.length.m${min}`;

function HoursStep({ a, update, err }: StepProps) {
  const { t, i18n } = useTranslation();
  const clock = useClock();
  const days = weekdayNames(i18n.language);
  const presets = Object.keys(HOURS_PRESETS) as (keyof typeof HOURS_PRESETS)[];
  return (
    <>
      <ChoiceTiles<HoursPreset>
        name="hours"
        legend={t('onboarding.hours.when')}
        value={a.hours}
        options={[
          ...presets.map((p) => ({
            value: p,
            label: p === 'allDay' ? t('onboarding.hours.allDay') : t('onboarding.hours.range', { from: clock(HOURS_PRESETS[p].open), to: clock(HOURS_PRESETS[p].close, true) }),
            hint: p === 'allDay' ? t('onboarding.hours.allDayHint') : undefined,
          })),
          { value: 'custom', label: t('onboarding.hours.custom') },
        ]}
        onChange={(hours) => update({ hours })}
      />
      {a.hours === 'custom' && (
        <div className={styles.pair}>
          <TextField icon="clock" type="time" label={t('onboarding.hours.opens')} value={a.open} onChange={(e) => update({ open: e.target.value })} />
          <TextField
            icon="clock"
            type="time"
            label={t('onboarding.hours.closes')}
            hint={a.close <= a.open ? t('onboarding.hours.nextDay') : undefined}
            value={a.close}
            error={err('times')}
            onChange={(e) => update({ close: e.target.value })}
          />
        </div>
      )}
      <PickTiles<Weekday>
        legend={t('onboarding.hours.closed')}
        hint={t('onboarding.hours.closedHint')}
        size="chip"
        value={a.closedDays}
        error={err('allClosed')}
        options={WEEKDAYS.map((d) => ({ value: d, label: days[d] }))}
        onChange={(closedDays) => update({ closedDays })}
      />
      <ChoiceTiles
        name="length"
        legend={t('onboarding.hours.length')}
        hint={t('onboarding.hours.lengthHint')}
        value={String(a.slotLengthMin)}
        options={SLOT_LENGTHS.map((m) => ({ value: String(m), label: t(lengthKey(m)) }))}
        onChange={(v) => update({ slotLengthMin: Number(v) })}
      />
    </>
  );
}

function PriceStep({ a, update, err }: StepProps) {
  const { t, i18n } = useTranslation();
  const clock = useClock();
  const lang = i18n.language;
  const sign = currencySign(a.currency, lang);
  const length = t(lengthKey(a.slotLengthMin));
  const base = priceMinor(a.price, a.currency);
  const evening = a.evening ? priceMinor(a.eveningPrice, a.currency) : null;
  return (
    <>
      <TextField
        className={styles.big}
        icon="money"
        inputMode="decimal"
        autoComplete="off"
        label={t('onboarding.price.label', { length, sign })}
        hint={t('onboarding.price.hint')}
        value={a.price}
        error={err('price')}
        onChange={(e) => update({ price: e.target.value })}
      />
      <div className={styles.group}>
        <Checkbox label={t('onboarding.price.evening')} hint={t('onboarding.price.eveningHint')} checked={a.evening} onChange={(evening) => update({ evening })} />
        {a.evening && (
          <div className={styles.pair}>
            <TextField icon="clock" type="time" label={t('onboarding.price.from')} value={a.eveningFrom} error={err('eveningFrom')} onChange={(e) => update({ eveningFrom: e.target.value })} />
            <TextField
              icon="money"
              inputMode="decimal"
              autoComplete="off"
              label={t('onboarding.price.eveningLabel', { sign })}
              value={a.eveningPrice}
              error={err('eveningPrice')}
              onChange={(e) => update({ eveningPrice: e.target.value })}
            />
          </div>
        )}
      </div>
      {base !== null && (
        <p className={styles.example} aria-live="polite">
          {evening !== null
            ? t('onboarding.price.exampleEvening', { length, day: money(base, a.currency, lang), evening: money(evening, a.currency, lang), from: clock(a.eveningFrom) })
            : t('onboarding.price.example', { length, price: money(base, a.currency, lang) })}
        </p>
      )}
    </>
  );
}

function PaymentStep({ a, update, err }: StepProps) {
  const { t } = useTranslation();
  return (
    <>
      <div className={styles.always}>
        <Icon name="money" className={styles.alwaysIcon} />
        <span className={styles.tileText}>
          <span className={styles.tileLabel}>{t('onboarding.payment.cash')}</span>
          <span className={styles.tileHint}>{t('onboarding.payment.cashHint')}</span>
        </span>
        <Icon name="check" className={`${styles.tick} ${styles.tickOn}`} />
      </div>
      {hasWallets(a.country) && (
        <div className={styles.group}>
          <p className={styles.legend}>{t('onboarding.payment.wallets')}</p>
          <p className={styles.groupHint}>{t('onboarding.payment.walletsHint')}</p>
          <div className={styles.fields}>
            {WALLET_PROVIDERS.map((p) => (
              <TextField
                key={p}
                icon="phone"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                label={t('onboarding.payment.number', { provider: PROVIDER_NAMES[p] })}
                placeholder="01XXXXXXXXX"
                value={a.wallets[p] ?? ''}
                onChange={(e) => update({ wallets: { ...a.wallets, [p]: e.target.value } })}
              />
            ))}
          </div>
          {err('wallet') && (
            <p className={styles.error} role="alert">
              {err('wallet')}
            </p>
          )}
        </div>
      )}
      <p className={styles.note}>{t('onboarding.payment.later')}</p>
    </>
  );
}

function ReviewStep({ a, update, mode, numbered, edit }: Omit<StepProps, 'err'> & { mode: SetupWizardProps['mode']; numbered(n: number): string; edit(s: Step): void }) {
  const { t, i18n } = useTranslation();
  const clock = useClock();
  const lang = i18n.language;
  const days = weekdayNames(lang);
  const times = openTimes(a);
  const base = priceMinor(a.price, a.currency);
  const evening = a.evening ? priceMinor(a.eveningPrice, a.currency) : null;
  const wallets = hasWallets(a.country)
    ? WALLET_PROVIDERS.filter((p) => a.wallets[p]?.trim()).map((p) => `${PROVIDER_NAMES[p]} ${a.wallets[p]!.trim()}`)
    : [];
  const list = new Intl.ListFormat(lang, { type: 'conjunction' });
  const rows: { step: Step; label: string; value: ReactNode }[] = [
    { step: 'name', label: t('onboarding.review.name'), value: a.name },
    { step: 'place', label: t('onboarding.review.place'), value: [a.address, a.city].filter(Boolean).join(', ') },
    {
      step: 'turfs',
      label: t('onboarding.review.turfs'),
      value: (
        <>
          {Array.from({ length: a.turfCount }, (_, i) => turfName(a, i, numbered)).join(', ')}
          <span className={styles.sub}>
            {list.format(a.sports.map((s) => t(`sports.${s}`)))} · {t(a.indoor ? 'onboarding.turfs.indoor' : 'onboarding.turfs.open')}
          </span>
        </>
      ),
    },
    {
      step: 'hours',
      label: t('onboarding.review.hours'),
      value: (
        <>
          {a.hours === 'allDay' ? t('onboarding.hours.allDay') : t('onboarding.hours.range', { from: clock(times.open), to: clock(times.close, true) })}
          <span className={styles.sub}>
            {a.closedDays.length > 0
              ? t('onboarding.review.closedOn', { days: list.format(WEEKDAYS.filter((d) => a.closedDays.includes(d)).map((d) => days[d])) })
              : t('onboarding.review.everyDay')}
            {' · '}
            {t('onboarding.review.games', { length: t(lengthKey(a.slotLengthMin)) })}
          </span>
        </>
      ),
    },
    {
      step: 'price',
      label: t('onboarding.review.price'),
      value: (
        <>
          {base !== null && money(base, a.currency, lang)}
          {evening !== null && <span className={styles.sub}>{t('onboarding.review.evening', { from: clock(a.eveningFrom), price: money(evening, a.currency, lang) })}</span>}
        </>
      ),
    },
    {
      step: 'payment',
      label: t('onboarding.review.payment'),
      value: list.format([t('onboarding.payment.cash'), ...wallets]),
    },
  ];
  return (
    <>
      <dl className={styles.sheet}>
        {rows.map((r) => (
          <div key={r.step} className={styles.sheetRow}>
            <dt className={styles.sheetLabel}>{r.label}</dt>
            <dd className={styles.sheetValue}>{r.value}</dd>
            <dd className={styles.sheetEdit}>
              <Button variant="ghost" size="sm" icon="edit" onClick={() => edit(r.step)} aria-label={t('onboarding.review.editOf', { what: r.label })}>
                {t('onboarding.review.edit')}
              </Button>
            </dd>
          </div>
        ))}
      </dl>
      <Checkbox
        label={t('onboarding.review.publish')}
        hint={mode === 'business' ? t('onboarding.review.publishPending') : t('onboarding.review.publishHint')}
        checked={a.publish}
        onChange={(publish) => update({ publish })}
      />
    </>
  );
}

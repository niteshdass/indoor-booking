import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { currencyExponent, localParts, parseMoney, type AddonSelection } from '@booking/shared';
import { AddonPicker } from '../../checkout/AddonPicker';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { Skeleton } from '../../components/ui/Skeleton';
import { TextField } from '../../components/ui/TextField';
import { ApiError, apiPost } from '../../lib/apiClient';
import { errorMessage } from '../../lib/errors';
import { money } from '../../lib/format';
import type { SlotDay } from '../../lib/types';
import { DateStrip } from '../../venue/DateStrip';
import { SlotGrid } from '../../venue/SlotGrid';
import { keepSelectable, toggleSlot } from '../../venue/slotSelection';
import { PaymentLinkDialog } from '../bookings/PaymentLinkDialog';
import { CustomerFields, customerErrors, type Customer } from '../CustomerFields';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import { useOwnerTitle } from '../shell/OwnerShell';
import { useVenueParam } from '../shell/useVenueParam';
import { VenueSelect } from '../shell/VenueSelect';
import type { OwnerBooking, OwnerSlotDay, OwnerTurf, OwnerVenue, PaymentLink, WalkInAddon } from '../types';
import { ActiveTurfs } from '../turfs/ActiveTurfs';
import { useResource } from '../useResource';
import { walkInEstimate } from './walkInEstimate';
import common from '../ownerForm.module.css';
import styles from './WalkInPage.module.css';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Errors that mean the slot grid on screen is stale. */
const STALE_CODES = ['slot_taken', 'slot_unavailable', 'outside_window'];
type Method = 'cash' | 'link' | 'unpaid';

/** Owner walk-in: pick a turf, date and slots, add the customer and take (or defer) payment. */
export function WalkInPage() {
  const { t } = useTranslation();
  const [venue] = useVenueParam();
  useOwnerTitle(t('owner.nav.walkIn'));
  if (!venue) return <p className={common.empty}>{t('owner.today.noVenues')}</p>;
  return (
    <div className={common.page}>
      <VenueSelect />
      <WalkInVenue key={venue.id} venue={venue} />
    </div>
  );
}

function WalkInVenue({ venue }: { venue: OwnerVenue }) {
  return <ActiveTurfs venue={venue}>{(turfs) => <WalkInForm venue={venue} turfs={turfs} />}</ActiveTurfs>;
}

/** Minor units as an input value, e.g. 1000 BDT -> "10.00". */
function forInput(minor: number, currency: string): string {
  const exponent = currencyExponent(currency);
  return (minor / 10 ** exponent).toFixed(exponent);
}

function WalkInForm({ venue, turfs }: { venue: OwnerVenue; turfs: OwnerTurf[] }) {
  const { t, i18n } = useTranslation();
  const { ownerId, can } = useOwner();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const lang = i18n.language;
  const today = localParts(new Date(), venue.timezone).date;
  const requestedDate = params.get('date');
  const date = requestedDate && DATE.test(requestedDate) ? requestedDate : today;
  const turf = turfs.find((x) => x.id === params.get('turf')) ?? turfs[0]!;

  const [selected, setSelected] = useState<string[]>([]);
  const [addons, setAddons] = useState<AddonSelection[]>([]);
  const [customer, setCustomer] = useState<Customer>({ name: '', phone: '' });
  const [method, setMethod] = useState<Method>('unpaid');
  const [cashText, setCashText] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [link, setLink] = useState<{ link: PaymentLink; bookingId: string } | null>(null);
  const busy = useRef(false);
  const prefill = useRef(params.get('start'));

  const base = ownerPath(ownerId, `/venues/${encodeURIComponent(venue.id)}/turfs/${encodeURIComponent(turf.id)}`);
  const slots = useResource<{ day: OwnerSlotDay }>(`${base}/slots?date=${date}`);
  const addonRes = useResource<{ currency: string; addons: WalkInAddon[] }>(`${base}/addons`);
  const rawDay = slots.state.status === 'ready' ? slots.state.data.day : null;
  const offered = addonRes.state.status === 'ready' ? addonRes.state.data.addons : [];

  // Whenever slots (re)load: apply the schedule's pre-selection once, then drop anything no longer selectable.
  useEffect(() => {
    if (!rawDay) return;
    const start = prefill.current;
    prefill.current = null;
    setSelected((prev) => keepSelectable(rawDay.slots, start ? toggleSlot(rawDay.slots, [], start) : prev));
  }, [rawDay]);

  const gridDay: SlotDay | null = useMemo(
    () => (rawDay ? { businessDate: rawDay.businessDate, currency: rawDay.currency, status: rawDay.closed ? 'closed' : 'open', slots: rawDay.slots } : null),
    [rawDay],
  );
  const estimate = useMemo(
    () =>
      rawDay
        ? walkInEstimate({ slots: rawDay.slots.filter((s) => selected.includes(s.startAt)), offered, indoor: turf.indoor, selection: addons })
        : null,
    [rawDay, selected, offered, turf.indoor, addons],
  );

  const change = (next: { turf?: string; date?: string }) => {
    setParams(
      (prev) => {
        const copy = new URLSearchParams(prev);
        if (next.turf) copy.set('turf', next.turf);
        if (next.date) copy.set('date', next.date);
        copy.delete('start');
        return copy;
      },
      { replace: true },
    );
    prefill.current = null;
    setSelected([]);
    if (next.turf) setAddons([]);
    setError(null);
  };

  const currency = rawDay?.currency ?? venue.currency;
  const inWindow = rawDay?.inWindow ?? true;
  let cashAmount: number | undefined;
  let cashOk = true;
  if (method === 'cash' && cashText !== null) {
    try {
      cashAmount = parseMoney(cashText.trim(), currency);
      cashOk = cashAmount >= 1;
    } catch {
      cashOk = false;
    }
  }

  const submit = async () => {
    if (busy.current || !rawDay || !inWindow || selected.length === 0) return;
    setTried(true);
    const bad = customerErrors(customer);
    if (bad.name || bad.phone || !cashOk) return;
    busy.current = true;
    setSubmitting(true);
    setError(null);
    const payment =
      method === 'cash' ? (cashAmount === undefined ? { method: 'cash' as const } : { method: 'cash' as const, amount: cashAmount }) : { method };
    try {
      const res = await apiPost<{ booking: OwnerBooking; payment?: PaymentLink }>(`${base}/bookings`, {
        date,
        startAts: selected,
        addons,
        customer: { name: customer.name.trim(), phone: customer.phone },
        payment,
      });
      if (res.payment) setLink({ link: res.payment, bookingId: res.booking.id });
      else navigate(`/owner/${encodeURIComponent(ownerId)}/bookings/${encodeURIComponent(res.booking.id)}`);
    } catch (e) {
      setError(e);
      if (e instanceof ApiError && STALE_CODES.includes(e.code)) slots.reload();
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  };

  const canCash = can('payment.mark_cash');
  const methods: { key: Method; label: string }[] = [
    ...(canCash ? [{ key: 'cash' as const, label: t('owner.walkIn.cash') }] : []),
    { key: 'link', label: t('owner.walkIn.link') },
    { key: 'unpaid', label: t('owner.walkIn.unpaid') },
  ];

  let grid;
  if (slots.state.status === 'error') {
    grid = (
      <Alert tone="danger">
        <p className={common.empty}>{errorMessage(slots.state.error, t)}</p>
        <Button variant="secondary" onClick={slots.reload}>
          {t('auth.retry')}
        </Button>
      </Alert>
    );
  } else if (!gridDay) {
    grid = <Skeleton kind="detail" label={t('common.loading')} />;
  } else if (!inWindow) {
    grid = <p className={common.notice}>{t('owner.walkIn.outsideWindow')}</p>;
  } else {
    grid = <SlotGrid day={gridDay} selected={selected} onToggle={(s) => setSelected((prev) => toggleSlot(gridDay.slots, prev, s))} tone="portal" />;
  }

  return (
    <form
      className={common.form}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <section className={common.card}>
        <Select
          layout="stacked"
          label={t('owner.walkIn.turf')}
          value={turf.id}
          options={turfs.map((x) => ({ value: x.id, label: x.name }))}
          onChange={(e) => change({ turf: e.target.value })}
        />
        <h2 className={common.heading}>{t('owner.walkIn.date')}</h2>
        <DateStrip today={today} value={date} onChange={(d) => change({ date: d })} timeZone={venue.timezone} />
        <h2 className={common.heading}>{t('owner.walkIn.slots')}</h2>
        {grid}
        {addonRes.state.status === 'ready' && (
          <AddonPicker offered={offered} quoteLines={estimate?.addons ?? []} value={addons} onChange={setAddons} currency={currency} />
        )}
      </section>

      <section className={common.card}>
        <h2 className={common.heading}>{t('owner.walkIn.customer')}</h2>
        <CustomerFields value={customer} onChange={setCustomer} tried={tried} />
        <fieldset className={styles.methods}>
          <legend className={common.heading}>{t('owner.walkIn.payment')}</legend>
          {methods.map((m) => (
            <label key={m.key} className={styles.method}>
              <input type="radio" name="payment" value={m.key} checked={method === m.key} onChange={() => setMethod(m.key)} />
              <span>{m.label}</span>
            </label>
          ))}
        </fieldset>
        {method === 'cash' && (
          <TextField
            label={t('owner.walkIn.cashAmount')}
            inputMode="decimal"
            value={cashText ?? (estimate ? forInput(estimate.total, currency) : '')}
            error={tried && !cashOk ? t('owner.walkIn.cashInvalid') : undefined}
            onChange={(e) => setCashText(e.target.value)}
          />
        )}
      </section>

      <section className={common.card} aria-live="polite">
        {estimate && (
          <dl className={styles.estimate}>
            <div className={styles.row}>
              <dt>{t('owner.walkIn.estimateSlots')}</dt>
              <dd>{money(estimate.slotsTotal, currency, lang)}</dd>
            </div>
            {estimate.addons.map((l) => (
              <div key={`${l.addonId}-${l.auto}`} className={styles.row}>
                <dt>{l.pricingType === 'per_unit' ? `${l.name} × ${l.quantity}` : l.name}</dt>
                <dd>{money(l.total, currency, lang)}</dd>
              </div>
            ))}
            <div className={[styles.row, styles.total].join(' ')}>
              <dt>{t('owner.walkIn.estimateTotal')}</dt>
              <dd>{money(estimate.total, currency, lang)}</dd>
            </div>
          </dl>
        )}
        <p className={common.hint}>{t('owner.walkIn.estimate')}</p>
        {error !== null && <Alert tone="danger">{errorMessage(error, t)}</Alert>}
        <Button type="submit" size="lg" loading={submitting} disabled={!inWindow || selected.length === 0 || !rawDay}>
          {t('owner.walkIn.submit')}
        </Button>
      </section>

      <PaymentLinkDialog
        open={link !== null}
        link={link?.link ?? null}
        load={() => Promise.resolve(link!.link)}
        onClose={() => link && navigate(`/owner/${encodeURIComponent(ownerId)}/bookings/${encodeURIComponent(link.bookingId)}`)}
      />
    </form>
  );
}

import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Share, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  currencyExponent,
  formatBdMobile,
  formatMoney,
  isSelectable,
  localParts,
  parseMoney,
  PROVIDER_NAMES,
  runOfLength,
  type SlotDay,
  type SlotJson,
} from '@booking/shared';
import { ApiError, apiGet } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { useTheme } from '../../theme/ThemeProvider';
import { Badge, Button, Chip, Field, Text } from '../../ui';
import { DateStrip } from '../../venue/DateStrip';
import { SlotGrid } from '../../venue/SlotGrid';
import type { CancellationPreview } from '../../bookings/types';
import { ownerPath } from '../labels';
import { useOwner } from '../OwnerProvider';
import { PaymentLinkCard } from '../PaymentLinkCard';
import type { OwnerBooking, OwnerSlotDay, OwnerTurf, PaymentLink, RefundJson } from '../types';
import { dateTime, dayLabel, forInput } from './model';
import { usePost } from './usePost';

export type FormProps = {
  booking: OwnerBooking;
  /** The write went through; `next` is the booking as the API now has it (undefined: reload it). */
  onDone(next?: OwnerBooking): void;
  /** Leave the form without writing. */
  onBack(): void;
};

const REASON_MAX = 300;

/** Money in the booking's currency, in the app language. */
export function useMoney(currency: string) {
  const { i18n } = useTranslation();
  return (n: number) => formatMoney(n, currency, i18n.language);
}

export function useVenueTz(venueId: string) {
  const { venues } = useOwner();
  return venues.find((v) => v.id === venueId)?.timezone ?? 'UTC';
}

const bookingPath = (ownerId: string, id: string, rest = '') => ownerPath(ownerId, `/bookings/${encodeURIComponent(id)}${rest}`);

/** Label on the left, value on the right; wraps for long Russian labels. */
export function Line({ label, value, strong = false, children }: { label: string; value?: string; strong?: boolean; children?: ReactNode }) {
  const { t } = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: t.space2 }}>
      <Text tone={strong ? 'strong' : 'muted'} weight={strong ? 'semibold' : undefined} style={{ flexShrink: 1 }}>
        {label}
      </Text>
      {children ?? (
        <Text tone="strong" weight={strong ? 'semibold' : undefined}>
          {value}
        </Text>
      )}
    </View>
  );
}

export function ErrorLine({ error }: { error: unknown }) {
  const { t: tr } = useTranslation();
  if (error === null || error === undefined) return null;
  return (
    <Text tone="danger" accessibilityRole="alert">
      {errorMessage(error, tr)}
    </Text>
  );
}

function parsed(text: string, currency: string): number | null {
  try {
    const n = parseMoney(text.trim(), currency);
    return n >= 1 ? n : null;
  } catch {
    return null;
  }
}

/** A labelled chip with its state in words for screen readers (selected), not only the border. */
export function LabelChip({ label, selected, onPress }: { label: string; selected: boolean; onPress(): void }) {
  return (
    <Chip selected={selected} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }}>
      <Text variant="label" tone={selected ? 'primary' : 'strong'} weight={selected ? 'semibold' : 'medium'}>
        {label}
      </Text>
    </Chip>
  );
}

/** A selectable code: long-press copies it on both platforms (there is no clipboard module in the app). */
function Code({ value }: { value: string }) {
  return (
    <Text tone="strong" weight="semibold" selectable>
      {value}
    </Text>
  );
}

/** Check a bKash/Nagad/Rocket payment against the venue's own wallet (web VerifyPaymentDialog). */
export function VerifyForm({ booking, onDone, onBack }: FormProps) {
  const { t: tr, i18n } = useTranslation();
  const { t } = useTheme();
  const { ownerId } = useOwner();
  const tz = useVenueTz(booking.venueId);
  const fmt = useMoney(booking.currency);
  const mp = booking.manualPayment;
  const due = mp?.amount ?? 0;
  const [text, setText] = useState(forInput(due, booking.currency));
  const [invalid, setInvalid] = useState(false);
  const [asking, setAsking] = useState(false);
  const { post, busy, error } = usePost(() => onDone());
  if (!mp) return null;
  const received = parsed(text, booking.currency);

  const send = async (segment: 'verify' | 'reject', body: object) => {
    const res = await post<{ booking: OwnerBooking }>(bookingPath(ownerId, booking.id, `/payments/manual/${segment}`), body);
    if (res) onDone(res.booking);
  };
  const verify = () => {
    if (received === null) return setInvalid(true);
    setInvalid(false);
    void send('verify', received === due ? {} : { amountReceived: received });
  };
  const hint =
    booking.status === 'expired'
      ? tr('owner.verify.lateHint')
      : received !== null && received < due
        ? tr('owner.verify.shortfall', { rest: fmt(due - received) })
        : received !== null && received > due
          ? tr('owner.verify.excess', { extra: fmt(received - due) })
          : undefined;

  return (
    <View style={{ gap: t.space3 }}>
      <View style={{ flexDirection: 'row' }}>
        <Badge label={PROVIDER_NAMES[mp.provider]} tone="info" />
      </View>
      <View style={{ gap: t.space2 }}>
        <Line label={tr('owner.verify.trxId')}>
          <Code value={mp.trxId} />
        </Line>
        <Text variant="caption" tone="muted">
          {tr('mobile.owner.booking.holdToCopy')}
        </Text>
        {mp.senderNumber ? <Line label={tr('owner.verify.sentFrom')} value={formatBdMobile(mp.senderNumber)} /> : null}
        <Line label={tr('owner.verify.due')} value={fmt(due)} />
        <Line label={tr('owner.verify.submitted')} value={dateTime(mp.submittedAt, tz, i18n.language)} />
      </View>
      {asking ? (
        <>
          <Text>{tr('owner.verify.notReceivedAsk')}</Text>
          <ErrorLine error={error} />
          <Button label={tr('owner.verify.notReceivedConfirm')} tone="danger" loading={busy} disabled={busy} onPress={() => void send('reject', {})} />
          <Button label={tr('owner.verify.back')} variant="secondary" disabled={busy} onPress={() => setAsking(false)} />
        </>
      ) : (
        <>
          <Field
            label={tr('owner.verify.amountReceived')}
            value={text}
            onChangeText={setText}
            keyboardType="decimal-pad"
            hint={hint}
            error={invalid ? tr('owner.verify.invalid') : undefined}
          />
          <ErrorLine error={error} />
          <Button label={tr('owner.verify.received')} loading={busy} disabled={busy} onPress={verify} />
          <Button label={tr('owner.verify.notReceived')} variant="secondary" tone="danger" disabled={busy} onPress={() => setAsking(true)} />
          <Button label={tr('owner.verify.back')} variant="ghost" disabled={busy} onPress={onBack} />
        </>
      )}
    </View>
  );
}

/** Record cash taken at the desk; empty body means "all that is still due" (web CashDialog). */
export function CashForm({ booking, onDone, onBack }: FormProps) {
  const { t: tr } = useTranslation();
  const { t } = useTheme();
  const { ownerId } = useOwner();
  const fmt = useMoney(booking.currency);
  const remaining = Math.max(0, booking.total - booking.amountPaid);
  const [text, setText] = useState(forInput(remaining, booking.currency));
  const [invalid, setInvalid] = useState(false);
  const { post, busy, error } = usePost(() => onDone());
  const amount = parsed(text, booking.currency);
  const valid = amount !== null && amount <= remaining;
  const unit = 10 ** currencyExponent(booking.currency);
  const quick = [500, 1000].map((n) => n * unit).filter((n) => n < remaining);

  const save = async () => {
    if (!valid) return setInvalid(true);
    setInvalid(false);
    const res = await post<{ booking: OwnerBooking }>(bookingPath(ownerId, booking.id, '/payments/cash'), amount === remaining ? {} : { amount });
    if (res) onDone(res.booking);
  };

  return (
    <View style={{ gap: t.space3 }}>
      <View style={{ gap: t.space2 }}>
        <Line label={tr('owner.bookings.total')} value={fmt(booking.total)} />
        <Line label={tr('owner.bookings.paid')} value={fmt(booking.amountPaid)} />
        <Line label={tr('owner.bookings.due')} value={fmt(remaining)} strong />
      </View>
      <Field
        label={tr('owner.cash.amount')}
        value={text}
        onChangeText={setText}
        keyboardType="decimal-pad"
        error={invalid ? tr('owner.cash.invalid') : undefined}
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space2 }}>
        {quick.map((n) => (
          <LabelChip key={n} label={fmt(n)} selected={amount === n} onPress={() => setText(forInput(n, booking.currency))} />
        ))}
        <LabelChip label={tr('mobile.owner.booking.full')} selected={amount === remaining} onPress={() => setText(forInput(remaining, booking.currency))} />
      </View>
      <ErrorLine error={error} />
      <Button
        label={valid ? tr('mobile.owner.booking.saveCash', { amount: fmt(amount ?? 0) }) : tr('owner.cash.confirm')}
        loading={busy}
        disabled={busy}
        onPress={() => void save()}
      />
      <Button label={tr('owner.cash.back')} variant="ghost" disabled={busy} onPress={onBack} />
    </View>
  );
}

/** Reject a pending booking with an optional reason (web ReasonDialog + reject). */
export function RejectForm({ booking, onDone, onBack }: FormProps) {
  const { t: tr } = useTranslation();
  const { t } = useTheme();
  const { ownerId } = useOwner();
  const [reason, setReason] = useState('');
  const { post, busy, error } = usePost(() => onDone());
  const reject = async () => {
    const r = reason.trim();
    const res = await post<{ booking: OwnerBooking }>(bookingPath(ownerId, booking.id, '/reject'), r ? { reason: r } : {});
    if (res) onDone(res.booking);
  };
  return (
    <View style={{ gap: t.space3 }}>
      <Field label={tr('owner.bookings.reason.label')} value={reason} onChangeText={setReason} maxLength={REASON_MAX} multiline />
      <ErrorLine error={error} />
      <Button label={tr('owner.bookings.reject.confirm')} tone="danger" loading={busy} disabled={busy} onPress={() => void reject()} />
      <Button label={tr('owner.bookings.reason.back')} variant="ghost" disabled={busy} onPress={onBack} />
    </View>
  );
}

const CANCEL_FINAL = new Set(['too_late', 'invalid_transition']);
type Load<T> = { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; error: unknown };

/** Shows the refund first (`GET …/cancellation`), then cancels with an optional reason (web OwnerCancelDialog, staff copy). */
export function CancelForm({ booking, onDone, onBack }: FormProps) {
  const { t: tr } = useTranslation();
  const { t } = useTheme();
  const { ownerId } = useOwner();
  const fmt = useMoney(booking.currency);
  const [load, setLoad] = useState<Load<CancellationPreview>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [reason, setReason] = useState('');
  const { post, busy, error } = usePost(() => onDone());

  useEffect(() => {
    let live = true;
    setLoad({ status: 'loading' });
    apiGet<{ preview: CancellationPreview }>(bookingPath(ownerId, booking.id, '/cancellation')).then(
      (r) => live && setLoad({ status: 'ready', data: r.preview }),
      (e: unknown) => live && setLoad({ status: 'error', error: e }),
    );
    return () => {
      live = false;
    };
  }, [ownerId, booking.id, attempt]);

  const cancel = async () => {
    const r = reason.trim();
    const res = await post<{ booking: OwnerBooking; refunds: RefundJson[] }>(bookingPath(ownerId, booking.id, '/cancel'), r ? { reason: r } : {});
    if (res) onDone(res.booking);
  };
  const final = error instanceof ApiError && CANCEL_FINAL.has(error.code);
  const p = load.status === 'ready' ? load.data : null;
  const paid = p ? p.amountPaid - p.amountRefunded : 0;

  return (
    <View style={{ gap: t.space3 }}>
      {load.status === 'loading' ? <ActivityIndicator color={t.primary} accessibilityLabel={tr('common.loading')} /> : null}
      {load.status === 'error' ? (
        <>
          <ErrorLine error={load.error} />
          <Button label={tr('auth.retry')} variant="secondary" onPress={() => setAttempt((n) => n + 1)} />
        </>
      ) : null}
      {p ? (
        <View style={{ gap: t.space2 }} accessibilityLiveRegion="polite">
          {paid <= 0 ? (
            <Text tone="muted">{tr('cancel.nothingPaid')}</Text>
          ) : (
            <>
              <Line label={tr('cancel.paid')} value={fmt(paid)} />
              <Line label={tr('owner.cancel.refund', { percent: p.percent })} value={fmt(p.amount)} strong />
              {p.rule && p.rule.minHoursBefore !== null ? (
                <Text variant="caption" tone="muted">
                  {tr('cancel.rule', { hours: p.rule.minHoursBefore, percent: p.rule.percent })}
                </Text>
              ) : null}
              {p.amount === 0 ? <Text>{tr('cancel.noRefund')}</Text> : null}
              {p.amount > 0 && p.card > 0 ? <Text>{tr('owner.cancel.toCard', { amount: fmt(p.card) })}</Text> : null}
              {p.amount > 0 && p.wallet > 0 ? <Text>{tr('owner.cancel.toWallet', { amount: fmt(p.wallet) })}</Text> : null}
              {p.amount > 0 && p.cash > 0 ? <Text>{tr('owner.cancel.cashHandBack', { amount: fmt(p.cash) })}</Text> : null}
            </>
          )}
        </View>
      ) : null}
      {p ? <Field label={tr('cancel.reason')} value={reason} onChangeText={setReason} maxLength={REASON_MAX} multiline /> : null}
      <ErrorLine error={error} />
      {p && !final ? <Button label={tr('cancel.confirm')} tone="danger" loading={busy} disabled={busy} onPress={() => void cancel()} /> : null}
      <Button label={tr('cancel.keep')} variant="secondary" disabled={busy} onPress={onBack} />
    </View>
  );
}

const MOVE_FINAL = new Set(['reschedule_not_allowed', 'reschedule_too_late', 'reschedule_limit', 'turf_change_not_allowed', 'invalid_transition', 'too_late']);
const MOVE_STALE = new Set(['slot_taken', 'slot_unavailable', 'outside_window']);

const gridDayOf = (d: OwnerSlotDay): SlotDay => ({
  businessDate: d.businessDate,
  currency: d.currency,
  status: !d.inWindow ? 'outside_window' : d.closed ? 'closed' : 'open',
  slots: d.slots,
});

/** Staff move: any active court of the venue, any day, the same number of slots; price stays (web MoveDialog). */
export function MoveForm({ booking, onDone, onBack }: FormProps) {
  const { t: tr, i18n } = useTranslation();
  const { t } = useTheme();
  const { ownerId } = useOwner();
  const tz = useVenueTz(booking.venueId);
  const venuePath = ownerPath(ownerId, `/venues/${encodeURIComponent(booking.venueId)}`);
  const currentStarts = booking.slots.map((s) => s.startAt).sort();
  const count = currentStarts.length;
  const [turfs, setTurfs] = useState<OwnerTurf[] | null>(null);
  const [turfId, setTurfId] = useState(booking.turfId);
  const [date, setDate] = useState(booking.businessDate);
  const [load, setLoad] = useState<Load<SlotDay>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [noRun, setNoRun] = useState(false);
  const { post, busy, error, setError } = usePost();

  useEffect(() => {
    let live = true;
    apiGet<{ turfs: OwnerTurf[] }>(`${venuePath}/turfs`).then(
      (r) => live && setTurfs(r.turfs.filter((x) => x.active || x.id === booking.turfId)),
      () => live && setTurfs([]),
    );
    return () => {
      live = false;
    };
  }, [venuePath, booking.turfId]);

  useEffect(() => {
    let live = true;
    setLoad({ status: 'loading' });
    apiGet<{ day: OwnerSlotDay }>(`${venuePath}/turfs/${encodeURIComponent(turfId)}/slots?date=${date}`).then(
      (r) => live && setLoad({ status: 'ready', data: gridDayOf(r.day) }),
      (e: unknown) => live && setLoad({ status: 'error', error: e }),
    );
    return () => {
      live = false;
    };
  }, [venuePath, turfId, date, attempt]);

  const own = new Set(turfId === booking.turfId && date === booking.businessDate ? currentStarts : []);
  // The booking's own slots show as booked, but it may move onto them (shift by one slot).
  const day: SlotDay | null =
    load.status === 'ready'
      ? { ...load.data, slots: load.data.slots.map((s) => (own.has(s.startAt) && s.price !== null ? { ...s, status: 'available' as const } : s)) }
      : null;
  const picked: SlotJson[] = day ? day.slots.filter((s) => selected.includes(s.startAt)) : [];
  const ready = picked.length === count;
  const same = ready && picked.every((s) => own.has(s.startAt));
  const final = error instanceof ApiError && MOVE_FINAL.has(error.code);

  const choose = (next: { turfId?: string; date?: string }) => {
    if (next.turfId) setTurfId(next.turfId);
    if (next.date) setDate(next.date);
    setSelected([]);
    setNoRun(false);
    setError(null);
  };
  const onToggle = (startAt: string) => {
    if (!day) return;
    const run = runOfLength(day.slots, startAt, count, isSelectable);
    setNoRun(run === null);
    setSelected(run ? run.map((s) => s.startAt) : []);
  };
  const move = async () => {
    const res = await post<{ booking: OwnerBooking }>(bookingPath(ownerId, booking.id, '/reschedule'), {
      turfId,
      date,
      startAts: picked.map((s) => s.startAt),
    });
    if (res) return onDone(res.booking);
  };
  useEffect(() => {
    if (error instanceof ApiError && MOVE_STALE.has(error.code)) {
      setSelected([]);
      setAttempt((n) => n + 1);
    }
    if (error instanceof ApiError && error.code === 'booking_changed') onDone();
    // Reacts to a new error only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  const turfName = turfs?.find((x) => x.id === turfId)?.name ?? '';
  return (
    <View style={{ gap: t.space3 }}>
      <Text tone="muted">{tr('reschedule.pickHint', { count })}</Text>
      {turfs && turfs.length > 1 ? (
        <View style={{ gap: t.space2 }}>
          <Text variant="label" tone="strong">
            {tr('reschedule.court')}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space2 }}>
            {turfs.map((x) => (
              <LabelChip key={x.id} label={x.name} selected={x.id === turfId} onPress={() => choose({ turfId: x.id })} />
            ))}
          </View>
        </View>
      ) : null}
      <DateStrip today={localParts(new Date(), tz).date} value={date} onChange={(d) => choose({ date: d })} />
      {load.status === 'loading' ? <ActivityIndicator color={t.primary} accessibilityLabel={tr('common.loading')} /> : null}
      {load.status === 'error' ? (
        <>
          <ErrorLine error={load.error} />
          <Button label={tr('auth.retry')} variant="secondary" onPress={() => setAttempt((n) => n + 1)} />
        </>
      ) : null}
      {day ? <SlotGrid day={day} timeZone={tz} selected={selected} onToggle={onToggle} /> : null}
      {noRun ? <Text tone="warning">{tr('reschedule.noRun', { count })}</Text> : null}
      {ready ? (
        <View style={{ gap: t.space1 }} accessibilityLiveRegion="polite">
          <Line label={tr('reschedule.newTime')} value={[turfName, dayLabel(date, tz, i18n.language), `${picked[0]!.localStart}–${picked[picked.length - 1]!.localEnd}`].filter(Boolean).join(' · ')} />
          {same ? <Text tone="warning">{tr('reschedule.sameTime')}</Text> : <Text variant="caption" tone="muted">{tr('reschedule.priceKeptStaff')}</Text>}
        </View>
      ) : null}
      <ErrorLine error={error} />
      {!final ? <Button label={tr('reschedule.confirm')} loading={busy} disabled={busy || !ready || same} onPress={() => void move()} /> : null}
      <Button label={tr('reschedule.back')} variant="ghost" disabled={busy} onPress={onBack} />
    </View>
  );
}

/** Create (or fetch) a pay link for an unpaid walk-in and show it as a QR with Copy and Share. */
export function LinkForm({ booking, onDone, onBack }: FormProps) {
  const { t: tr } = useTranslation();
  const { t } = useTheme();
  const { ownerId } = useOwner();
  const [link, setLink] = useState<PaymentLink | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { post, busy, error } = usePost(() => onDone());
  useEffect(() => {
    let live = true;
    void post<{ payment: PaymentLink }>(bookingPath(ownerId, booking.id, '/payments/link'), {}).then((r) => live && r && setLink(r.payment));
    return () => {
      live = false;
    };
    // `post` is stable; retry bumps `attempt`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId, booking.id, attempt]);
  const fmt = useMoney(link?.currency ?? booking.currency);
  return (
    <View style={{ gap: t.space3 }}>
      {busy && !link ? <ActivityIndicator color={t.primary} accessibilityLabel={tr('common.loading')} /> : null}
      <ErrorLine error={error} />
      {error !== null && !link ? <Button label={tr('auth.retry')} variant="secondary" onPress={() => setAttempt((n) => n + 1)} /> : null}
      {link ? (
        <>
          <Line label={tr('owner.link.amount')} value={fmt(link.amount)} strong />
          <PaymentLinkCard url={link.url} shareLabel={tr('mobile.owner.booking.shareLink')} />
        </>
      ) : null}
      <Button label={tr('owner.link.close')} variant="ghost" onPress={onBack} />
    </View>
  );
}

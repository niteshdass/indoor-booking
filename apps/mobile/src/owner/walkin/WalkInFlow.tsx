import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import {
  addDays,
  formatMoney,
  isSelectable,
  localParts,
  MAX_BOOKINGS_PER_GROUP,
  parseMoney,
  runsOf,
  type AddonSelection,
} from '@booking/shared';
import { AddonPicker } from '../../checkout/AddonPicker';
import { ApiError, apiGet, apiPost } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { useResource } from '../../lib/useResource';
import { useTheme } from '../../theme/ThemeProvider';
import { Badge, Button, Card, Chip, Empty, ErrorState, Field, Icon, Loading, Text } from '../../ui';
import { DateStrip } from '../../venue/DateStrip';
import { SlotGrid } from '../../venue/SlotGrid';
import { ownerHref, ownerPath } from '../labels';
import { useOwner } from '../OwnerProvider';
import type { OwnerBooking, OwnerSlot, OwnerSlotDay, OwnerTurf, OwnerVenue, PaymentLink, WalkInAddon } from '../types';
import { CustomerFields, customerBody, customerErrors, type Customer } from './CustomerFields';
import { PaymentLinkSheet } from './PaymentLinkSheet';
import { cell, combine, gridDayOf, runsFor, withDay, type Picks, type Run } from './picks';
import { walkInEstimate, type WalkInEstimate } from './walkInEstimate';
import { useRetryKey } from '../../lib/useRetryKey';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Errors that mean the slot grid on screen is stale. */
const STALE_CODES = ['slot_taken', 'slot_unavailable', 'outside_window'];
type Method = 'cash' | 'link' | 'unpaid';
/** How many days after the shown one are offered as copy chips. */
const AHEAD = 7;

/** Optional prefill (e.g. from a free gap on Today): `venue`, `turf`, `date`, `start` (slot startAt). */
export type WalkInPrefill = { venue?: string; turf?: string; date?: string; start?: string };

/**
 * Owner walk-in as a full-screen modal: step 1 picks slots on any courts and days, step 2 takes the customer, extras
 * and payment and creates the bookings in one request (same API and rules as apps/web/src/owner/walkin/WalkInPage.tsx).
 */
export function WalkInFlow({ prefill = {} }: { prefill?: WalkInPrefill }) {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const { ownerId, venues, can } = useOwner();
  const [venueId, setVenueId] = useState(() => venues.find((v) => v.id === prefill.venue)?.id ?? venues[0]?.id ?? null);
  const venue = venues.find((v) => v.id === venueId) ?? venues[0] ?? null;

  let body: ReactNode;
  if (!can('booking.create')) body = <Empty>{tr('mobile.owner.walkin.noAccess')}</Empty>;
  else if (!venue) body = <Empty>{tr('owner.today.noVenues')}</Empty>;
  else {
    body = (
      <ActiveTurfs ownerId={ownerId} venue={venue}>
        {(turfs) => (
          <WalkInForm
            key={venue.id}
            venue={venue}
            turfs={turfs}
            prefill={venue.id === (prefill.venue ?? venues[0]?.id) ? prefill : {}}
            venuePicker={
              venues.length > 1 ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space2 }} accessibilityRole="radiogroup" accessibilityLabel={tr('owner.venue')}>
                  {venues.map((v) => {
                    const on = v.id === venue.id;
                    return (
                      <Chip key={v.id} selected={on} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={v.name} onPress={() => setVenueId(v.id)}>
                        <Text variant="label" weight={on ? 'semibold' : 'medium'} tone={on ? 'primary' : 'default'}>
                          {v.name}
                        </Text>
                      </Chip>
                    );
                  })}
                </View>
              ) : null
            }
          />
        )}
      </ActiveTurfs>
    );
  }
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1, backgroundColor: t.bgPage }}>
      {body}
    </SafeAreaView>
  );
}

/** Title row with the modal's own Close (or Back on step 2). */
function Header({ title, onBack }: { title: string; onBack?(): void }) {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space2 }}>
      {onBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tr('mobile.venue.back')}
          onPress={onBack}
          style={({ pressed }) => ({
            minWidth: t.controlLg,
            minHeight: t.controlLg,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: t.radiusFull,
            backgroundColor: pressed ? t.bgHover : 'transparent',
          })}
        >
          <Icon name="arrowLeft" color={t.textStrong} />
        </Pressable>
      ) : null}
      <Text variant="heading" tone="strong" accessibilityRole="header" style={{ flex: 1 }}>
        {title}
      </Text>
      <Button label={tr('common.close')} variant="ghost" onPress={() => router.back()} />
    </View>
  );
}

function ActiveTurfs({ ownerId, venue, children }: { ownerId: string; venue: OwnerVenue; children(turfs: OwnerTurf[]): ReactNode }) {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const res = useResource<{ turfs: OwnerTurf[] }>(ownerPath(ownerId, `/venues/${encodeURIComponent(venue.id)}/turfs`));
  if (res.state.status === 'ready') {
    const active = res.state.data.turfs.filter((x) => x.active);
    if (active.length > 0) return <>{children(active)}</>;
  }
  return (
    <View style={{ padding: t.space4, gap: t.space4 }}>
      <Header title={tr('mobile.owner.shell.newWalkIn')} />
      {res.state.status === 'error' ? (
        <ErrorState error={res.state.error} onRetry={res.reload} />
      ) : res.state.status === 'ready' ? (
        <Empty>{tr('owner.walkIn.noTurfs')}</Empty>
      ) : (
        <Loading />
      )}
    </View>
  );
}

function WalkInForm({ venue, turfs, prefill, venuePicker }: { venue: OwnerVenue; turfs: OwnerTurf[]; prefill: WalkInPrefill; venuePicker: ReactNode }) {
  const { t } = useTheme();
  const { t: tr, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const { ownerId, can } = useOwner();
  const lang = i18n.language;
  const today = localParts(new Date(), venue.timezone).date;
  const [date, setDate] = useState(() => (prefill.date && DATE.test(prefill.date) ? prefill.date : today));
  const [turfId, setTurfId] = useState(() => turfs.find((x) => x.id === prefill.turf)?.id ?? turfs[0]!.id);
  const turf = turfs.find((x) => x.id === turfId) ?? turfs[0]!;
  const [step, setStep] = useState<1 | 2>(1);

  const [picks, setPicks] = useState<Picks>({});
  const [days, setDays] = useState<Record<string, OwnerSlotDay>>({});
  const [offeredBy, setOfferedBy] = useState<Record<string, WalkInAddon[]>>({});
  const [capped, setCapped] = useState(false);
  const [addons, setAddons] = useState<AddonSelection[]>([]);
  const [customer, setCustomer] = useState<Customer>({ name: '', phone: '' });
  const [method, setMethod] = useState<Method>('unpaid');
  const [cashText, setCashText] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [link, setLink] = useState<{ link: PaymentLink; bookingId: string } | null>(null);
  const busy = useRef(false);
  const prefillStart = useRef(prefill.start ?? null);

  const turfPath = useCallback(
    (id: string) => ownerPath(ownerId, `/venues/${encodeURIComponent(venue.id)}/turfs/${encodeURIComponent(id)}`),
    [ownerId, venue.id],
  );
  const base = turfPath(turf.id);
  const slots = useResource<{ day: OwnerSlotDay }>(`${base}/slots?date=${date}`);
  const addonRes = useResource<{ currency: string; addons: WalkInAddon[] }>(`${base}/addons`);
  const rawDay = slots.state.status === 'ready' ? slots.state.data.day : null;
  const offered = addonRes.state.status === 'ready' ? addonRes.state.data.addons : null;
  const here = cell(turf.id, date);

  // The shown day and court's add-ons join the caches the summary and estimate read.
  useEffect(() => {
    if (rawDay) setDays((c) => ({ ...c, [here]: rawDay }));
  }, [rawDay]);
  useEffect(() => {
    if (offered) setOfferedBy((c) => ({ ...c, [turf.id]: offered }));
  }, [offered]);

  // The prefilled start, once.
  useEffect(() => {
    const start = prefillStart.current;
    if (!rawDay || !start) return;
    prefillStart.current = null;
    const slot = rawDay.slots.find((s) => s.startAt === start);
    if (slot && isSelectable(slot)) setPicks((p) => withDay(p, turf.id, date, [start]));
  }, [rawDay]);

  const selected = picks[turf.id]?.[date] ?? [];
  const pickedHere = selected.length > 0;
  const ahead = Array.from({ length: AHEAD }, (_, i) => addDays(date, i + 1));

  // Days with picks on any court (for prices) and, while this day has a pick, the days after it (for the copy chips).
  const wantedKey = [
    ...new Set([
      ...Object.entries(picks).flatMap(([id, p]) => Object.keys(p).map((d) => cell(id, d))),
      ...(pickedHere ? ahead.map((d) => cell(turf.id, d)) : []),
    ]),
  ]
    .filter((c) => c !== here && !days[c])
    .sort()
    .join(',');
  useEffect(() => {
    if (!wantedKey) return;
    let live = true;
    const cells = wantedKey.split(',');
    Promise.all(
      cells.map((c) => {
        const [id, d] = c.split('|') as [string, string];
        return apiGet<{ day: OwnerSlotDay }>(`${turfPath(id)}/slots?date=${d}`).then(
          (r) => r.day,
          () => null,
        );
      }),
    ).then((list) => {
      if (!live) return;
      setDays((c) => {
        const next = { ...c };
        list.forEach((d, i) => {
          if (d) next[cells[i]!] = d;
        });
        return next;
      });
    });
    return () => {
      live = false;
    };
  }, [wantedKey, turfPath]);

  // Add-ons of every picked court, for its share of the estimate.
  const addonKey = Object.keys(picks)
    .filter((id) => id !== turf.id && !offeredBy[id])
    .sort()
    .join(',');
  useEffect(() => {
    if (!addonKey) return;
    let live = true;
    const ids = addonKey.split(',');
    Promise.all(
      ids.map((id) =>
        apiGet<{ addons: WalkInAddon[] }>(`${turfPath(id)}/addons`).then(
          (r) => r.addons,
          () => [],
        ),
      ),
    ).then((list) => live && setOfferedBy((c) => ({ ...c, ...Object.fromEntries(ids.map((id, i) => [id, list[i]!])) })));
    return () => {
      live = false;
    };
  }, [addonKey, turfPath]);

  // Fresh slots: drop picks that are no longer free.
  useEffect(() => {
    setPicks((p) => {
      let changed = false;
      let next = p;
      for (const [id, byDay] of Object.entries(p)) {
        for (const [d, list] of Object.entries(byDay)) {
          const day = days[cell(id, d)];
          const left = day ? list.filter((x) => day.slots.some((s) => s.startAt === x && isSelectable(s))) : list;
          if (left.length === list.length) continue;
          changed = true;
          next = withDay(next, id, d, left);
        }
      }
      return changed ? next : p;
    });
  }, [days]);

  /** Sets one day's picks on one court, unless that would make more bookings than one go takes. */
  const setDay = (court: string, d: string, list: string[]) => {
    const next = withDay(picks, court, d, list);
    if (runsFor(turfs, next, days).length > MAX_BOOKINGS_PER_GROUP) {
      setCapped(true);
      return;
    }
    setCapped(false);
    setPicks(next);
    setError(null);
  };

  const onToggle = (startAt: string) => {
    const slot = rawDay?.slots.find((s) => s.startAt === startAt);
    if (!slot) return;
    if (selected.includes(startAt)) setDay(turf.id, date, selected.filter((x) => x !== startAt));
    else if (isSelectable(slot)) setDay(turf.id, date, [...selected, startAt]);
  };

  const localStarts = rawDay ? rawDay.slots.filter((s) => selected.includes(s.startAt)).map((s) => s.localStart) : [];
  /** Copies this day's times onto `d`, or clears `d` when it already has them. */
  const copyTo = (d: string) => {
    const target = days[cell(turf.id, d)];
    if (!target) return;
    const same = target.slots.filter((s) => localStarts.includes(s.localStart));
    const list = picks[turf.id]?.[d] ?? [];
    const on = list.length === same.length && same.every((s) => list.includes(s.startAt));
    setDay(turf.id, d, on ? [] : same.map((s) => s.startAt));
  };
  const aheadDays = ahead.map((d) => days[cell(turf.id, d)]).filter((d): d is OwnerSlotDay => d !== undefined && d.inWindow);
  const isCopied = (d: OwnerSlotDay) => {
    const list = picks[turf.id]?.[d.businessDate] ?? [];
    const same = d.slots.filter((s) => localStarts.includes(s.localStart));
    return same.length === localStarts.length && list.length === same.length && same.every((s) => list.includes(s.startAt));
  };
  /** The picked times are all free on `d` (web RepeatDays `priceOn`). */
  const freeOn = (d: OwnerSlotDay) =>
    !d.closed && localStarts.length > 0 && localStarts.every((time) => d.slots.some((s) => s.localStart === time && isSelectable(s)));

  const runs = runsFor(turfs, picks, days);
  const slotCount = Object.values(picks).reduce((n, byDay) => n + Object.values(byDay).reduce((m, l) => m + l.length, 0), 0);
  const pickedTurfs = [...new Set(runs.map((r) => r.turfId))];
  const ready = runs.length > 0 && runs.reduce((n, r) => n + r.slots.length, 0) === slotCount && pickedTurfs.every((id) => offeredBy[id]);
  /** The add-ons of the pick that `turfId` offers; one pick of add-ons spans courts that may not all have them. */
  const selectionOn = (id: string) => addons.filter((s) => (offeredBy[id] ?? []).some((o) => o.id === s.addonId && o.autoApply === null));
  const estimates = ready
    ? runs.map((r) =>
        walkInEstimate({ slots: r.slots, offered: offeredBy[r.turfId]!, indoor: turfs.find((x) => x.id === r.turfId)!.indoor, selection: selectionOn(r.turfId) }),
      )
    : [];
  const estimate = estimates.length > 0 && estimates.every((e) => e !== null) ? combine(estimates as WalkInEstimate[]) : null;
  const single = runs.length === 1;

  const change = (next: { turf?: string; date?: string }) => {
    if (next.turf) setTurfId(next.turf);
    if (next.date) setDate(next.date);
    prefillStart.current = null;
    setCapped(false);
    setError(null);
  };

  const currency = rawDay?.currency ?? venue.currency;
  const inWindow = rawDay?.inWindow ?? true;
  let cashAmount: number | undefined;
  let cashOk = true;
  if (method === 'cash' && single && cashText !== null) {
    try {
      cashAmount = parseMoney(cashText.trim(), currency);
      cashOk = cashAmount >= 1;
    } catch {
      cashOk = false;
    }
  }

  const retry = useRetryKey();
  const submit = async () => {
    if (busy.current || !ready) return;
    setTried(true);
    const bad = customerErrors(customer);
    if (bad.name || bad.phone || !cashOk) return;
    busy.current = true;
    setSubmitting(true);
    setError(null);
    const payment =
      method === 'cash' ? (cashAmount === undefined ? { method: 'cash' as const } : { method: 'cash' as const, amount: cashAmount }) : { method };
    const [first, ...more] = runs as [Run, ...Run[]];
    const sent = addons.filter((s) => pickedTurfs.some((id) => selectionOn(id).includes(s)));
    try {
      const path = `${turfPath(first.turfId)}/bookings`;
      const body = {
        date: first.date,
        startAts: first.slots.map((s) => s.startAt),
        addons: sent,
        ...(more.length > 0 ? { more: more.map((r) => ({ turfId: r.turfId, date: r.date, startAts: r.slots.map((s) => s.startAt) })) } : {}),
        customer: customerBody(customer),
        payment,
      };
      const res = await apiPost<{ booking: OwnerBooking; bookings?: OwnerBooking[]; payment?: PaymentLink }>(path, body, {
        'Idempotency-Key': retry.keyFor(`${path} ${JSON.stringify(body)}`),
      });
      retry.done();
      // The booking screen shows the others booked with it.
      if (res.payment) setLink({ link: res.payment, bookingId: res.booking.id });
      else router.replace(ownerHref(ownerId, `/booking/${encodeURIComponent(res.booking.id)}`));
    } catch (e) {
      setError(e);
      if (e instanceof ApiError && STALE_CODES.includes(e.code)) {
        // Every picked day may be stale: refetch them all, the shown one through its resource, and go back to the grid.
        setDays((c) => (c[here] ? { [here]: c[here] } : {}));
        slots.reload();
        setStep(1);
      }
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  };

  const methods: { key: Method; label: string }[] = [
    ...(can('payment.mark_cash') ? [{ key: 'cash' as const, label: tr('owner.walkIn.cash') }] : []),
    { key: 'link', label: tr('owner.walkIn.link') },
    { key: 'unpaid', label: tr('owner.walkIn.unpaid') },
  ];

  const shortDate = (d: string) =>
    new Intl.DateTimeFormat(lang, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));
  const range = (run: OwnerSlot[]) => `${run[0]!.localStart}–${run[run.length - 1]!.localEnd}`;
  /** Every court and day with picks, courts in card order. */
  const picked = turfs.flatMap(({ id, name }) =>
    Object.keys(picks[id] ?? {})
      .sort()
      .map((d) => ({ turfId: id, name, date: d })),
  );
  const errorBox = error !== null ? (
    <Text tone="danger" accessibilityRole="alert">
      {errorMessage(error, tr)}
    </Text>
  ) : null;

  let grid: ReactNode;
  if (slots.state.status === 'error') grid = <ErrorState error={slots.state.error} onRetry={slots.reload} />;
  else if (!rawDay) grid = <Loading />;
  else if (!inWindow) grid = <Text tone="muted">{tr('owner.walkIn.outsideWindow')}</Text>;
  else grid = <SlotGrid day={gridDayOf(rawDay)} timeZone={venue.timezone} selected={selected} onToggle={onToggle} />;

  const stepOne = (
    <>
      <Header title={tr('mobile.owner.shell.newWalkIn')} />
      {venuePicker}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space2 }} accessibilityRole="radiogroup" accessibilityLabel={tr('owner.walkIn.courts')}>
        {turfs.map((x) => {
          const on = x.id === turf.id;
          const count = Object.values(picks[x.id] ?? {}).reduce((n, l) => n + l.length, 0);
          const kind = [tr(x.indoor ? 'venue.indoor' : 'venue.outdoor'), ...x.sports.map((s) => tr(`sports.${s}`)), tr('venue.slotLength', { count: x.slotLengthMin })].join(' · ');
          return (
            <Pressable
              key={x.id}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={[x.name, kind, count > 0 ? tr('slots.picked', { count }) : null].filter(Boolean).join(', ')}
              onPress={() => change({ turf: x.id })}
              style={({ pressed }) => ({
                flexGrow: 1,
                minHeight: t.controlLg,
                flexDirection: 'row',
                alignItems: 'center',
                gap: t.space2,
                paddingHorizontal: t.space3,
                paddingVertical: t.space2,
                borderRadius: t.radiusMd,
                borderWidth: t.focusWidth,
                borderColor: on ? t.primary : 'transparent',
                backgroundColor: on ? t.primarySoft : pressed ? t.bgHover : t.bgSurface,
              })}
            >
              <View style={{ flexShrink: 1 }}>
                <Text weight="semibold" tone={on ? 'primary' : 'strong'}>
                  {x.name}
                </Text>
                <Text variant="caption" tone="muted">
                  {kind}
                </Text>
              </View>
              {count > 0 ? <Badge label={String(count)} tone="info" /> : null}
            </Pressable>
          );
        })}
      </View>
      <DateStrip today={today} value={date} onChange={(d) => change({ date: d })} />
      {grid}
      {capped ? (
        <Text tone="warning" accessibilityRole="alert">
          {tr('slots.full', { count: MAX_BOOKINGS_PER_GROUP })}
        </Text>
      ) : null}
      {rawDay && inWindow && pickedHere && aheadDays.length > 0 ? (
        <View style={{ gap: t.space2 }}>
          <Text variant="label" tone="muted" accessibilityRole="header">
            {tr('slots.repeat')}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space2 }}>
            {aheadDays.map((d) => {
              const on = isCopied(d);
              const free = freeOn(d);
              const full = runs.length + runsOf(rawDay.slots, selected).length > MAX_BOOKINGS_PER_GROUP;
              const off = !free || (full && !on);
              const label = shortDate(d.businessDate);
              return (
                <Chip
                  key={d.businessDate}
                  selected={on}
                  disabled={off}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on, disabled: off }}
                  accessibilityLabel={free ? label : `${label}, ${tr('slots.repeatNotFree')}`}
                  onPress={() => copyTo(d.businessDate)}
                >
                  <Text
                    variant="label"
                    weight={on ? 'semibold' : 'medium'}
                    tone={on ? 'primary' : off ? 'subtle' : 'default'}
                    style={{ textDecorationLine: free ? 'none' : 'line-through' }}
                  >
                    {on ? `✓ ${label}` : `+ ${label}`}
                  </Text>
                </Chip>
              );
            })}
          </View>
        </View>
      ) : null}
      <View style={{ gap: t.space2 }}>
        <Text variant="label" tone="muted" accessibilityRole="header">
          {tr('owner.walkIn.selection')}
        </Text>
        {picked.length === 0 ? (
          <Text variant="label" tone="muted">
            {tr('owner.walkIn.pickHint')}
          </Text>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space2 }}>
            {picked.map((p) => {
              const cached = days[cell(p.turfId, p.date)];
              const times = cached ? runsOf(cached.slots, picks[p.turfId]![p.date]!).map(range).join(', ') : '';
              const label = `${p.name} · ${shortDate(p.date)}`;
              const isHere = p.turfId === turf.id && p.date === date;
              return (
                <View
                  key={cell(p.turfId, p.date)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    borderRadius: t.radiusFull,
                    borderWidth: t.focusWidth,
                    borderColor: isHere ? t.primary : 'transparent',
                    backgroundColor: t.primarySoft,
                  }}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={tr('slots.showDay', { date: `${label} ${times}` })}
                    onPress={() => change({ turf: p.turfId, date: p.date })}
                    style={{ minHeight: t.controlLg, justifyContent: 'center', paddingLeft: t.space3, flexShrink: 1 }}
                  >
                    <Text variant="label" weight="medium" tone="primary">
                      {times ? `${label} ${times}` : label}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={tr('slots.clearDay', { date: label })}
                    onPress={() => setDay(p.turfId, p.date, [])}
                    style={{ minWidth: t.controlLg, minHeight: t.controlLg, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Icon name="close" color={t.primary} size={t.iconSm} />
                  </Pressable>
                </View>
              );
            })}
          </View>
        )}
      </View>
      {errorBox}
    </>
  );

  const extras = offered ? offered.filter((a) => a.autoApply === null) : [];
  const stepTwo = (
    <>
      <Header title={tr('mobile.owner.walkin.whoPlaying')} onBack={() => setStep(1)} />
      <CustomerFields value={customer} onChange={setCustomer} tried={tried} />
      {extras.length > 0 ? (
        <Card style={{ gap: t.space2 }}>
          <Text variant="label" weight="semibold" tone="strong" accessibilityRole="header">
            {tr('checkout.addons')}
          </Text>
          <AddonPicker addons={extras} currency={currency} value={addons} onChange={setAddons} disabled={submitting} />
          {runs.length > 1 ? (
            <Text variant="caption" tone="muted">
              {tr('owner.walkIn.extrasEach')}
            </Text>
          ) : null}
        </Card>
      ) : null}
      <View style={{ gap: t.space2 }} accessibilityRole="radiogroup" accessibilityLabel={tr('owner.walkIn.payment')}>
        <Text variant="label" weight="semibold" tone="strong" accessibilityRole="header">
          {tr('owner.walkIn.payment')}
        </Text>
        {methods.map((m) => {
          const on = method === m.key;
          return (
            <Pressable
              key={m.key}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={m.label}
              onPress={() => setMethod(m.key)}
              style={{
                minHeight: t.controlLg,
                flexDirection: 'row',
                alignItems: 'center',
                gap: t.space3,
                paddingHorizontal: t.space3,
                paddingVertical: t.space2,
                borderRadius: t.radiusMd,
                borderWidth: t.focusWidth,
                borderColor: on ? t.primary : 'transparent',
                backgroundColor: on ? t.primarySoft : t.bgSurface,
              }}
            >
              <View
                style={{
                  width: t.iconMd,
                  height: t.iconMd,
                  borderRadius: t.radiusFull,
                  borderWidth: t.focusWidth,
                  borderColor: on ? t.primary : t.borderStrong,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {on ? <View style={{ width: t.space2, height: t.space2, borderRadius: t.radiusFull, backgroundColor: t.primary }} /> : null}
              </View>
              <Text tone="strong" style={{ flex: 1 }}>
                {m.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {method === 'cash' && single ? (
        <Field
          label={tr('owner.walkIn.cashAmount')}
          keyboardType="decimal-pad"
          value={cashText ?? (estimate ? (estimate.total / 100).toFixed(2).replace(/\.00$/, '') : '')}
          error={tried && !cashOk ? tr('owner.walkIn.cashInvalid') : undefined}
          onChangeText={setCashText}
        />
      ) : null}
      {method !== 'unpaid' && runs.length > 1 ? (
        <Text variant="label" tone="muted">
          {tr('owner.walkIn.wholeEach')}
        </Text>
      ) : null}
      {estimate ? (
        <Card style={{ gap: t.space2 }}>
          <Line
            label={runs.length > 1 ? `${tr('owner.walkIn.estimateSlots')} · ${tr('owner.walkIn.bookingCount', { count: runs.length })}` : tr('owner.walkIn.estimateSlots')}
            value={formatMoney(estimate.slotsTotal, currency, lang)}
          />
          {estimate.addons.map((l) => (
            <Line key={`${l.addonId}-${l.auto}`} label={l.pricingType === 'per_unit' ? `${l.name} × ${l.quantity}` : l.name} value={formatMoney(l.total, currency, lang)} />
          ))}
          <View style={{ height: t.hairline, backgroundColor: t.borderSubtle }} />
          <Line label={tr('owner.walkIn.estimateTotal')} value={formatMoney(estimate.total, currency, lang)} strong />
        </Card>
      ) : null}
      <Text variant="caption" tone="muted">
        {tr('owner.walkIn.estimate')}
      </Text>
      {errorBox}
    </>
  );

  const footerLead =
    step === 1
      ? runs.length > 0
        ? `${tr('owner.walkIn.bookingCount', { count: runs.length })} · ${tr('slots.selectedCount', { count: slotCount })}`
        : tr('slots.pickHint')
      : tr('owner.walkIn.estimate');

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: t.space4, gap: t.space4 }} keyboardShouldPersistTaps="handled">
        {step === 1 ? stepOne : stepTwo}
      </ScrollView>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: t.space3,
          paddingHorizontal: t.space4,
          paddingTop: t.space3,
          paddingBottom: t.space3 + insets.bottom,
          borderTopWidth: t.hairline,
          borderTopColor: t.borderSubtle,
          backgroundColor: t.bgSurfaceRaised,
        }}
      >
        <View style={{ flex: 1 }}>
          <Text variant="caption" tone="muted">
            {footerLead}
          </Text>
          {estimate ? (
            <Text variant="title" tone="strong" style={{ fontVariant: ['tabular-nums'] }}>
              {formatMoney(estimate.total, currency, lang)}
            </Text>
          ) : null}
        </View>
        {step === 1 ? (
          <Button label={tr('slots.continue')} disabled={!ready} onPress={() => setStep(2)} />
        ) : (
          <Button
            label={runs.length > 1 ? tr('owner.walkIn.submitMany', { count: runs.length }) : tr('owner.walkIn.submit')}
            loading={submitting}
            disabled={!ready}
            onPress={() => void submit()}
          />
        )}
      </View>
      <PaymentLinkSheet
        link={link?.link ?? null}
        name={customer.name.trim()}
        onOpenBooking={() => link && router.replace(ownerHref(ownerId, `/booking/${encodeURIComponent(link.bookingId)}`))}
        onDone={() => router.back()}
      />
    </KeyboardAvoidingView>
  );
}

function Line({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  const { t } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: t.space3 }}>
      <Text variant={strong ? 'body' : 'label'} weight={strong ? 'semibold' : 'regular'} tone={strong ? 'strong' : 'muted'} style={{ flex: 1 }}>
        {label}
      </Text>
      <Text variant={strong ? 'body' : 'label'} weight={strong ? 'semibold' : 'regular'} tone={strong ? 'strong' : 'default'} style={{ fontVariant: ['tabular-nums'] }}>
        {value}
      </Text>
    </View>
  );
}

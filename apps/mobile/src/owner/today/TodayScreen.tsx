import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { formatMoney, localParts } from '@booking/shared';
import { usePoll } from '../../lib/usePoll';
import { useRefocus } from '../../lib/useRefocus';
import { useTheme } from '../../theme/ThemeProvider';
import { Badge, Button, Card, Empty, ErrorState, Group, Icon, Loading, Row, Screen, Segmented, Sheet, Text } from '../../ui';
import { StatusBadge } from '../../bookings/StatusBadge';
import { DateStrip } from '../../venue/DateStrip';
import { BookingQuickSheet, useRunner } from '../booking/actions';
import { LabelChip } from '../booking/forms';
import { availableActions, awaitsVerification, dayLabel, hm, timeRange, type Action } from '../booking/model';
import { customerLabel, ownerHref } from '../labels';
import { useOwner } from '../OwnerProvider';
import { TeamSwitcher } from '../TeamSwitcher';
import type { OwnerBooking, OwnerVenue } from '../types';
import { buildAttention, type AttentionItem } from './attention';
import { courtUsage, dueOf, scheduleRows, summarize, type Courts, type ScheduleRow } from './model';
import { useScheduleDay, useToday } from './useToday';

type View_ = 'summary' | 'schedule';
/** Which booking the quick sheet shows, and optionally the action form it opens on. */
type Open = { id: string; start?: Action } | null;

/** Owner Today tab: header with team and venue, then Summary (stats, needs you, coming up) or Schedule (one court's day). */
export function TodayScreen() {
  const { t: tr } = useTranslation();
  const { t } = useTheme();
  const { owner, venues, can } = useOwner();
  const [switcher, setSwitcher] = useState(false);
  const [venueId, setVenueId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const venue = venues.find((v) => v.id === venueId) ?? venues[0] ?? null;

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space2, flexWrap: 'wrap' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${owner.name}, ${tr('owner.switcher')}`}
          onPress={() => setSwitcher(true)}
          style={{ flex: 1, minHeight: t.controlLg, flexDirection: 'row', alignItems: 'center', gap: t.space1 }}
        >
          <Text variant="heading" tone="strong" accessibilityRole="header" style={{ flexShrink: 1 }}>
            {owner.name}
          </Text>
          <Icon name="chevronDown" color={t.textMuted} size={t.iconSm} />
        </Pressable>
        {venue && venues.length > 1 && can('booking.view') ? (
          <LabelChip label={venue.name} selected={false} onPress={() => setPicking(true)} />
        ) : null}
      </View>
      {/* Everything on Today is bookings, which the API only shows to booking.view (the web hides Today too). */}
      {!can('booking.view') ? (
        <Text tone="muted">{tr('mobile.owner.today.noAccess')}</Text>
      ) : venue ? (
        <TodayVenue key={venue.id} venue={venue} />
      ) : (
        <Empty>{tr('owner.today.noVenues')}</Empty>
      )}
      <TeamSwitcher visible={switcher} onClose={() => setSwitcher(false)} />
      <Sheet visible={picking} onClose={() => setPicking(false)} title={tr('owner.venue')}>
        <Group>
          {venues.map((v) => (
            <Row
              key={v.id}
              title={v.name}
              detail={v.city}
              right={v.id === venue?.id ? <Icon name="check" color={t.primary} /> : undefined}
              onPress={() => {
                setVenueId(v.id);
                setPicking(false);
              }}
            />
          ))}
        </Group>
      </Sheet>
    </Screen>
  );
}

function TodayVenue({ venue }: { venue: OwnerVenue }) {
  const { t: tr, i18n } = useTranslation();
  const { t } = useTheme();
  const { ownerId, can } = useOwner();
  const data = useToday(ownerId, venue, can('payment.verify'));
  const [view, setView] = useState<View_>('summary');
  const [date, setDate] = useState(data.today);
  const [open, setOpen] = useState<Open>(null);
  const [pulling, setPulling] = useState(false);
  const day = useScheduleDay(ownerId, venue, date, data.today);
  const { refresh } = data;
  const { reload: reloadDay } = day.bookings;
  const { reloadCourts: reloadDayCourts } = day;
  const refreshAll = useCallback(() => {
    refresh();
    if (date !== data.today) {
      reloadDay();
      reloadDayCourts();
    }
  }, [refresh, reloadDay, reloadDayCourts, date, data.today]);
  usePoll(refreshAll);
  // Back from a booking or another tab: show what changed there.
  useRefocus(refreshAll);

  const state = data.bookings.state;
  const all = state.status === 'ready' ? state.data.bookings : [];
  const dayBookings = date === data.today ? all : day.bookings.state.status === 'ready' ? day.bookings.state.data.bookings : [];
  const opened = open ? ([...all, ...dayBookings].find((b) => b.id === open.id) ?? null) : null;
  const updated = data.bookings.updatedAt;

  const onChanged = (next?: OwnerBooking) => {
    if (next && state.status === 'ready') {
      data.bookings.set({ bookings: state.data.bookings.map((b) => (b.id === next.id ? next : b)) });
    }
    refreshAll();
  };
  const pull = () => {
    setPulling(true);
    refreshAll();
    // The resources keep their data while reloading; the spinner only acknowledges the gesture.
    setTimeout(() => setPulling(false), 600);
  };

  return (
    <View style={{ flex: 1, gap: t.space3 }}>
      <Text variant="label" tone="muted" accessibilityLiveRegion="polite">
        {[
          dayLabel(data.today, venue.timezone, i18n.language),
          updated !== null ? tr('owner.today.updated', { time: hm(new Date(updated).toISOString(), venue.timezone) }) : null,
          data.bookings.refreshError ? tr('owner.today.refreshFailed') : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </Text>
      <Segmented<View_>
        label={tr('mobile.owner.today.view')}
        value={view}
        onChange={setView}
        options={[
          { value: 'summary', label: tr('mobile.owner.today.summary') },
          { value: 'schedule', label: tr('mobile.owner.today.schedule') },
        ]}
      />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: t.space4, paddingBottom: t.space8 }}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={pull} tintColor={t.primary} colors={[t.primary]} progressBackgroundColor={t.bgSurfaceRaised} />}
      >
        {state.status === 'error' ? <ErrorState error={state.error} onRetry={refreshAll} /> : null}
        {state.status === 'loading' || state.status === 'idle' ? <Loading /> : null}
        {state.status === 'ready' && view === 'summary' ? (
          <Summary venue={venue} bookings={all} data={data} onOpen={setOpen} onChanged={onChanged} />
        ) : null}
        {state.status === 'ready' && view === 'schedule' ? (
          <Schedule
            venue={venue}
            today={data.today}
            date={date}
            onDate={setDate}
            bookings={dayBookings}
            loading={date !== data.today && day.bookings.state.status !== 'ready'}
            courts={date === data.today ? data.courts : day.courts}
            onOpen={setOpen}
          />
        ) : null}
      </ScrollView>
      {opened ? (
        <BookingQuickSheet booking={opened} visible onClose={() => setOpen(null)} onChanged={onChanged} start={open?.start} />
      ) : null}
    </View>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'danger' | 'success' }) {
  const { t } = useTheme();
  return (
    <Card style={{ flexGrow: 1, flexBasis: '45%', gap: t.space1 }} accessible accessibilityLabel={[label, value, hint].filter(Boolean).join(', ')}>
      <Text variant="label" tone="muted">
        {label}
      </Text>
      <Text variant="title" tone="strong">
        {value}
      </Text>
      {hint ? (
        <Text variant="caption" tone={tone ?? 'muted'}>
          {hint}
        </Text>
      ) : null}
    </Card>
  );
}

function Summary({
  venue,
  bookings,
  data,
  onOpen,
  onChanged,
}: {
  venue: OwnerVenue;
  bookings: OwnerBooking[];
  data: ReturnType<typeof useToday>;
  onOpen(o: Open): void;
  onChanged(next?: OwnerBooking): void;
}) {
  const { t: tr, i18n } = useTranslation();
  const { t } = useTheme();
  const { can } = useOwner();
  const lang = i18n.language;
  const now = Date.now();
  const { count, collected, due, pending, upcoming } = summarize(bookings, now);
  const usage = courtUsage(bookings, data.courts, venue.timezone);
  const money = (n: number) => formatMoney(n, venue.currency, lang);
  const hours = new Intl.NumberFormat(lang, { maximumFractionDigits: 1 });
  const pct = new Intl.NumberFormat(lang, { style: 'percent', maximumFractionDigits: 0 });
  const items = buildAttention({ venue, bookings, toVerifyAll: data.toVerify, requests: data.requests, refunds: data.refunds, tr, lang, now });

  return (
    <>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space2 }}>
        <Stat
          label={tr('owner.today.bookings')}
          value={String(count)}
          hint={data.lastWeek ? tr('owner.today.lastWeek', { n: summarize(data.lastWeek).count }) : undefined}
        />
        <Stat label={tr('owner.today.collected')} value={money(collected)} />
        <Stat
          label={tr('owner.today.dueAtDesk')}
          value={money(due.amount)}
          tone={due.overdue > 0 ? 'danger' : undefined}
          hint={
            due.owing === 0
              ? tr('owner.today.dueNone')
              : due.overdue > 0
                ? tr('owner.today.dueOverdue', { count: due.overdue })
                : tr('owner.today.dueFrom', { count: due.owing })
          }
        />
        {usage ? (
          <Stat
            label={tr('owner.today.courtsUsed')}
            value={pct.format(usage.booked / usage.open)}
            hint={tr('owner.today.courtsUsedHint', { booked: hours.format(usage.booked), open: hours.format(usage.open) })}
          />
        ) : null}
        {can('booking.confirm') ? (
          <Stat label={tr('owner.today.pending')} value={String(pending)} hint={pending === 0 ? tr('owner.today.caughtUp') : undefined} />
        ) : null}
      </View>

      {items.length > 0 ? <Attention items={items} onOpen={onOpen} onChanged={onChanged} /> : null}

      <View style={{ gap: t.space2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space2 }}>
          <Text variant="title" tone="strong" accessibilityRole="header" style={{ flex: 1 }}>
            {tr('owner.today.upcoming')}
          </Text>
        </View>
        {upcoming.length === 0 ? (
          <Empty>{tr('owner.today.none')}</Empty>
        ) : (
          <Group>
            {upcoming.map((b) => (
              <Row
                key={b.id}
                left={
                  <Text tone="strong" weight="semibold" style={{ minWidth: t.scheduleTimeCol }}>
                    {hm(b.slots[0]?.startAt ?? b.createdAt, venue.timezone)}
                  </Text>
                }
                title={customerLabel(b, tr)}
                detail={[b.turf?.name, timeRange(b, venue.timezone)].filter(Boolean).join(' · ')}
                right={<StatusBadge status={b.status} toVerify={awaitsVerification(b)} />}
                onPress={() => onOpen({ id: b.id })}
              />
            ))}
          </Group>
        )}
      </View>
    </>
  );
}

const STATUS_ACTIONS = new Set<Action>(['confirm', 'checkIn', 'noShow']);

function Attention({ items, onOpen, onChanged }: { items: AttentionItem[]; onOpen(o: Open): void; onChanged(next?: OwnerBooking): void }) {
  const { t: tr } = useTranslation();
  const { t } = useTheme();
  return (
    <View style={{ gap: t.space2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space2 }}>
        <Text variant="title" tone="strong" accessibilityRole="header" style={{ flexShrink: 1 }}>
          {tr('owner.today.attention')}
        </Text>
        <Badge label={String(items.length)} tone="warning" />
      </View>
      <Card style={{ padding: 0, gap: 0, overflow: 'hidden' }}>
        {items.map((it, i) => (
          <AttentionRow key={it.key} item={it} first={i === 0} onOpen={onOpen} onChanged={onChanged} />
        ))}
      </Card>
    </View>
  );
}

function AttentionRow({ item, first, onOpen, onChanged }: { item: AttentionItem; first: boolean; onOpen(o: Open): void; onChanged(next?: OwnerBooking): void }) {
  const { t: tr } = useTranslation();
  const { t } = useTheme();
  const { ownerId, can } = useOwner();
  const b = item.booking;
  const acts = b ? availableActions(b, can) : [];
  const primary = item.primary && acts.includes(item.primary) ? item.primary : null;
  // A placeholder booking keeps the hook order stable for rows without one.
  const runner = useRunner(b ?? PLACEHOLDER, onChanged, (a) => b && onOpen({ id: b.id, start: a }));
  const bar = item.tone === 'danger' ? t.danger : item.tone === 'info' ? t.info : t.warning;
  const open = () => {
    if (b) onOpen({ id: b.id });
    else if (item.href) router.push(ownerHref(ownerId, item.href));
  };
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.space3,
        paddingVertical: t.space3,
        paddingRight: t.space4,
        borderTopWidth: first ? 0 : t.hairline,
        borderTopColor: t.borderSubtle,
      }}
    >
      <View style={{ alignSelf: 'stretch', width: t.statusBar, backgroundColor: bar }} />
      <Pressable accessibilityRole="button" accessibilityLabel={[item.title, item.detail].filter(Boolean).join(', ')} onPress={open} style={{ flex: 1, minHeight: t.controlLg, justifyContent: 'center', gap: t.space1 / 2 }}>
        <Text tone="strong">{item.title}</Text>
        {item.detail ? (
          <Text variant="caption" tone="muted">
            {item.detail}
          </Text>
        ) : null}
        {runner.error ? (
          <Text variant="caption" tone="danger" accessibilityRole="alert">
            {tr('errors.generic')}
          </Text>
        ) : null}
      </Pressable>
      {primary && b ? (
        <Button
          label={tr(`owner.bookings.actions.${primary}`)}
          variant="secondary"
          loading={runner.busy}
          disabled={runner.busy}
          onPress={() => (STATUS_ACTIONS.has(primary) ? void runner.run(primary) : onOpen({ id: b.id, start: primary }))}
        />
      ) : (
        <Button label={tr('owner.today.open')} variant="ghost" onPress={open} accessibilityLabel={`${tr('owner.today.open')}: ${item.title}`} />
      )}
    </View>
  );
}

const PLACEHOLDER = { id: '', slots: [] } as unknown as OwnerBooking;

function Schedule({
  venue,
  today,
  date,
  onDate,
  bookings,
  loading,
  courts,
  onOpen,
}: {
  venue: OwnerVenue;
  today: string;
  date: string;
  onDate(d: string): void;
  bookings: OwnerBooking[];
  loading: boolean;
  courts: Courts | null;
  onOpen(o: Open): void;
}) {
  const { t: tr, i18n } = useTranslation();
  const { t } = useTheme();
  const { ownerId, can } = useOwner();
  const [turfId, setTurfId] = useState<string | null>(null);
  const turfs = courts?.turfs ?? [];
  const turf = turfs.find((x) => x.id === turfId) ?? turfs[0] ?? null;
  const now = Date.now();
  const rows = turf && courts ? scheduleRows(courts.days[turf.id], bookings.filter((b) => b.turfId === turf.id), venue.timezone, date === today ? now : -Infinity) : [];
  const nowAt = date === today ? rows.findIndex((r) => r.startMs > now) : -1;
  const money = (n: number) => formatMoney(n, venue.currency, i18n.language);
  const walkIn = (row: Extract<ScheduleRow, { kind: 'free' }>) => {
    if (!turf) return;
    const q = new URLSearchParams({ venue: venue.id, turf: turf.id, date: localParts(new Date(row.startAt), venue.timezone).date, start: row.startAt });
    router.push(ownerHref(ownerId, `/walkin?${q.toString()}`));
  };

  return (
    <View style={{ gap: t.space3 }}>
      <DateStrip today={today} value={date} onChange={onDate} days={7} />
      {turfs.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space2 }} accessibilityLabel={tr('owner.today.courts')}>
          {turfs.map((x) => (
            <LabelChip key={x.id} label={x.name} selected={x.id === turf?.id} onPress={() => setTurfId(x.id)} />
          ))}
        </ScrollView>
      ) : null}
      {loading || courts === null ? <Loading /> : null}
      {!loading && courts !== null && turfs.length === 0 ? <Empty>{tr('mobile.owner.today.noCourts')}</Empty> : null}
      {!loading && turf && rows.length === 0 ? <Empty>{tr('owner.today.none')}</Empty> : null}
      {!loading && turf
        ? rows.map((row, i) => (
            <View key={row.key} style={{ gap: t.space2 }}>
              {i === nowAt ? <NowLine time={hm(new Date(now).toISOString(), venue.timezone)} /> : null}
              <ScheduleItem
                row={row}
                court={turf.name}
                money={money}
                onBooking={(b) => onOpen({ id: b.id })}
                onFree={can('booking.create') ? walkIn : undefined}
              />
            </View>
          ))
        : null}
      {!loading && turf && nowAt === -1 && date === today && rows.length > 0 ? <NowLine time={hm(new Date(now).toISOString(), venue.timezone)} /> : null}
    </View>
  );
}

function NowLine({ time }: { time: string }) {
  const { t: tr } = useTranslation();
  const { t } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space2 }} accessible accessibilityLabel={tr('mobile.owner.today.nowAt', { time })}>
      <Text variant="caption" tone="danger" weight="semibold" style={{ width: t.scheduleTimeCol }}>
        {time}
      </Text>
      <View style={{ flex: 1, height: t.nowLine, backgroundColor: t.danger, borderRadius: t.radiusFull }} />
    </View>
  );
}

function ScheduleItem({
  row,
  court,
  money,
  onBooking,
  onFree,
}: {
  row: ScheduleRow;
  court: string;
  money(n: number): string;
  onBooking(b: OwnerBooking): void;
  onFree?(row: Extract<ScheduleRow, { kind: 'free' }>): void;
}) {
  const { t: tr } = useTranslation();
  const { t } = useTheme();
  const time = (
    <Text tone={row.kind === 'closed' ? 'subtle' : 'strong'} weight="semibold" style={{ width: t.scheduleTimeCol }}>
      {row.from}
    </Text>
  );
  const box = { flex: 1, minHeight: t.controlLg, borderRadius: t.radiusMd, paddingVertical: t.space2, paddingHorizontal: t.space3, gap: t.space1 / 2 };

  if (row.kind === 'closed') {
    return (
      <View style={{ flexDirection: 'row', gap: t.space2 }}>
        {time}
        <View style={[box, { backgroundColor: t.bgSubtle, justifyContent: 'center' }]}>
          <Text tone="muted">{`${tr('owner.today.legendClosed')} · ${row.from}–${row.to}`}</Text>
        </View>
      </View>
    );
  }
  if (row.kind === 'free') {
    const label = `${tr('mobile.owner.today.free', { price: money(row.price) })} · ${row.from}–${row.to}`;
    const body = (
      <>
        <Text tone="muted" style={{ flex: 1 }}>
          {label}
        </Text>
        {onFree ? <Icon name="plus" color={t.primary} size={t.iconSm} /> : null}
      </>
    );
    const style = [box, { flexDirection: 'row' as const, alignItems: 'center' as const, gap: t.space2, borderWidth: t.hairline, borderStyle: 'dashed' as const, borderColor: t.borderDefault }];
    return (
      <View style={{ flexDirection: 'row', gap: t.space2 }}>
        {time}
        {onFree ? (
          <Pressable accessibilityRole="button" accessibilityLabel={tr('owner.today.gapLabel', { court, from: row.from, to: row.to })} onPress={() => onFree(row)} style={style}>
            {body}
          </Pressable>
        ) : (
          <View style={style}>{body}</View>
        )}
      </View>
    );
  }
  const b = row.booking;
  const wait = b.status === 'pending' || b.status === 'awaiting_payment';
  const walk = !wait && b.source === 'walkin';
  const due = dueOf(b);
  const toVerify = awaitsVerification(b);
  const statusText = toVerify ? tr('status.paymentToCheck') : tr(`status.${b.status}`);
  const name = customerLabel(b, tr);
  const tint = wait ? t.warningSoft : walk ? t.infoSoft : t.successSoft;
  const bar = wait ? t.warning : walk ? t.info : t.success;
  const kind = wait ? tr('owner.today.legendWaiting') : walk ? tr('owner.today.legendWalkIn') : null;
  const a11y = due > 0
    ? tr('owner.today.blockLabelDue', { court, from: row.from, to: row.to, name, status: statusText, due: money(due) })
    : tr('owner.today.blockLabel', { court, from: row.from, to: row.to, name, status: statusText });
  return (
    <View style={{ flexDirection: 'row', gap: t.space2 }}>
      {time}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={a11y}
        onPress={() => onBooking(b)}
        style={({ pressed }) => [box, { flexDirection: 'row', gap: t.space2, backgroundColor: pressed ? t.bgHover : tint, overflow: 'hidden' }]}
      >
        <View style={{ width: t.statusBar, alignSelf: 'stretch', backgroundColor: bar, borderRadius: t.radiusFull }} />
        <View style={{ flex: 1, gap: t.space1 / 2 }}>
          <Text tone="strong" weight="semibold">
            {kind ? `${kind} · ${name}` : name}
          </Text>
          <Text variant="caption" tone="default">
            {[`${row.from}–${row.to}`, due > 0 ? tr('mobile.owner.today.dueAmount', { amount: money(due) }) : null, statusText].filter(Boolean).join(' · ')}
          </Text>
          {b.seriesId ? (
            <View style={{ flexDirection: 'row' }}>
              <Badge label={tr('series.badge')} tone="info" />
            </View>
          ) : null}
        </View>
      </Pressable>
    </View>
  );
}

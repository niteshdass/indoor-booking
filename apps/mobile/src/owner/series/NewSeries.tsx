import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  addDays,
  formatMoney,
  localParts,
  MAX_SLOTS_PER_BOOKING,
  SERIES_MAX_GAMES,
  weekdayOf,
  WEEKDAYS,
  type SeriesJson,
  type SeriesPattern,
  type SeriesPreview,
  type Weekday,
} from '@booking/shared';
import { apiPost } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { useResource } from '../../lib/useResource';
import { useTheme } from '../../theme/ThemeProvider';
import { BackButton, Badge, Button, Chip, Empty, ErrorState, Field, Group, Icon, Loading, Row, Screen, Segmented, Text } from '../../ui';
import { VenueChips } from '../insights/VenueChips';
import { ownerHref, ownerPath } from '../labels';
import { useOwner } from '../OwnerProvider';
import type { OwnerSlotDay, OwnerTurf, OwnerVenue } from '../types';
import { dayLabel, duration, timeLabel, weekdayName } from './text';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const COLLAPSED_ROWS = 5;

/** Same rule as apps/web/src/series/pattern.ts. */
function isPatternOk(p: SeriesPattern): boolean {
  const endOk = p.count !== null ? p.count >= 1 : p.endDate !== null && p.endDate >= p.firstDate;
  return p.weekdays.length > 0 && p.startTime !== '' && ISO_DATE.test(p.firstDate) && endOk;
}

const patternBody = (p: SeriesPattern) => ({
  weekdays: p.weekdays,
  startTime: p.startTime,
  slotCount: p.slotCount,
  firstDate: p.firstDate,
  endDate: p.endDate,
  count: p.count,
});

/** Owner: book a weekly series for a customer after checking which dates are free (same calls as the web NewSeriesPage). */
export function NewSeries({ venueParam }: { venueParam?: string }) {
  const { t: tr } = useTranslation();
  const { venues, can } = useOwner();
  const [venueId, setVenueId] = useState(venueParam && venues.some((v) => v.id === venueParam) ? venueParam : (venues[0]?.id ?? ''));
  const venue = venues.find((v) => v.id === venueId) ?? venues[0];
  return (
    <Screen scroll>
      <BackButton />
      <Text variant="heading" tone="strong" accessibilityRole="header">
        {tr('series.newTitle')}
      </Text>
      {!can('booking.create') ? (
        <Text tone="muted">{tr('mobile.owner.series.noAccess')}</Text>
      ) : !venue ? (
        <Empty>{tr('owner.today.noVenues')}</Empty>
      ) : (
        <>
          {venues.length > 1 ? <VenueChips value={venue.id} onChange={setVenueId} /> : null}
          <ActiveTurfs key={venue.id} venue={venue} />
        </>
      )}
    </Screen>
  );
}

function ActiveTurfs({ venue }: { venue: OwnerVenue }) {
  const { t: tr } = useTranslation();
  const { ownerId } = useOwner();
  const turfs = useResource<{ turfs: OwnerTurf[] }>(ownerPath(ownerId, `/venues/${encodeURIComponent(venue.id)}/turfs`));
  if (turfs.state.status === 'error') return <ErrorState error={turfs.state.error} onRetry={turfs.reload} />;
  if (turfs.state.status !== 'ready') return <Loading />;
  const active = turfs.state.data.turfs.filter((x) => x.active);
  if (active.length === 0) return <Empty>{tr('owner.walkIn.noTurfs')}</Empty>;
  return <Builder venue={venue} turfs={active} />;
}

function Label({ children }: { children: string }) {
  return (
    <Text variant="label" tone="strong">
      {children}
    </Text>
  );
}

function ChoiceChip({ on, label, onPress, a11y }: { on: boolean; label: string; onPress(): void; a11y?: string }) {
  return (
    <Chip selected={on} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={a11y ?? label} onPress={onPress}>
      <Text variant="label" tone={on ? 'primary' : 'default'} weight={on ? 'semibold' : 'medium'}>
        {label}
      </Text>
    </Chip>
  );
}

/** "‹ Sat, 7 Nov ›": a date moved by a fixed step, never before `min`. */
function DateStepper({ label, value, min, step, onChange }: { label: string; value: string; min: string; step: number; onChange(d: string): void }) {
  const { t } = useTheme();
  const { t: tr, i18n } = useTranslation();
  const canBack = addDays(value, -step) >= min;
  const button = (dir: -1 | 1) => {
    const disabled = dir === -1 && !canBack;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${tr(dir === -1 ? 'mobile.owner.series.earlier' : 'mobile.owner.series.later')}`}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => onChange(addDays(value, dir * step))}
        style={({ pressed }) => ({
          width: t.controlLg,
          height: t.controlLg,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: t.radiusMd,
          backgroundColor: pressed ? t.controlFillHover : t.controlFill,
          opacity: disabled ? t.opacityMuted : 1,
        })}
      >
        <Icon name={dir === -1 ? 'arrowLeft' : 'arrowRight'} color={t.textStrong} size={t.iconSm} />
      </Pressable>
    );
  };
  return (
    <View style={{ gap: t.space1, flex: 1, minWidth: t.fieldMin }}>
      <Label>{label}</Label>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space2 }}>
        {button(-1)}
        <Text tone="strong" weight="semibold" style={{ flex: 1, textAlign: 'center' }}>
          {dayLabel(value, i18n.language)}
        </Text>
        {button(1)}
      </View>
    </View>
  );
}

function Builder({ venue, turfs }: { venue: OwnerVenue; turfs: OwnerTurf[] }) {
  const { t } = useTheme();
  const { t: tr, i18n } = useTranslation();
  const lang = i18n.language;
  const { ownerId } = useOwner();
  const today = localParts(new Date(), venue.timezone).date;
  const [turfId, setTurfId] = useState(turfs[0]!.id);
  const [pattern, setPattern] = useState<SeriesPattern>(() => {
    const first = addDays(today, 1);
    return { weekdays: [weekdayOf(first)], startTime: '', slotCount: 1, firstDate: first, endDate: null, count: 10 };
  });
  const [countDraft, setCountDraft] = useState<string | null>(null);
  const [preview, setPreview] = useState<SeriesPreview | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [tried, setTried] = useState(false);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const busy = useRef(false);

  const turf = turfs.find((x) => x.id === turfId) ?? turfs[0]!;
  const base = ownerPath(ownerId, `/venues/${encodeURIComponent(venue.id)}/turfs/${encodeURIComponent(turf.id)}`);
  const slots = useResource<{ day: OwnerSlotDay }>(`${base}/slots?date=${pattern.firstDate}`);
  const slotsReady = slots.state.status === 'ready';
  const slotTimes = slots.state.status === 'ready' ? slots.state.data.day.slots.map((s) => s.localStart) : [];
  const slotKey = slotTimes.join(',');

  // Keep the start time on one the first date offers (the first slot when it no longer does).
  useEffect(() => {
    if (!slotsReady) return;
    setPattern((p) => (slotTimes.includes(p.startTime) || slotTimes.length === 0 ? p : { ...p, startTime: slotTimes[0]! }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotKey, slotsReady]);

  const edit = (patch: Partial<SeriesPattern>) => {
    setPattern((p) => ({ ...p, ...patch }));
    setPreview(null);
    setExpanded(false);
    setError(null);
  };
  const toggleDay = (day: Weekday) => {
    const on = pattern.weekdays.includes(day);
    edit({ weekdays: WEEKDAYS.filter((d) => (d === day ? !on : pattern.weekdays.includes(d))) });
  };

  const patternOk = isPatternOk(pattern);
  const nameBad = name.trim().length < 1 || name.trim().length > 80;
  const phoneBad = phone.trim() === '';

  const checkDates = async () => {
    if (!patternOk) return;
    setChecking(true);
    setError(null);
    setPreview(null);
    try {
      const res = await apiPost<{ preview: SeriesPreview }>(`${base}/series/preview`, patternBody(pattern));
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
    if (nameBad || phoneBad) return;
    busy.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiPost<{ series: SeriesJson }>(`${base}/series`, {
        ...patternBody(pattern),
        customer: { name: name.trim(), phone: phone.trim() },
      });
      router.replace(ownerHref(ownerId, `/series/${encodeURIComponent(res.series.id)}`));
    } catch (e) {
      setError(e);
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  };

  const times = slotTimes.includes(pattern.startTime) || pattern.startTime === '' ? slotTimes : [pattern.startTime, ...slotTimes];
  const mode: 'count' | 'date' = pattern.count !== null ? 'count' : 'date';
  const chipRow = { gap: t.space2, paddingVertical: t.space1 };

  return (
    <>
      <Group>
        <View style={{ padding: t.space3, gap: t.space3 }}>
          <Label>{tr('owner.walkIn.customer')}</Label>
          <Field
            label={tr('owner.walkIn.name')}
            value={name}
            onChangeText={setName}
            maxLength={80}
            autoComplete="off"
            error={tried && nameBad ? tr('owner.walkIn.nameRequired') : undefined}
          />
          <Field
            label={tr('owner.walkIn.phoneLabel')}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            autoComplete="tel"
            maxLength={32}
            error={tried && phoneBad ? tr('owner.walkIn.phoneRequired') : undefined}
          />
        </View>
      </Group>

      <View style={{ gap: t.space1 }}>
        <Label>{tr('owner.walkIn.turf')}</Label>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={chipRow}>
          {turfs.map((x) => (
            <ChoiceChip
              key={x.id}
              on={x.id === turf.id}
              label={x.name}
              onPress={() => {
                setTurfId(x.id);
                setPreview(null);
                setError(null);
              }}
            />
          ))}
        </ScrollView>
      </View>

      <View style={{ gap: t.space1 }}>
        <Label>{tr('series.weekdays')}</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', ...chipRow }}>
          {WEEKDAYS.map((day, i) => (
            <ChoiceChip key={day} on={pattern.weekdays.includes(day)} label={weekdayName(lang, i)} onPress={() => toggleDay(day)} />
          ))}
        </View>
      </View>

      <View style={{ gap: t.space1 }}>
        <Label>{tr('series.startTime')}</Label>
        {slots.state.status === 'error' ? (
          <ErrorState error={slots.state.error} onRetry={slots.reload} />
        ) : !slotsReady ? (
          <Loading />
        ) : times.length === 0 ? (
          <Text variant="label" tone="warning">
            {tr('series.noSlots')}
          </Text>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={chipRow}>
            {times.map((x) => (
              <ChoiceChip key={x} on={x === pattern.startTime} label={x} onPress={() => edit({ startTime: x })} />
            ))}
          </ScrollView>
        )}
      </View>

      <View style={{ gap: t.space1 }}>
        <Label>{tr('series.length')}</Label>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={chipRow}>
          {Array.from({ length: MAX_SLOTS_PER_BOOKING }, (_, k) => k + 1).map((n) => (
            <ChoiceChip key={n} on={n === pattern.slotCount} label={duration(n * turf.slotLengthMin, tr)} onPress={() => edit({ slotCount: n })} />
          ))}
        </ScrollView>
      </View>

      <DateStepper
        label={tr('series.firstDate')}
        value={pattern.firstDate}
        min={today}
        step={1}
        onChange={(d) => edit({ firstDate: d, ...(pattern.endDate !== null && pattern.endDate < d ? { endDate: d } : {}) })}
      />

      <View style={{ gap: t.space2 }}>
        <Segmented
          label={tr('series.ends')}
          value={mode}
          onChange={(m) => {
            setCountDraft(null);
            edit(m === 'date' ? { endDate: pattern.endDate ?? pattern.firstDate, count: null } : { count: pattern.count ?? 10, endDate: null });
          }}
          options={[
            { value: 'count', label: tr('series.endsAfterShort') },
            { value: 'date', label: tr('series.endsOnDateShort') },
          ]}
        />
        {mode === 'date' ? (
          <DateStepper label={tr('series.endDate')} value={pattern.endDate ?? pattern.firstDate} min={pattern.firstDate} step={7} onChange={(d) => edit({ endDate: d })} />
        ) : (
          <Field
            label={tr('series.count')}
            keyboardType="number-pad"
            value={countDraft ?? String(pattern.count ?? '')}
            onBlur={() => setCountDraft(null)}
            onChangeText={(text) => {
              setCountDraft(text);
              const n = Math.floor(Number(text));
              if (text.trim() !== '' && Number.isFinite(n) && n >= 1) edit({ count: Math.min(n, SERIES_MAX_GAMES) });
            }}
          />
        )}
      </View>

      {!preview ? (
        <Button label={tr('series.check')} variant="secondary" loading={checking} disabled={!patternOk} onPress={() => void checkDates()} />
      ) : (
        <PreviewCard preview={preview} timeZone={venue.timezone} expanded={expanded} onToggle={() => setExpanded((x) => !x)} />
      )}

      {error !== null ? (
        <Text tone="danger" accessibilityRole="alert">
          {errorMessage(error, tr)}
        </Text>
      ) : null}

      {preview ? (
        <View style={{ gap: t.space2 }}>
          <Text tone="strong" weight="semibold">
            {tr('series.footer', { count: preview.freeCount, total: formatMoney(preview.total, preview.currency, lang) })}
          </Text>
          <Button
            label={tr('series.book', { count: preview.freeCount })}
            loading={submitting}
            disabled={preview.freeCount === 0}
            onPress={() => void book()}
          />
        </View>
      ) : null}
    </>
  );
}

function PreviewCard({ preview, timeZone, expanded, onToggle }: { preview: SeriesPreview; timeZone: string; expanded: boolean; onToggle(): void }) {
  const { t } = useTheme();
  const { t: tr, i18n } = useTranslation();
  const lang = i18n.language;
  const skipped = preview.dates.length - preview.freeCount;
  const collapsible = preview.dates.length > COLLAPSED_ROWS + 1;
  const dates = collapsible && !expanded ? preview.dates.slice(0, COLLAPSED_ROWS) : preview.dates;
  // A player-paid fee is already in `total`; it is named, never added again.
  const fee = preview.platformFee?.payer === 'player' ? preview.platformFee.perGame.reduce((n, x) => n + x, 0) : 0;
  return (
    <View style={{ gap: t.space2 }} accessibilityLiveRegion="polite">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space2, flexWrap: 'wrap' }}>
        <Text variant="title" tone="strong" accessibilityRole="header" style={{ flexShrink: 1 }}>
          {tr('mobile.owner.series.preview')}
        </Text>
        <Badge label={tr('mobile.owner.series.free', { count: preview.freeCount })} tone={preview.freeCount > 0 ? 'success' : 'danger'} />
        {skipped > 0 ? <Badge label={tr('series.skipped', { count: skipped })} tone="warning" /> : null}
      </View>
      <Group>
        {dates.map((d) =>
          d.status === 'free' ? (
            <Row
              key={d.date}
              title={dayLabel(d.date, lang)}
              detail={`${timeLabel(d.startAt, timeZone)}–${timeLabel(d.endAt, timeZone)}`}
              right={
                <Text variant="label" tone="strong">
                  {formatMoney(d.price, preview.currency, lang)}
                </Text>
              }
            />
          ) : (
            <Row key={d.date} title={dayLabel(d.date, lang)} right={<Badge label={tr(`series.reason.${d.reason}`)} tone="warning" />} />
          ),
        )}
      </Group>
      {collapsible ? (
        <Button label={expanded ? tr('series.showFewer') : tr('series.showAll', { count: preview.dates.length })} variant="ghost" onPress={onToggle} />
      ) : null}
      {fee > 0 ? (
        <Text variant="caption" tone="muted">
          {tr('series.feeIncluded', { amount: formatMoney(fee, preview.currency, lang) })}
        </Text>
      ) : null}
    </View>
  );
}

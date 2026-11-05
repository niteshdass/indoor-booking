import { useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { currencyExponent, formatMoney } from '@booking/shared';
import { useResource } from '../../lib/useResource';
import { useTheme } from '../../theme/ThemeProvider';
import { Empty, ErrorState, Group, Loading, Row, Screen, Segmented, Text } from '../../ui';
import { ownerHref, ownerPath } from '../labels';
import { useOwner } from '../OwnerProvider';
import type { OwnerVenue } from '../types';
import { OVERVIEW_DAYS, type Kpi, type Overview, type OverviewDays } from './types';
import { VenueChips } from './VenueChips';

/** Owner Insights tab: one venue's revenue, bookings and turf use over 7, 30 or 90 days against the period before. */
export function Insights() {
  const { t: tr } = useTranslation();
  const { venues, can } = useOwner();
  const [venueId, setVenueId] = useState(venues[0]?.id ?? '');
  const [days, setDays] = useState<OverviewDays>(30);
  const venue = venues.find((v) => v.id === venueId) ?? venues[0];
  return (
    <Screen scroll>
      <Text variant="heading" tone="strong" accessibilityRole="header">
        {tr('mobile.owner.shell.insights')}
      </Text>
      {!can('reports.view') ? (
        <Text tone="muted">{tr('mobile.owner.insights.noAccess')}</Text>
      ) : !venue ? (
        <Empty>{tr('owner.today.noVenues')}</Empty>
      ) : (
        <>
          <VenueChips value={venue.id} onChange={setVenueId} />
          <Segmented
            label={tr('owner.overview.range')}
            value={String(days)}
            onChange={(v) => setDays(Number(v) as OverviewDays)}
            options={OVERVIEW_DAYS.map((d) => ({ value: String(d), label: tr('mobile.owner.insights.days', { count: d }) }))}
          />
          <VenueInsights key={`${venue.id}|${days}`} venue={venue} days={days} />
        </>
      )}
    </Screen>
  );
}

/** Number formatters for one venue's currency and the UI language (same as the web overview). */
function useFormats(currency: string) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const unit = 10 ** currencyExponent(currency);
  const compact = new Intl.NumberFormat(lang, { style: 'currency', currency, notation: 'compact', minimumFractionDigits: 0, maximumFractionDigits: 1 });
  const count = new Intl.NumberFormat(lang);
  const oneDecimal = new Intl.NumberFormat(lang, { maximumFractionDigits: 1 });
  const percent = new Intl.NumberFormat(lang, { style: 'percent', maximumFractionDigits: 1 });
  return {
    lang,
    money: (minor: number) => formatMoney(minor, currency, lang),
    short: (minor: number) => compact.format(minor / unit),
    count: (n: number) => count.format(n),
    hours: (minutes: number) => t('owner.overview.hoursValue', { n: oneDecimal.format(minutes / 60) }),
    percent: (share: number) => percent.format(share),
    points: (share: number) => t('owner.overview.pt', { n: oneDecimal.format(Math.abs(share) * 100) }),
  };
}
type Formats = ReturnType<typeof useFormats>;

function VenueInsights({ venue, days }: { venue: OwnerVenue; days: OverviewDays }) {
  const { t: tr } = useTranslation();
  const { ownerId } = useOwner();
  const { state, reload } = useResource<Overview>(ownerPath(ownerId, `/reports/overview?venueId=${encodeURIComponent(venue.id)}&days=${days}`));
  const f = useFormats(venue.currency);
  if (state.status === 'error') return <ErrorState error={state.error} onRetry={reload} />;
  if (state.status !== 'ready') return <Loading />;
  const o = state.data;
  const date = (d: string) => new Intl.DateTimeFormat(f.lang, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));
  return (
    <>
      <Text variant="caption" tone="muted">
        {tr('owner.overview.compared', { from: date(o.range.from), to: date(o.range.to), prevFrom: date(o.range.previous.from), prevTo: date(o.range.previous.to) })}
      </Text>
      <Kpis o={o} f={f} />
      <RevenueCard o={o} f={f} date={date} />
      <MethodsCard o={o} f={f} />
      <CourtsCard o={o} f={f} />
      <Group>
        <Row
          icon="money"
          title={tr('owner.overview.mix.outstanding')}
          detail={o.mix.outstanding > 0 ? tr('owner.overview.mix.seeDues') : undefined}
          right={
            <Text weight="semibold" tone={o.mix.outstanding > 0 ? 'warning' : 'strong'}>
              {f.money(o.mix.outstanding)}
            </Text>
          }
          onPress={
            o.mix.outstanding > 0
              ? () => router.push(ownerHref(ownerId, `/bookings?tab=dues&venue=${encodeURIComponent(venue.id)}`))
              : undefined
          }
        />
      </Group>
    </>
  );
}

function Card({ title, label, children }: { title: string; label?: string; children: ReactNode }) {
  const { t } = useTheme();
  return (
    <View style={{ backgroundColor: t.bgSurface, borderRadius: t.radiusLg, padding: t.space3, gap: t.space2 }}>
      <Text variant="label" weight="semibold" tone="strong" accessibilityRole="header">
        {title}
      </Text>
      {label !== undefined ? (
        <View accessible accessibilityRole="image" accessibilityLabel={label} style={{ gap: t.space2 }}>
          {children}
        </View>
      ) : (
        children
      )}
    </View>
  );
}

/** "▲ 12% from BDT 41K", green when the change is good for the venue; rates change in points. Returns text and a spoken form. */
function delta(kpi: Kpi, format: (n: number) => string, f: Formats, tr: TFunction, lowerIsBetter = false, rate = false) {
  const diff = kpi.value - kpi.previous;
  const from = tr('owner.overview.from', { value: format(kpi.previous) });
  if (diff === 0 || (!rate && kpi.previous === 0 && kpi.value === 0)) {
    const same = tr('owner.overview.same');
    return { mark: same, tone: 'muted' as const, from, spoken: `${same}, ${from}` };
  }
  const up = diff > 0;
  const good = up !== lowerIsBetter;
  const size = rate ? f.points(diff) : kpi.previous === 0 ? tr('owner.overview.new') : f.percent(Math.abs(diff) / kpi.previous);
  return {
    mark: `${up ? '▲' : '▼'} ${size}`,
    tone: good ? ('success' as const) : ('danger' as const),
    from,
    spoken: `${tr(up ? 'owner.overview.up' : 'owner.overview.down')} ${size}, ${from}`,
  };
}

function Kpis({ o, f }: { o: Overview; f: Formats }) {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const { kpis } = o;
  const tiles: { key: string; label: string; kpi: Kpi; format: (n: number) => string; lowerIsBetter?: boolean; rate?: boolean }[] = [
    { key: 'revenue', label: tr('owner.overview.kpi.revenue'), kpi: kpis.revenue, format: f.short },
    { key: 'bookings', label: tr('owner.overview.kpi.bookings'), kpi: kpis.bookings, format: f.count },
    { key: 'use', label: tr('owner.overview.kpi.utilization'), kpi: kpis.utilization, format: f.percent, rate: true },
    { key: 'average', label: tr('owner.overview.kpi.average'), kpi: kpis.averageBooking, format: f.short },
    { key: 'cancel', label: tr('owner.overview.kpi.cancellations'), kpi: kpis.cancellationRate, format: f.percent, lowerIsBetter: true, rate: true },
    { key: 'hours', label: tr('owner.overview.kpi.hours'), kpi: kpis.minutes, format: f.hours },
  ];
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space2 }}>
      {tiles.map((tile) => {
        const d = delta(tile.kpi, tile.format, f, tr, tile.lowerIsBetter, tile.rate);
        const value = tile.format(tile.kpi.value);
        const note = tile.key === 'revenue' && o.platformFees > 0 ? tr('owner.overview.kpi.afterFee', { amount: f.short(o.platformFees) }) : null;
        return (
          <View
            key={tile.key}
            accessible
            accessibilityLabel={[`${tile.label}: ${value}`, d.spoken, note].filter(Boolean).join('. ')}
            style={{ flexGrow: 1, flexBasis: '40%', backgroundColor: t.bgSurface, borderRadius: t.radiusLg, padding: t.space3, gap: t.space1 / 2 }}
          >
            <Text variant="label" tone="muted">
              {tile.label}
            </Text>
            <Text variant="title" weight="bold" tone="strong">
              {value}
            </Text>
            <Text variant="caption" tone="muted">
              <Text variant="caption" weight="semibold" tone={d.tone}>
                {d.mark}
              </Text>{' '}
              {d.from}
            </Text>
            {note ? (
              <Text variant="caption" tone="muted">
                {note}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function Swatch({ color }: { color: string }) {
  const { t } = useTheme();
  return <View style={{ width: t.swatch, height: t.swatch, borderRadius: t.radiusMark, backgroundColor: color }} />;
}

/** Revenue per week (per day for 7 days), Online and Walk-in stacked. */
function RevenueCard({ o, f, date }: { o: Overview; f: Formats; date: (d: string) => string }) {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const size = o.daily.length <= 7 ? 1 : 7;
  const buckets: { date: string; online: number; walkin: number }[] = [];
  for (let i = 0; i < o.daily.length; i += size) {
    const chunk = o.daily.slice(i, i + size);
    buckets.push({ date: chunk[0]!.date, online: chunk.reduce((s, d) => s + d.online, 0), walkin: chunk.reduce((s, d) => s + d.walkin, 0) });
  }
  const max = Math.max(0, ...buckets.map((b) => b.online + b.walkin));
  const title = tr(size === 1 ? 'mobile.owner.insights.revenueByDay' : 'mobile.owner.insights.revenueByWeek');
  if (max === 0) {
    return (
      <Card title={title}>
        <Text variant="label" tone="muted">
          {tr('mobile.owner.insights.noRevenue')}
        </Text>
      </Card>
    );
  }
  const online = tr('owner.overview.trend.online');
  const walkin = tr('owner.overview.trend.walkin');
  const label = `${title}. ${buckets.map((b) => `${date(b.date)}: ${f.short(b.online + b.walkin)} (${online} ${f.short(b.online)}, ${walkin} ${f.short(b.walkin)})`).join('; ')}`;
  const mid = Math.floor((buckets.length - 1) / 2);
  const ticks = buckets.length > 2 ? [0, mid, buckets.length - 1] : buckets.map((_, i) => i);
  return (
    <Card title={title} label={label}>
      <View testID="revenue-bars" style={{ flexDirection: 'row', alignItems: 'flex-end', gap: t.space1, height: t.space24 }}>
        {buckets.map((b) => {
          const total = b.online + b.walkin;
          return (
            <View key={b.date} style={{ flex: 1, height: '100%', justifyContent: 'flex-end' }}>
              {total > 0 ? (
                <View
                  style={{
                    height: `${(total / max) * 100}%`,
                    minHeight: t.chartGap * 2,
                    borderTopLeftRadius: t.radiusSm,
                    borderTopRightRadius: t.radiusSm,
                    overflow: 'hidden',
                    gap: b.online > 0 && b.walkin > 0 ? t.chartGap : 0,
                  }}
                >
                  {b.walkin > 0 ? <View style={{ flex: b.walkin, backgroundColor: t.chart2 }} /> : null}
                  {b.online > 0 ? <View style={{ flex: b.online, backgroundColor: t.chart1 }} /> : null}
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: t.space2 }}>
        {ticks.map((i) => (
          <Text key={i} variant="caption" tone="muted">
            {date(buckets[i]!.date)}
          </Text>
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space3 }}>
        {[
          { key: 'online', label: online, color: t.chart1 },
          { key: 'walkin', label: walkin, color: t.chart2 },
        ].map((s) => (
          <View key={s.key} style={{ flexDirection: 'row', alignItems: 'center', gap: t.space1 }}>
            <Swatch color={s.color} />
            <Text variant="caption">{s.label}</Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

/** One stacked bar of the amount per payment method, with a legend row per method. */
function MethodsCard({ o, f }: { o: Overview; f: Formats }) {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const title = tr('owner.overview.methods.title');
  const total = o.methods.reduce((s, m) => s + m.amount, 0);
  if (o.methods.length === 0 || total === 0) {
    return (
      <Card title={title}>
        <Text variant="label" tone="muted">
          {tr('owner.overview.methods.none')}
        </Text>
      </Card>
    );
  }
  const colors = [t.chart1, t.chart2, t.chart3];
  const rows = o.methods.map((m, i) => ({
    ...m,
    name: tr(`owner.overview.methods.${m.method}`),
    color: colors[i % colors.length]!,
    share: f.percent(m.amount / total),
  }));
  const label = `${title}. ${rows.map((r) => `${r.name}: ${r.share}, ${f.money(r.amount)}`).join('; ')}`;
  return (
    <Card title={title} label={label}>
      <View style={{ flexDirection: 'row', height: t.swatch, borderRadius: t.radiusFull, overflow: 'hidden', gap: t.chartGap }}>
        {rows.filter((r) => r.amount > 0).map((r) => (
          <View key={r.method} style={{ flex: r.amount, backgroundColor: r.color }} />
        ))}
      </View>
      {rows.map((r) => (
        <View key={r.method} style={{ flexDirection: 'row', alignItems: 'center', gap: t.space2 }}>
          <Swatch color={r.color} />
          <View style={{ flex: 1 }}>
            <Text variant="label" tone="strong">
              {r.name} · {r.share}
            </Text>
            <Text variant="caption" tone="muted">
              {tr('owner.overview.methods.count', { count: r.count })}
            </Text>
          </View>
          <Text variant="label" weight="semibold" tone="strong">
            {f.money(r.amount)}
          </Text>
        </View>
      ))}
    </Card>
  );
}

const TOP_COURTS = 5;

/** Turfs by share of their open time booked, busiest first. */
function CourtsCard({ o, f }: { o: Overview; f: Formats }) {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const title = tr('mobile.owner.insights.busiest');
  const rows = o.courts
    .filter((c) => c.openMinutes > 0)
    .map((c) => ({ ...c, use: Math.min(1, c.minutes / c.openMinutes) }))
    .sort((a, b) => b.use - a.use)
    .slice(0, TOP_COURTS);
  if (rows.length === 0) {
    return (
      <Card title={title}>
        <Text variant="label" tone="muted">
          {tr('mobile.owner.insights.noCourts')}
        </Text>
      </Card>
    );
  }
  const label = `${title}. ${rows.map((c) => `${c.name}: ${tr('mobile.owner.insights.courtUse', { use: f.percent(c.use), hours: f.hours(c.minutes) })}`).join('; ')}`;
  return (
    <Card title={title} label={label}>
      {rows.map((c) => (
        <View key={c.id} style={{ gap: t.space1 }}>
          <View style={{ flexDirection: 'row', gap: t.space2, alignItems: 'flex-start' }}>
            <Text variant="label" tone="strong" style={{ flex: 1 }}>
              {c.name}
            </Text>
            <Text variant="caption" tone="muted" style={{ flexShrink: 1, textAlign: 'right' }}>
              {tr('mobile.owner.insights.courtUse', { use: f.percent(c.use), hours: f.hours(c.minutes) })}
            </Text>
          </View>
          <View style={{ height: t.meterHeight, borderRadius: t.radiusFull, backgroundColor: t.bgSubtle, overflow: 'hidden' }}>
            <View style={{ width: `${c.use * 100}%`, height: '100%', borderRadius: t.radiusFull, backgroundColor: t.chart1 }} />
          </View>
        </View>
      ))}
    </Card>
  );
}

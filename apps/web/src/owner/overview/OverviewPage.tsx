import { useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { currencyExponent, type BookingStatus } from '@booking/shared';
import { BOOKING_TONE, BookingStatusBadge } from '../../bookings/BookingStatusBadge';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { Select } from '../../components/ui/Select';
import { Skeleton } from '../../components/ui/Skeleton';
import { Table } from '../../components/ui/Table';
import { Tabs } from '../../components/ui/Tabs';
import { errorMessage } from '../../lib/errors';
import { formatDate, formatTime, money } from '../../lib/format';
import { customerLabel } from '../customerLabel';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import { useOwnerTitle } from '../shell/OwnerShell';
import { useVenueParam } from '../shell/useVenueParam';
import { VenueSelect } from '../shell/VenueSelect';
import type { OwnerVenue } from '../types';
import { useResource } from '../useResource';
import { Donut, Sparkline, TrendChart, type TrendSeries } from './charts';
import { OVERVIEW_DAYS, type Kpi, type Overview, type OverviewDays } from './types';
import { awaitsVerification } from '../bookings/availableActions';
import styles from './overview.module.css';

/** Order of the outcome rows: played first, then the ones that fell through, then the ones still open. */
const OUTCOMES: BookingStatus[] = ['confirmed', 'completed', 'no_show', 'cancelled', 'rejected', 'expired', 'pending', 'awaiting_payment'];
/** Monday-first weekday names come from this Monday. */
const A_MONDAY = Date.UTC(2024, 0, 1);

/** Owner dashboard: one venue's revenue, bookings and court use over 7, 30 or 90 days against the period before. */
export function OverviewPage() {
  const { t } = useTranslation();
  const { can } = useOwner();
  const [venue] = useVenueParam();
  const [params, setParams] = useSearchParams();
  useOwnerTitle(t('owner.nav.overview'));
  const asked = Number(params.get('days'));
  const days: OverviewDays = (OVERVIEW_DAYS as readonly number[]).includes(asked) ? (asked as OverviewDays) : 30;

  if (!venue) {
    return (
      <div className={styles.page}>
        <EmptyState title={t('owner.today.noVenues')} />
        {can('venue.manage') && (
          <Link to="../venues/new" relative="path" className={styles.cta}>
            {t('owner.today.createVenue')}
          </Link>
        )}
      </div>
    );
  }
  const setDays = (next: string) =>
    setParams(
      (prev) => {
        const copy = new URLSearchParams(prev);
        copy.set('days', next);
        return copy;
      },
      { replace: true },
    );
  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <VenueSelect />
        <Select
          label={t('owner.overview.range')}
          hideLabel
          value={String(days)}
          onChange={(e) => setDays(e.target.value)}
          options={OVERVIEW_DAYS.map((d) => ({ value: String(d), label: t(`owner.overview.days_${d}`) }))}
        />
      </div>
      <OverviewVenue venue={venue} days={days} />
    </div>
  );
}

/** Number formatters for one venue's currency and the UI language. */
function useFormats(currency: string) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const unit = 10 ** currencyExponent(currency);
  const compactMoney = new Intl.NumberFormat(lang, { style: 'currency', currency, notation: 'compact', minimumFractionDigits: 0, maximumFractionDigits: 1 });
  const count = new Intl.NumberFormat(lang);
  const oneDecimal = new Intl.NumberFormat(lang, { maximumFractionDigits: 1 });
  const percent = new Intl.NumberFormat(lang, { style: 'percent', maximumFractionDigits: 1 });
  return {
    lang,
    unit,
    money: (minor: number) => money(minor, currency, lang),
    short: (minor: number) => compactMoney.format(minor / unit),
    count: (n: number) => count.format(n),
    hours: (minutes: number) => t('owner.overview.hoursValue', { n: oneDecimal.format(minutes / 60) }),
    percent: (share: number) => percent.format(share),
    points: (share: number) => t('owner.overview.pt', { n: oneDecimal.format(Math.abs(share) * 100) }),
  };
}
type Formats = ReturnType<typeof useFormats>;

function OverviewVenue({ venue, days }: { venue: OwnerVenue; days: OverviewDays }) {
  const { t } = useTranslation();
  const { ownerId } = useOwner();
  const { state, reload } = useResource<Overview>(
    ownerPath(ownerId, `/reports/overview?venueId=${encodeURIComponent(venue.id)}&days=${days}`),
  );
  const f = useFormats(venue.currency);

  if (state.status === 'error') {
    return (
      <Alert tone="danger">
        <p className={styles.muted}>{errorMessage(state.error, t)}</p>
        <Button variant="secondary" onClick={reload}>
          {t('auth.retry')}
        </Button>
      </Alert>
    );
  }
  if (state.status !== 'ready') return <Skeleton kind="dashboard" label={t('common.loading')} />;

  const o = state.data;
  const date = (d: string) => formatDate(d, o.timezone, f.lang);
  return (
    <>
      <p className={styles.range}>
        {t('owner.overview.compared', {
          from: date(o.range.from),
          to: date(o.range.to),
          prevFrom: date(o.range.previous.from),
          prevTo: date(o.range.previous.to),
        })}
      </p>
      <Kpis o={o} f={f} />
      <div className={styles.split}>
        <TrendCard o={o} f={f} />
        <MixCard o={o} f={f} />
      </div>
      <div className={styles.split}>
        <HeatCard o={o} f={f} />
        <div className={styles.stack}>
          <PlayersCard o={o} f={f} />
          <MethodsCard o={o} f={f} />
        </div>
      </div>
      <div className={styles.split}>
        <CourtsCard o={o} f={f} />
        <OutcomesCard o={o} f={f} />
      </div>
      <RecentCard o={o} f={f} venue={venue} />
    </>
  );
}

type CardProps = { o: Overview; f: Formats };

function Section({ title, hint, action, children, className }: { title: string; hint?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={[styles.card, className].filter(Boolean).join(' ')}>
      <header className={styles.cardHead}>
        <div>
          <h2 className={styles.cardTitle}>{title}</h2>
          {hint && <p className={styles.muted}>{hint}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

/** "▲ 12% from BDT 41k", green when the change is good for the venue. Rates change in points, not percent. */
function Delta({ kpi, format, f, lowerIsBetter, rate }: { kpi: Kpi; format: (n: number) => string; f: Formats; lowerIsBetter?: boolean; rate?: boolean }) {
  const { t } = useTranslation();
  const diff = kpi.value - kpi.previous;
  const from = t('owner.overview.from', { value: format(kpi.previous) });
  if (diff === 0 || (!rate && kpi.previous === 0 && kpi.value === 0)) {
    return (
      <p className={styles.delta}>
        <span className={styles.flat}>{t('owner.overview.same')}</span> {from}
      </p>
    );
  }
  const up = diff > 0;
  const good = up !== Boolean(lowerIsBetter);
  const size = rate ? f.points(diff) : kpi.previous === 0 ? t('owner.overview.new') : f.percent(Math.abs(diff) / kpi.previous);
  return (
    <p className={styles.delta}>
      <span className={good ? styles.good : styles.bad}>
        <span aria-hidden="true">{up ? '▲' : '▼'}</span>
        <span className={styles.srOnly}>{t(up ? 'owner.overview.up' : 'owner.overview.down')}</span> {size}
      </span>{' '}
      {from}
    </p>
  );
}

function Kpis({ o, f }: CardProps) {
  const { t } = useTranslation();
  const { kpis, daily } = o;
  const revenue = daily.map((d) => d.online + d.walkin);
  const tiles: { key: string; label: string; kpi: Kpi; format: (n: number) => string; spark?: number[]; lowerIsBetter?: boolean; rate?: boolean }[] = [
    { key: 'revenue', label: t('owner.overview.kpi.revenue'), kpi: kpis.revenue, format: f.short, spark: revenue },
    { key: 'bookings', label: t('owner.overview.kpi.bookings'), kpi: kpis.bookings, format: f.count, spark: daily.map((d) => d.bookings) },
    { key: 'hours', label: t('owner.overview.kpi.hours'), kpi: kpis.minutes, format: f.hours, spark: daily.map((d) => d.minutes) },
    { key: 'use', label: t('owner.overview.kpi.utilization'), kpi: kpis.utilization, format: f.percent, rate: true },
    {
      key: 'average',
      label: t('owner.overview.kpi.average'),
      kpi: kpis.averageBooking,
      format: f.short,
      spark: daily.map((d, i) => (d.bookings > 0 ? revenue[i]! / d.bookings : 0)),
    },
    { key: 'cancel', label: t('owner.overview.kpi.cancellations'), kpi: kpis.cancellationRate, format: f.percent, lowerIsBetter: true, rate: true },
  ];
  return (
    <div className={styles.kpis}>
      {tiles.map((tile) => (
        <div key={tile.key} className={styles.kpi}>
          <p className={styles.kpiLabel}>{tile.label}</p>
          <p className={styles.kpiValue}>{tile.format(tile.kpi.value)}</p>
          <Delta kpi={tile.kpi} format={tile.format} f={f} lowerIsBetter={tile.lowerIsBetter} rate={tile.rate} />
          {tile.spark ? (
            <Sparkline values={tile.spark} />
          ) : (
            <span className={styles.meter} aria-hidden="true">
              <span style={{ width: `${Math.round(Math.min(tile.kpi.value, 1) * 100)}%` }} />
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

type Metric = 'revenue' | 'bookings' | 'hours';

function TrendCard({ o, f }: CardProps) {
  const { t } = useTranslation();
  const [metric, setMetric] = useState<Metric>('revenue');
  const dates = o.daily.map((d) => d.date);
  const dateLabel = (d: string) =>
    new Intl.DateTimeFormat(f.lang, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));

  let stacks: TrendSeries[];
  let previous: number[];
  let format: (n: number) => string;
  let minStep: number;
  if (metric === 'revenue') {
    stacks = [
      { key: 'online', label: t('owner.overview.trend.online'), values: o.daily.map((d) => d.online) },
      { key: 'walkin', label: t('owner.overview.trend.walkin'), values: o.daily.map((d) => d.walkin) },
    ];
    previous = o.daily.map((d) => d.previous.revenue);
    format = f.short;
    minStep = f.unit;
  } else if (metric === 'bookings') {
    stacks = [{ key: 'bookings', label: t('owner.overview.trend.current'), values: o.daily.map((d) => d.bookings) }];
    previous = o.daily.map((d) => d.previous.bookings);
    format = f.count;
    minStep = 1;
  } else {
    stacks = [{ key: 'hours', label: t('owner.overview.trend.current'), values: o.daily.map((d) => d.minutes) }];
    previous = o.daily.map((d) => d.previous.minutes);
    format = f.hours;
    minStep = 30;
  }
  const metricLabel = t(`owner.overview.trend.${metric}`);
  const total = (i: number) => stacks.reduce((s, x) => s + x.values[i]!, 0);

  return (
    <Section
      title={t('owner.overview.trend.title')}
     
      action={
        <Tabs
          label={t('owner.overview.trend.label')}
          value={metric}
          onChange={(id) => setMetric(id as Metric)}
          tabs={(['revenue', 'bookings', 'hours'] as const).map((id) => ({ id, label: t(`owner.overview.trend.${id}`) }))}
        />
      }
    >
      <TrendChart
        stacks={stacks}
        previous={previous}
        dates={dates}
        dateLabel={dateLabel}
        format={format}
        minStep={minStep}
        label={t('owner.overview.trend.chart', { metric: metricLabel })}
        tooltip={(i) => (
          <dl className={styles.tipRows}>
            {stacks.length > 1 &&
              stacks.map((s, k) => (
                <div key={s.key}>
                  <dt>
                    <span className={`${styles.swatch} ${styles[`series${k + 1}`]}`} aria-hidden="true" />
                    {s.label}
                  </dt>
                  <dd>{format(s.values[i]!)}</dd>
                </div>
              ))}
            <div>
              <dt>{t('owner.overview.trend.current')}</dt>
              <dd>{format(total(i))}</dd>
            </div>
            <div>
              <dt>{t('owner.overview.trend.previous')}</dt>
              <dd>{format(previous[i]!)}</dd>
            </div>
          </dl>
        )}
      />
      <ul className={styles.legend}>
        {stacks.map((s, k) => (
          <li key={s.key}>
            <span className={`${styles.swatch} ${styles[`series${k + 1}`]}`} aria-hidden="true" />
            {s.label}
          </li>
        ))}
        <li>
          <span className={styles.dash} aria-hidden="true" />
          {t('owner.overview.trend.previous')}
        </li>
      </ul>
      <table className={styles.srOnly}>
        <caption>{t('owner.overview.trend.chart', { metric: metricLabel })}</caption>
        <thead>
          <tr>
            <th>{t('owner.overview.trend.date')}</th>
            {stacks.length > 1 && stacks.map((s) => <th key={s.key}>{s.label}</th>)}
            <th>{t('owner.overview.trend.current')}</th>
            <th>{t('owner.overview.trend.previous')}</th>
          </tr>
        </thead>
        <tbody>
          {dates.map((d, i) => (
            <tr key={d}>
              <th>{dateLabel(d)}</th>
              {stacks.length > 1 && stacks.map((s) => <td key={s.key}>{format(s.values[i]!)}</td>)}
              <td>{format(total(i))}</td>
              <td>{format(previous[i]!)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function MixCard({ o, f }: CardProps) {
  const { t } = useTranslation();
  const parts = [
    { key: 'courts', label: t('owner.overview.mix.courts'), value: o.mix.courts, className: styles.series1! },
    { key: 'addons', label: t('owner.overview.mix.addons'), value: o.mix.addons, className: styles.series2! },
    { key: 'fees', label: t('owner.overview.mix.fees'), value: o.mix.cancellationFees, className: styles.series3! },
  ];
  const total = parts.reduce((s, p) => s + p.value, 0);
  return (
    <Section title={t('owner.overview.mix.title')}>
      <div className={styles.mix}>
        <Donut parts={parts}>
          <span className={styles.muted}>{t('owner.overview.mix.total')}</span>
          <strong>{f.short(total)}</strong>
        </Donut>
        <table className={styles.mixTable}>
          <caption className={styles.srOnly}>{t('owner.overview.mix.title')}</caption>
          <tbody>
            {parts.map((p) => (
              <tr key={p.key}>
                <th scope="row">
                  <span className={`${styles.swatch} ${p.className}`} aria-hidden="true" />
                  {p.label}
                </th>
                <td className={styles.muted}>{total > 0 ? f.percent(p.value / total) : '—'}</td>
                <td>{f.money(p.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className={styles.footer}>
        <div>
          <dt>{t('owner.overview.mix.collected')}</dt>
          <dd>{f.money(o.mix.collected)}</dd>
        </div>
        <div>
          <dt>{t('owner.overview.mix.outstanding')}</dt>
          <dd className={o.mix.outstanding > 0 ? styles.warn : undefined}>{f.money(o.mix.outstanding)}</dd>
        </div>
      </dl>
    </Section>
  );
}

/** Weekday rows by start-hour columns, one hue from empty to full; the hours shown cover 06–23 and any booking outside them. */
function HeatCard({ o, f }: CardProps) {
  const { t } = useTranslation();
  const weekday = new Intl.DateTimeFormat(f.lang, { weekday: 'short', timeZone: 'UTC' });
  const weekdayLong = new Intl.DateTimeFormat(f.lang, { weekday: 'long', timeZone: 'UTC' });
  const dayName = (i: number, fmt = weekday) => fmt.format(new Date(A_MONDAY + i * 86_400_000));
  const hourName = (h: number) => `${String(h).padStart(2, '0')}:00`;
  const used = o.heatmap.flatMap((row) => row.map((v, h) => (v > 0 ? h : -1))).filter((h) => h >= 0);
  const lo = Math.min(6, ...used);
  const hi = Math.max(23, ...used);
  const hours = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  const max = Math.max(0, ...o.heatmap.flat());
  let peak = { day: 0, hour: 0, value: 0 };
  o.heatmap.forEach((row, d) => row.forEach((v, h) => v > peak.value && (peak = { day: d, hour: h, value: v })));
  const level = (v: number) => (v <= 0 || max === 0 ? 0 : Math.ceil((v / max) * 4));

  return (
    <Section title={t('owner.overview.heat.title')} hint={t('owner.overview.heat.hint')}>
      {max === 0 ? (
        <p className={styles.muted}>{t('owner.overview.heat.none')}</p>
      ) : (
        <>
          <div className={styles.heatScroll}>
            <div className={styles.heat} style={{ gridTemplateColumns: `var(--heat-label) repeat(${hours.length}, minmax(0, 1fr))` }}>
              <span />
              {hours.map((h) => (
                <span key={h} className={styles.heatHour} aria-hidden="true">
                  {h % 3 === 0 ? String(h).padStart(2, '0') : ''}
                </span>
              ))}
              {o.heatmap.map((row, d) => (
                <div key={d} className={styles.heatRow}>
                  <span className={styles.heatDay}>{dayName(d)}</span>
                  {hours.map((h) => {
                    const label = t('owner.overview.heat.cell', { day: dayName(d, weekdayLong), hour: hourName(h), value: f.hours(row[h]! * 60) });
                    return <span key={h} className={styles.heatCell} data-level={level(row[h]!)} title={label} aria-label={label} role="img" />;
                  })}
                </div>
              ))}
            </div>
          </div>
          <div className={styles.heatFoot}>
            <p className={styles.peak}>{t('owner.overview.heat.peak', { day: dayName(peak.day, weekdayLong), hour: hourName(peak.hour) })}</p>
            <span className={styles.scale} aria-hidden="true">
              {t('owner.overview.heat.fewer')}
              {[0, 1, 2, 3, 4].map((l) => (
                <span key={l} className={styles.heatCell} data-level={l} />
              ))}
              {t('owner.overview.heat.more')}
            </span>
          </div>
        </>
      )}
    </Section>
  );
}

function PlayersCard({ o, f }: CardProps) {
  const { t } = useTranslation();
  const { players } = o;
  return (
    <Section title={t('owner.overview.players.title')}>
      <div className={styles.players}>
        <div>
          <p className={styles.kpiLabel}>{t('owner.overview.players.total')}</p>
          <p className={styles.bigNumber}>{f.count(players.value)}</p>
          <Delta kpi={{ value: players.value, previous: players.previous }} format={f.count} f={f} />
        </div>
        <dl className={styles.facts}>
          <div>
            <dt>{t('owner.overview.players.new')}</dt>
            <dd>{f.count(players.newValue)}</dd>
          </div>
          <div>
            <dt>{t('owner.overview.players.returning')}</dt>
            <dd>{f.count(Math.max(0, players.value - players.newValue))}</dd>
          </div>
        </dl>
      </div>
    </Section>
  );
}

function MethodsCard({ o, f }: CardProps) {
  const { t } = useTranslation();
  const top = Math.max(0, ...o.methods.map((m) => m.amount));
  return (
    <Section title={t('owner.overview.methods.title')}>
      {o.methods.length === 0 ? (
        <p className={styles.muted}>{t('owner.overview.methods.none')}</p>
      ) : (
        <ul className={styles.bars}>
          {o.methods.map((m) => (
            <li key={m.method}>
              <span className={styles.barLabel}>
                {t(`owner.overview.methods.${m.method}`)}
                <span className={styles.muted}>{t('owner.overview.methods.count', { count: m.count })}</span>
              </span>
              <span className={styles.barValue}>{f.money(m.amount)}</span>
              <span className={styles.track} aria-hidden="true">
                <span className={styles.series1} style={{ width: `${top > 0 ? (m.amount / top) * 100 : 0}%` }} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function CourtsCard({ o, f }: CardProps) {
  const { t } = useTranslation();
  const total = o.courts.reduce((s, c) => s + c.revenue, 0);
  return (
    <Section title={t('owner.overview.courts.title')}>
      <Table caption={t('owner.overview.courts.title')} bare>
        <thead>
          <tr>
            <th>{t('owner.overview.courts.court')}</th>
            <th className={styles.num}>{t('owner.overview.courts.revenue')}</th>
            <th>{t('owner.overview.courts.share')}</th>
            <th className={styles.num}>{t('owner.overview.courts.hours')}</th>
            <th className={styles.num}>{t('owner.overview.courts.use')}</th>
            <th className={styles.num}>{t('owner.overview.courts.change')}</th>
          </tr>
        </thead>
        <tbody>
          {o.courts.map((c) => {
            const share = total > 0 ? c.revenue / total : 0;
            const change = c.previousRevenue > 0 ? (c.revenue - c.previousRevenue) / c.previousRevenue : null;
            return (
              <tr key={c.id}>
                <td className={styles.strong}>{c.name}</td>
                <td className={styles.num}>{f.money(c.revenue)}</td>
                <td>
                  <span className={styles.share}>
                    <span className={styles.track} aria-hidden="true">
                      <span className={styles.series1} style={{ width: `${share * 100}%` }} />
                    </span>
                    {f.percent(share)}
                  </span>
                </td>
                <td className={styles.num}>{f.hours(c.minutes)}</td>
                <td className={styles.num}>{c.openMinutes > 0 ? f.percent(c.minutes / c.openMinutes) : '—'}</td>
                <td className={styles.num}>
                  {change === null ? (
                    <span className={styles.muted}>—</span>
                  ) : (
                    <Badge tone={change > 0 ? 'success' : change < 0 ? 'danger' : 'neutral'}>
                      <span aria-hidden="true">{change > 0 ? '▲ ' : change < 0 ? '▼ ' : ''}</span>
                      <span className={styles.srOnly}>{t(change > 0 ? 'owner.overview.up' : change < 0 ? 'owner.overview.down' : 'owner.overview.same')} </span>
                      {f.percent(Math.abs(change))}
                    </Badge>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </Section>
  );
}

function OutcomesCard({ o, f }: CardProps) {
  const { t } = useTranslation();
  const rows = OUTCOMES.filter((s) => (o.statuses[s] ?? 0) > 0);
  const total = rows.reduce((s, k) => s + o.statuses[k]!, 0);
  return (
    <Section title={t('owner.overview.outcomes.title')}>
      {rows.length === 0 ? (
        <p className={styles.muted}>{t('owner.overview.outcomes.none')}</p>
      ) : (
        <ul className={styles.bars}>
          {rows.map((s) => (
            <li key={s}>
              <span className={styles.barLabel}>
                <BookingStatusBadge status={s} />
              </span>
              <span className={styles.barValue}>
                {f.count(o.statuses[s]!)} <span className={styles.muted}>{f.percent(o.statuses[s]! / total)}</span>
              </span>
              <span className={styles.track} aria-hidden="true">
                <span className={styles[`tone-${BOOKING_TONE[s]}`]} style={{ width: `${(o.statuses[s]! / total) * 100}%` }} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function RecentCard({ o, f, venue }: CardProps & { venue: OwnerVenue }) {
  const { t } = useTranslation();
  const { ownerId } = useOwner();
  const bookingsPath = `/owner/${encodeURIComponent(ownerId)}/bookings`;
  return (
    <Section
      title={t('owner.overview.recent.title')}
      action={
        <Link to={`${bookingsPath}?venue=${encodeURIComponent(venue.id)}`} className={styles.link}>
          {t('owner.overview.recent.all')}
        </Link>
      }
    >
      {o.recent.length === 0 ? (
        <p className={styles.muted}>{t('owner.overview.recent.none')}</p>
      ) : (
        <Table caption={t('owner.overview.recent.title')} bare>
          <thead>
            <tr>
              <th>{t('owner.bookings.reference')}</th>
              <th>{t('owner.bookings.when')}</th>
              <th>{t('owner.bookings.turf')}</th>
              <th>{t('owner.bookings.customer')}</th>
              <th className={styles.num}>{t('owner.bookings.total')}</th>
              <th>{t('owner.bookings.status')}</th>
            </tr>
          </thead>
          <tbody>
            {o.recent.map((b) => {
              const start = b.slots.map((s) => s.startAt).sort()[0];
              return (
                <tr key={b.id}>
                  <td>
                    <Link to={`${bookingsPath}/${encodeURIComponent(b.id)}`} className={styles.ref}>
                      {b.reference}
                    </Link>
                  </td>
                  <td className={styles.nowrap}>
                    {formatDate(b.businessDate, o.timezone, f.lang)}
                    {start && <span className={styles.muted}> {formatTime(start, o.timezone, f.lang)}</span>}
                  </td>
                  <td>{b.turf?.name ?? '—'}</td>
                  <td className={styles.strong}>{customerLabel(b, t)}</td>
                  <td className={styles.num}>{f.money(b.total)}</td>
                  <td>
                    <BookingStatusBadge status={b.status} toVerify={awaitsVerification(b)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Section>
  );
}

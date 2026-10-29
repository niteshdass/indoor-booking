import { useTranslation } from 'react-i18next';
import { localParts } from '@booking/shared';
import type { OwnerBooking, OwnerSlotDay } from '../types';
import type { Courts } from './useTodayExtras';
import styles from './TodayPage.module.css';

const SHOWN = new Set(['pending', 'awaiting_payment', 'confirmed', 'completed']);
const DEFAULT_FROM = 8;
const DEFAULT_TO = 23;

type Kind = 'ok' | 'wait' | 'walk' | 'due';
type Block = {
  id: string;
  start: number;
  end: number;
  kind: Kind;
  label: string;
  status: OwnerBooking['status'];
  paymentStatus: OwnerBooking['paymentStatus'];
};
type Span = [start: number, end: number];
type Lane = { id: string; name: string; blocks: Block[]; closed: Span[] };

/** Wall-clock hours since midnight in the venue's timezone, e.g. 18.5 for 18:30. */
function hours(iso: string, tz: string): number {
  const [h, m] = localParts(new Date(iso), tz).hm.split(':').map(Number);
  return h! + m! / 60;
}

/** "18:30" -> 18.5; an end at or before its start (00:00) reads as midnight. */
function hmHours(hm: string, after?: number): number {
  const [h, m] = hm.split(':').map(Number);
  const v = h! + m! / 60;
  return after !== undefined && v <= after ? 24 : v;
}

const slotSpan = (s: { localStart: string; localEnd: string }): Span => {
  const start = hmHours(s.localStart);
  return [start, hmHours(s.localEnd, start)];
};

/** Closed parts of one court's day on the [from, to] axis: the whole day, outside its hours, and blocked slots. */
function closedSpans(day: OwnerSlotDay | undefined, from: number, to: number): Span[] {
  if (!day) return [];
  if (day.closed || day.slots.length === 0) return [[from, to]];
  const spans = day.slots.map(slotSpan);
  const open = Math.min(...spans.map((x) => x[0]));
  const close = Math.max(...spans.map((x) => x[1]));
  const out: Span[] = [];
  if (open > from) out.push([from, open]);
  day.slots.forEach((s, i) => s.status === 'blocked' && out.push(spans[i]!));
  if (close < to) out.push([close, to]);
  return out;
}

/** Booked and bookable hours across the courts; null without court data or when nothing is open. */
export function courtUsage(bookings: OwnerBooking[], courts: Courts | null, tz: string): { booked: number; open: number } | null {
  if (!courts) return null;
  let open = 0;
  for (const turf of courts.turfs) {
    const day = courts.days[turf.id];
    if (!day || day.closed) continue;
    for (const s of day.slots) {
      if (s.status === 'blocked') continue;
      const [a, b] = slotSpan(s);
      open += b - a;
    }
  }
  if (open === 0) return null;
  const ids = new Set(courts.turfs.map((x) => x.id));
  let booked = 0;
  for (const b of bookings) {
    if (!SHOWN.has(b.status) || !ids.has(b.turfId)) continue;
    for (const s of b.slots) {
      const start = hours(s.startAt, tz);
      const end = hours(s.endAt, tz);
      booked += (end <= start ? 24 : end) - start;
    }
  }
  return { booked: Math.min(booked, open), open };
}

/** Money still to collect on a booking that is going ahead. */
const DUE = new Set<OwnerBooking['paymentStatus']>(['unpaid', 'partially_paid']);

function kindOf(b: OwnerBooking): Kind {
  if (b.status === 'pending' || b.status === 'awaiting_payment') return 'wait';
  // Before walk-in: an unpaid walk-in is exactly the one staff must not forget to collect.
  if (DUE.has(b.paymentStatus) && b.total > 0) return 'due';
  return b.source === 'walkin' ? 'walk' : 'ok';
}

/**
 * Lanes per court with each live booking placed on the day's hour axis. With court data every active court gets a
 * lane (even with no bookings), the axis covers its opening hours, and closed time is marked.
 */
export function buildLanes(
  bookings: OwnerBooking[],
  tz: string,
  courts: Courts | null = null,
): { lanes: Lane[]; from: number; to: number } {
  const lanes = new Map<string, Lane>();
  let from = DEFAULT_FROM;
  let to = DEFAULT_TO;
  for (const turf of courts?.turfs ?? []) {
    lanes.set(turf.id, { id: turf.id, name: turf.name, blocks: [], closed: [] });
    for (const s of courts!.days[turf.id]?.slots ?? []) {
      const [a, b] = slotSpan(s);
      from = Math.min(from, Math.floor(a));
      to = Math.max(to, Math.ceil(b));
    }
  }
  for (const b of bookings) {
    if (!SHOWN.has(b.status) || b.slots.length === 0) continue;
    const start = Math.min(...b.slots.map((s) => hours(s.startAt, tz)));
    const lastEnd = hours(b.slots.map((s) => s.endAt).sort().at(-1)!, tz);
    const end = lastEnd <= start ? 24 : lastEnd; // a slot ending at midnight reads as 00:00
    from = Math.min(from, Math.floor(start));
    to = Math.max(to, Math.ceil(end));
    const lane = lanes.get(b.turfId) ?? { id: b.turfId, name: b.turf?.name ?? '—', blocks: [], closed: [] };
    lane.blocks.push({
      id: b.id,
      start,
      end,
      kind: kindOf(b),
      label: b.customer?.name ?? b.reference,
      status: b.status,
      paymentStatus: b.paymentStatus,
    });
    lanes.set(b.turfId, lane);
  }
  for (const lane of lanes.values()) lane.closed = closedSpans(courts?.days[lane.id], from, to);
  return { lanes: [...lanes.values()].sort((a, b) => a.name.localeCompare(b.name)), from, to };
}

/** Hours since local midnight as "HH:MM". */
const clock = (h: number) => {
  const m = Math.round(h * 60);
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

export function CourtTimeline({
  bookings,
  timezone,
  courts = null,
  now = new Date(),
}: {
  bookings: OwnerBooking[];
  timezone: string;
  courts?: Courts | null;
  now?: Date;
}) {
  const { t } = useTranslation();
  const { lanes, from, to } = buildLanes(bookings, timezone, courts);
  const anyClosed = lanes.some((l) => l.closed.length > 0);
  if (lanes.length === 0) return null;
  const span = to - from;
  const pct = (h: number) => `${((h - from) / span) * 100}%`;
  const nowH = hours(now.toISOString(), timezone);
  const showNow = nowH >= from && nowH <= to;
  const ticks = Array.from({ length: span + 1 }, (_, i) => from + i);

  return (
    <section className={styles.panel} aria-labelledby="today-courts">
      <div className={styles.panelHead}>
        <h2 id="today-courts" className={styles.heading}>
          {t('owner.today.courts')}
        </h2>
        <ul className={styles.legend}>
          <li className={styles.ok}>{t('owner.today.legendPaid')}</li>
          <li className={styles.due}>{t('owner.today.legendDue')}</li>
          <li className={styles.wait}>{t('owner.today.legendWaiting')}</li>
          <li className={styles.walk}>{t('owner.today.legendWalkIn')}</li>
          {anyClosed && <li className={styles.closedKey}>{t('owner.today.legendClosed')}</li>}
        </ul>
      </div>
      <div className={styles.timelineScroll}>
        <div className={styles.timeline}>
          <div className={styles.axis} aria-hidden="true">
            {ticks.map((h) => (
              <span key={h} style={{ left: pct(h) }}>
                {String(h % 24).padStart(2, '0')}
              </span>
            ))}
          </div>
          {lanes.map((lane) => (
            <div key={lane.id} className={styles.lane}>
              <span className={styles.laneName}>{lane.name}</span>
              <div className={styles.track} style={{ ['--hours' as string]: span }}>
                {lane.closed.map(([a, b]) => (
                  <span key={`c${a}`} className={styles.closed} style={{ left: pct(a), width: `${((b - a) / span) * 100}%` }} aria-hidden="true" />
                ))}
                {lane.blocks.map((b) => (
                  <span
                    key={b.id}
                    className={`${styles.block} ${styles[b.kind]}`}
                    style={{ left: pct(b.start), width: `${((b.end - b.start) / span) * 100}%` }}
                    title={`${b.label}, ${clock(b.start)}–${clock(b.end)}, ${t(`status.${b.status}`)}, ${t(`paymentStatus.${b.paymentStatus}`)}`}
                  >
                    <span className={styles.blockLabel}>{b.label}</span>
                  </span>
                ))}
                {showNow && <span className={styles.now} style={{ left: pct(nowH) }} aria-hidden="true" />}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

import { useTranslation } from 'react-i18next';
import { localParts } from '@booking/shared';
import type { OwnerBooking } from '../types';
import styles from './TodayPage.module.css';

const SHOWN = new Set(['pending', 'awaiting_payment', 'confirmed', 'completed']);
const DEFAULT_FROM = 8;
const DEFAULT_TO = 23;

type Kind = 'ok' | 'wait' | 'walk';
type Block = { id: string; start: number; end: number; kind: Kind; label: string; status: OwnerBooking['status'] };
type Lane = { id: string; name: string; blocks: Block[] };

/** Wall-clock hours since midnight in the venue's timezone, e.g. 18.5 for 18:30. */
function hours(iso: string, tz: string): number {
  const [h, m] = localParts(new Date(iso), tz).hm.split(':').map(Number);
  return h! + m! / 60;
}

function kindOf(b: OwnerBooking): Kind {
  if (b.status === 'pending' || b.status === 'awaiting_payment') return 'wait';
  return b.source === 'walkin' ? 'walk' : 'ok';
}

/** Lanes per court with each live booking placed on the day's hour axis. */
export function buildLanes(bookings: OwnerBooking[], tz: string): { lanes: Lane[]; from: number; to: number } {
  const lanes = new Map<string, Lane>();
  let from = DEFAULT_FROM;
  let to = DEFAULT_TO;
  for (const b of bookings) {
    if (!SHOWN.has(b.status) || b.slots.length === 0) continue;
    const start = Math.min(...b.slots.map((s) => hours(s.startAt, tz)));
    const lastEnd = hours(b.slots.map((s) => s.endAt).sort().at(-1)!, tz);
    const end = lastEnd <= start ? 24 : lastEnd; // a slot ending at midnight reads as 00:00
    from = Math.min(from, Math.floor(start));
    to = Math.max(to, Math.ceil(end));
    const lane = lanes.get(b.turfId) ?? { id: b.turfId, name: b.turf?.name ?? '—', blocks: [] };
    lane.blocks.push({ id: b.id, start, end, kind: kindOf(b), label: b.customer?.name ?? b.reference, status: b.status });
    lanes.set(b.turfId, lane);
  }
  return { lanes: [...lanes.values()].sort((a, b) => a.name.localeCompare(b.name)), from, to };
}

export function CourtTimeline({ bookings, timezone, now = new Date() }: { bookings: OwnerBooking[]; timezone: string; now?: Date }) {
  const { t } = useTranslation();
  const { lanes, from, to } = buildLanes(bookings, timezone);
  if (lanes.length === 0) return null;
  const span = to - from;
  const pct = (h: number) => `${((h - from) / span) * 100}%`;
  const nowH = hours(now.toISOString(), timezone);
  const showNow = nowH >= from && nowH <= to;
  const ticks = Array.from({ length: span + 1 }, (_, i) => from + i);

  return (
    <section className={styles.timelineCard} aria-labelledby="today-courts">
      <div className={styles.timelineHead}>
        <h2 id="today-courts" className={styles.heading}>
          {t('owner.today.courts')}
        </h2>
        <ul className={styles.legend}>
          <li className={styles.ok}>{t('owner.today.legendPaid')}</li>
          <li className={styles.wait}>{t('owner.today.legendWaiting')}</li>
          <li className={styles.walk}>{t('owner.today.legendWalkIn')}</li>
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
                {lane.blocks.map((b) => (
                  <span
                    key={b.id}
                    className={`${styles.block} ${styles[b.kind]}`}
                    style={{ left: pct(b.start), width: `${((b.end - b.start) / span) * 100}%` }}
                    title={`${b.label}, ${t(`status.${b.status}`)}`}
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

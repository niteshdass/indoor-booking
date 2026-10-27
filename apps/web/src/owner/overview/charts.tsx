import { useState, type ReactNode } from 'react';
import styles from './overview.module.css';

/** Tiny trend line under a KPI; decorative, the tile states the numbers. */
export function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(...values, 0);
  const points =
    values.length < 2 || max === 0
      ? '0,31 100,31'
      : values.map((v, i) => `${(i / (values.length - 1)) * 100},${31 - (v / max) * 29}`).join(' ');
  return (
    <svg className={styles.spark} viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <polyline points={points} />
    </svg>
  );
}

/** Axis ticks from 0 in a round step (at most 4 steps), the step never below `minStep` (1 for counts). */
export function niceTicks(max: number, minStep = 0): number[] {
  if (max <= 0) return [0, 1, 2, 3, 4].map((i) => i * Math.max(minStep, 1));
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(minStep, [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw);
  return Array.from({ length: Math.ceil(max / step) + 1 }, (_, i) => i * step);
}

export type TrendSeries = { key: string; label: string; values: number[] };

type TrendProps = {
  /** Stacked from the baseline up, in legend order. */
  stacks: TrendSeries[];
  /** The previous period, aligned by day, drawn as a dashed line. */
  previous: number[];
  dates: string[];
  dateLabel: (date: string) => string;
  format: (value: number) => string;
  tooltip: (i: number) => ReactNode;
  label: string;
  /** Smallest axis step, so a count axis never shows fractions. */
  minStep?: number;
};

/** Daily stacked bars with the previous period as a dashed line; hover or focus a day for its numbers. */
export function TrendChart({ stacks, previous, dates, dateLabel, format, tooltip, label, minStep }: TrendProps) {
  const [active, setActive] = useState<number | null>(null);
  const totals = dates.map((_, i) => stacks.reduce((s, x) => s + (x.values[i] ?? 0), 0));
  const ticks = niceTicks(Math.max(...totals, ...previous), minStep);
  const top = ticks[ticks.length - 1]!;
  const n = dates.length;
  const linePoints = previous.map((v, i) => `${((i + 0.5) / n) * 100},${100 - (v / top) * 100}`).join(' ');
  const labelEvery = Math.ceil(n / 6);

  return (
    <div className={styles.trend} role="group" aria-label={label}>
      <div className={styles.axis} aria-hidden="true">
        {[...ticks].reverse().map((tick) => (
          <span key={tick}>{format(tick)}</span>
        ))}
      </div>
      <div className={styles.plot} onMouseLeave={() => setActive(null)}>
        {ticks.map((tick) => (
          <span key={tick} className={styles.grid} style={{ bottom: `${(tick / top) * 100}%` }} aria-hidden="true" />
        ))}
        <svg className={styles.prevLine} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <polyline points={linePoints} />
        </svg>
        <div className={styles.columns} data-dense={n > 31 || undefined}>
          {dates.map((date, i) => (
            <button
              key={date}
              type="button"
              className={styles.day}
              data-active={active === i || undefined}
              aria-label={`${dateLabel(date)}: ${format(totals[i]!)}`}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
            >
              <span className={styles.column} style={{ height: `${(totals[i]! / top) * 100}%` }}>
                {stacks.map((s, k) =>
                  (s.values[i] ?? 0) > 0 ? (
                    <span key={s.key} className={styles[`series${k + 1}`]} style={{ flexGrow: s.values[i] }} />
                  ) : null,
                )}
              </span>
            </button>
          ))}
        </div>
        {active !== null && (
          <div
            className={styles.tooltip}
            data-side={active > n / 2 ? 'start' : 'end'}
            style={{ insetInlineStart: `${((active + 0.5) / n) * 100}%` }}
            role="status"
          >
            <strong>{dateLabel(dates[active]!)}</strong>
            {tooltip(active)}
          </div>
        )}
      </div>
      <div className={styles.xLabels} aria-hidden="true">
        {dates.map((date, i) => (
          <span key={date}>{i % labelEvery === 0 ? dateLabel(date) : ''}</span>
        ))}
      </div>
    </div>
  );
}

/** Ring of shares with a 2px surface gap between segments; the legend beside it carries the numbers. */
export function Donut({ parts, children }: { parts: { key: string; value: number; className: string }[]; children: ReactNode }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  const r = 15.9155; // circumference 100
  const visible = parts.filter((p) => p.value > 0);
  const gap = visible.length > 1 ? 0.8 : 0;
  let offset = 25;
  return (
    <div className={styles.donut}>
      <svg viewBox="0 0 42 42" aria-hidden="true" focusable="false">
        <circle className={styles.donutTrack} cx="21" cy="21" r={r} />
        {total > 0 &&
          visible.map((p) => {
            const share = (p.value / total) * 100;
            const el = (
              <circle
                key={p.key}
                className={p.className}
                cx="21"
                cy="21"
                r={r}
                strokeDasharray={`${Math.max(share - gap, 0.1)} ${100 - Math.max(share - gap, 0.1)}`}
                strokeDashoffset={offset}
              />
            );
            offset -= share;
            return el;
          })}
      </svg>
      <div className={styles.donutCenter}>{children}</div>
    </div>
  );
}

import type { ReactNode } from 'react';
import { Icon } from '../components/ui/Icon';
import styles from './onboarding.module.css';

export type Tile<T extends string> = { value: T; label: string; hint?: string; art?: ReactNode };

type Common<T extends string> = {
  legend: string;
  /** Says what to do, under the legend: "Pick all you have". */
  hint?: string;
  options: Tile<T>[];
  /** `wide` tiles hold a drawing; `chip` tiles are short words such as weekdays. */
  size?: 'wide' | 'chip';
  error?: string;
};

function Group<T extends string>({ legend, hint, size, error, children }: Common<T> & { children: ReactNode }) {
  return (
    <fieldset className={styles.group} aria-invalid={error ? true : undefined}>
      <legend className={styles.legend}>{legend}</legend>
      {hint && <p className={styles.groupHint}>{hint}</p>}
      <div className={[styles.tiles, size && styles[size]].filter(Boolean).join(' ')}>{children}</div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}

function TileBody<T extends string>({ o, on }: { o: Tile<T>; on: boolean }) {
  return (
    <>
      {o.art && <span className={styles.art}>{o.art}</span>}
      <span className={styles.tileText}>
        <span className={styles.tileLabel}>{o.label}</span>
        {o.hint && <span className={styles.tileHint}>{o.hint}</span>}
      </span>
      <Icon name="check" className={[styles.tick, on && styles.tickOn].filter(Boolean).join(' ')} />
    </>
  );
}

/** One answer from big tappable tiles (radio group). */
export function ChoiceTiles<T extends string>(props: Common<T> & { name: string; value: T; onChange(v: T): void }) {
  const { name, value, onChange, options } = props;
  return (
    <Group {...props}>
      {options.map((o) => (
        <label key={o.value} className={styles.tile}>
          <input className={styles.input} type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
          <TileBody o={o} on={value === o.value} />
        </label>
      ))}
    </Group>
  );
}

/** Any number of answers from big tappable tiles (checkboxes). */
export function PickTiles<T extends string>(props: Common<T> & { value: readonly T[]; onChange(v: T[]): void }) {
  const { value, onChange, options } = props;
  const toggle = (v: T) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <Group {...props}>
      {options.map((o) => (
        <label key={o.value} className={styles.tile}>
          <input className={styles.input} type="checkbox" checked={value.includes(o.value)} onChange={() => toggle(o.value)} />
          <TileBody o={o} on={value.includes(o.value)} />
        </label>
      ))}
    </Group>
  );
}

/** A count with big minus and plus buttons; the number itself can be typed too. */
export function Counter({
  label,
  value,
  min,
  max,
  onChange,
  less,
  more,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange(n: number): void;
  less: string;
  more: string;
}) {
  return (
    <div className={styles.counter} role="group" aria-label={label}>
      <button type="button" className={styles.countBtn} aria-label={less} disabled={value <= min} onClick={() => onChange(value - 1)}>
        <Icon name="minus" />
      </button>
      <input
        className={styles.count}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <button type="button" className={styles.countBtn} aria-label={more} disabled={value >= max} onClick={() => onChange(value + 1)}>
        <Icon name="plus" />
      </button>
    </div>
  );
}

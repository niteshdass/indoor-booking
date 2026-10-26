import styles from './StatCard.module.css';

export type StatCardProps = {
  label: string;
  value: string;
  hint?: string;
  /** Warning draws the eye to a number someone has to act on. */
  tone?: 'warning';
  /** 0–1 share shown as a bar under the value; the value text carries the same number for screen readers. */
  meter?: number;
};

export function StatCard({ label, value, hint, tone, meter }: StatCardProps) {
  return (
    <div className={[styles.card, tone && styles[tone]].filter(Boolean).join(' ')}>
      <p className={styles.label}>{label}</p>
      <p className={styles.value}>{value}</p>
      {meter !== undefined && (
        <span className={styles.meter} aria-hidden="true">
          <span style={{ width: `${Math.round(Math.min(Math.max(meter, 0), 1) * 100)}%` }} />
        </span>
      )}
      {hint && <p className={styles.hint}>{hint}</p>}
    </div>
  );
}

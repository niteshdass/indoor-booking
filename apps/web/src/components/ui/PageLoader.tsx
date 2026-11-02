import styles from './PageLoader.module.css';

/**
 * Full-page wait (auth check, portal data): a top-down court whose chalk lines draw in
 * while the ball rallies across the net. Shows after a short delay so fast loads never flash it.
 */
export function PageLoader({ label }: { label: string }) {
  return (
    <div className={styles.root} role="status" aria-live="polite">
      <div className={styles.stage}>
        <svg className={styles.court} viewBox="0 0 80 48" aria-hidden="true" focusable="false">
          <rect className={styles.surface} x="1" y="1" width="78" height="46" rx="4" />
          <g className={styles.lines}>
            <rect x="6" y="6" width="68" height="36" rx="1" pathLength={1} />
            <path d="M40 4v40" pathLength={1} />
            <path d="M22 6v36M58 6v36M22 24h36" pathLength={1} />
          </g>
        </svg>
        <span className={styles.shadow} aria-hidden="true" />
        <span className={styles.ball} aria-hidden="true" />
      </div>
      <span className={styles.label}>{label}</span>
    </div>
  );
}

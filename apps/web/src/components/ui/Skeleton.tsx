import styles from './Skeleton.module.css';

export type SkeletonKind = 'dashboard' | 'table' | 'detail' | 'list';

const ROWS = 6;

/**
 * Placeholder in the shape of the page that is loading, so content lands where the eye already is.
 * Use for page or section loads; buttons and small inline waits keep the Spinner.
 */
export function Skeleton({ kind = 'table', label }: { kind?: SkeletonKind; label: string }) {
  return (
    <div role="status" aria-label={label} className={styles.root}>
      {kind === 'dashboard' && (
        <>
          <div className={styles.stats}>
            {Array.from({ length: 4 }, (_, i) => (
              <span key={i} className={`${styles.block} ${styles.stat}`} />
            ))}
          </div>
          <span className={`${styles.block} ${styles.panel}`} />
        </>
      )}
      {kind === 'detail' && (
        <>
          <span className={`${styles.block} ${styles.heading}`} />
          <span className={`${styles.block} ${styles.panel}`} />
        </>
      )}
      {(kind === 'table' || kind === 'dashboard') && (
        <div className={styles.table}>
          {Array.from({ length: ROWS }, (_, i) => (
            <span key={i} className={styles.row}>
              <span className={`${styles.block} ${styles.cellWide}`} />
              <span className={`${styles.block} ${styles.cell}`} />
              <span className={`${styles.block} ${styles.cell}`} />
            </span>
          ))}
        </div>
      )}
      {kind === 'list' &&
        Array.from({ length: 3 }, (_, i) => (
          <span key={i} className={`${styles.block} ${styles.item}`} />
        ))}
    </div>
  );
}

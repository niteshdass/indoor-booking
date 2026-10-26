import styles from './LogoMark.module.css';

/** Top-down court square: the product mark (design-system.md "Hard court"). */
export function LogoMark() {
  return (
    <svg className={styles.mark} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="2" y="2" width="20" height="20" rx="4" />
      <path d="M12 2v20M2 12h20" />
    </svg>
  );
}

import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './SkipLink.module.css';

/** First tab stop on every page: jumps past the header and nav to the page's `<main>`. */
export function SkipLink() {
  const { t } = useTranslation();

  // Pages render their own <main>, so find it on click instead of relying on a fixed id.
  function skip(e: MouseEvent<HTMLAnchorElement>) {
    const main = document.querySelector<HTMLElement>('main');
    if (!main) return;
    e.preventDefault();
    if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
    main.focus();
    main.scrollIntoView?.();
  }

  return (
    <a href="#main" className={styles.skip} onClick={skip}>
      {t('nav.skip')}
    </a>
  );
}

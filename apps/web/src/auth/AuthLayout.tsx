import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '../components/ui/Badge';
import { Icon } from '../components/ui/Icon';
import styles from './AuthLayout.module.css';

/**
 * Sign-in and sign-up page: the form card beside a court panel (top-down padel court in chalk lines, the ball and a
 * booked-slot ticket). From lg the panel sits on the start side with a headline; below lg it is a short band above the card.
 */
export function AuthLayout({ variant, children }: { variant: 'login' | 'register'; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <main className={styles.page}>
      <div className={styles.split}>
        <aside className={styles.art}>
          <div className={styles.scene} aria-hidden="true">
            <div className={styles.court} />
            <svg className={styles.lines} viewBox="0 0 260 150" preserveAspectRatio="none" focusable="false">
              <rect x="1" y="1" width="258" height="148" />
              <line x1="130" y1="1" x2="130" y2="149" />
              <line x1="62" y1="1" x2="62" y2="149" />
              <line x1="198" y1="1" x2="198" y2="149" />
              <line x1="62" y1="75" x2="198" y2="75" />
            </svg>
            <span className={styles.ball} />
            <div className={styles.ticket}>
              <span className={styles.ticketIcon}>
                <Icon name="calendarCheck" />
              </span>
              <span className={styles.ticketText}>
                <span className={styles.ticketCourt}>{t('auth.art.court')}</span>
                <span className={styles.ticketTime}>{t('auth.art.time')}</span>
              </span>
              <Badge tone="success">{t('auth.art.booked')}</Badge>
            </div>
          </div>
          <div className={styles.copy}>
            <p className={styles.headline}>{t(`auth.art.${variant}.title`)}</p>
            <p className={styles.sub}>{t(`auth.art.${variant}.sub`)}</p>
          </div>
        </aside>
        <div className={styles.formSide}>{children}</div>
      </div>
    </main>
  );
}

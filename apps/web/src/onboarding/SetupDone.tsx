import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SetupResult } from '@booking/shared';
import { Button } from '../components/ui/Button';
import { Icon } from '../components/ui/Icon';
import styles from './onboarding.module.css';

/** After the setup: what happens next, and the first things to do with the new venue. */
export function SetupDone({ result }: { result: SetupResult }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const { owner, venue } = result;
  const pending = owner.status !== 'active';
  const base = `/owner/${encodeURIComponent(owner.id)}`;
  const at = `?venue=${encodeURIComponent(venue.id)}`;
  const link = `${window.location.origin}/venues/${venue.slug}`;

  // The setup screen is gone: start reading, and the page, from the news.
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    if (window.scrollY > 0) window.scrollTo(0, 0);
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className={styles.wizard}>
      <section className={`${styles.screen} ${styles.done}`} aria-labelledby="setup-done">
        <span className={styles.doneMark}>
          <Icon name="check" />
        </span>
        <div className={styles.ask}>
          <h1 ref={heading} id="setup-done" tabIndex={-1} className={styles.question}>
            {t(pending ? 'onboarding.done.pendingTitle' : 'onboarding.done.title')}
          </h1>
          <p className={styles.lead}>{t(pending ? 'onboarding.done.pendingLead' : venue.published ? 'onboarding.done.lead' : 'onboarding.done.hiddenLead')}</p>
        </div>
        {pending ? (
          <Button variant="brand" size="lg" block to="/owner">
            {t('onboarding.done.status')}
          </Button>
        ) : (
          <>
            <div className={styles.actions}>
              <Button variant="brand" size="lg" icon="plus" to={`${base}/walk-in${at}`}>
                {t('onboarding.done.book')}
              </Button>
              <Button variant="secondary" size="lg" icon="calendar" to={`${base}/today${at}`}>
                {t('onboarding.done.today')}
              </Button>
            </div>
            {venue.published && (
              <div className={styles.group}>
                <p className={styles.legend}>{t('onboarding.done.share')}</p>
                <p className={styles.groupHint}>{t('onboarding.done.shareHint')}</p>
                <div className={styles.link}>
                  <span className={styles.linkText}>{link}</span>
                  <Button variant="secondary" icon={copied ? 'check' : 'copy'} onClick={() => void copy()}>
                    {t(copied ? 'onboarding.done.copied' : 'onboarding.done.copy')}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

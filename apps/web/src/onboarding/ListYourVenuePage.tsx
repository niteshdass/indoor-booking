import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/useAuth';
import { LOCALES, type BusinessSetup, type Locale, type SetupResult } from '@booking/shared';
import { apiPost } from '../lib/apiClient';
import { defaultZoneFor } from '../lib/regions';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { defaultAnswers, toBusinessSetup } from './answers';
import { SetupDone } from './SetupDone';
import { SetupWizard } from './SetupWizard';
import styles from './onboarding.module.css';

/**
 * `/list-your-venue`: a signed-in player sets up their business and first venue in one go. The business waits for
 * approval unless the platform approves automatically.
 */
export function ListYourVenuePage() {
  const { t, i18n } = useTranslation();
  useDocumentTitle(t('apply.title'));
  const { user } = useAuth();
  const locale: Locale = (LOCALES as readonly string[]).includes(i18n.language) ? (i18n.language as Locale) : 'en';

  return (
    <main className={styles.page}>
      <SetupWizard
        mode="business"
        // Per user, so another account signed in on this browser never sees this one's draft.
        draftKey={`setup-draft:user:${user?.id ?? ''}`}
        initial={defaultAnswers()}
        mapLinkPath="/onboarding/map-link"
        submit={(a) =>
          apiPost<SetupResult>(
            '/onboarding',
            toBusinessSetup(a, a.timezone || defaultZoneFor(a.country), locale, (n) => t('onboarding.turfs.numbered', { n })) satisfies BusinessSetup,
          )
        }
        done={(result) => <SetupDone result={result} />}
      />
    </main>
  );
}

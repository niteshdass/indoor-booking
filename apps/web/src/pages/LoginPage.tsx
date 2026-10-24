import { useTranslation } from 'react-i18next';

/** Placeholder until the auth screens land. */
export function LoginPage() {
  const { t } = useTranslation();
  return (
    <main>
      <h1>{t('auth.login.title')}</h1>
    </main>
  );
}

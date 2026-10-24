import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiGet } from '../lib/apiClient';

type Health = { status: string; db: 'up' | 'down' };

export function HomePage() {
  const { t } = useTranslation();
  const [apiStatus, setApiStatus] = useState<string>('…');

  useEffect(() => {
    let active = true;
    apiGet<Health>('/health')
      .then((h) => active && setApiStatus(h.db === 'up' ? h.status : 'down'))
      .catch(() => active && setApiStatus('down'));
    return () => {
      active = false;
    };
  }, []);

  return (
    <main>
      <h1>{t('home.title')}</h1>
      <p>{t('home.apiStatus', { status: apiStatus })}</p>
    </main>
  );
}

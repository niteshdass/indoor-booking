import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { LOCALES, type Locale } from '@booking/shared';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { TextField } from '../components/ui/TextField';
import { ApiError, apiPost } from '../lib/apiClient';
import { errorMessage } from '../lib/errors';
import { countryOptions, currencyOptions } from '../lib/regions';
import styles from '../auth/auth.module.css';

const NAME_MAX = 100;

/** `/list-your-venue`: a signed-in player applies to run a business; it starts pending until an admin approves it. */
export function ApplyPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const lang: Locale = (LOCALES as readonly string[]).includes(i18n.language) ? (i18n.language as Locale) : 'en';
  const [name, setName] = useState('');
  const [country, setCountry] = useState('');
  const [currency, setCurrency] = useState('');
  const [locale, setLocale] = useState<Locale>(lang);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; pending: boolean } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiPost('/owners', { name: name.trim(), country, currency, locale });
      navigate('/owner', { replace: true });
    } catch (err) {
      setError({ message: errorMessage(err, t), pending: err instanceof ApiError && err.code === 'application_pending' });
      setBusy(false);
    }
  };

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>{t('apply.title')}</h1>
        <p className={styles.sent}>{t('apply.lead')}</p>
        {error && (
          <Alert tone={error.pending ? 'info' : 'danger'}>
            {error.message}
            {error.pending && (
              <>
                {' '}
                <Link to="/owner">{t('apply.seeStatus')}</Link>
              </>
            )}
          </Alert>
        )}
        <form className={styles.form} onSubmit={(e) => void submit(e)}>
          <TextField
            label={t('apply.name')}
            hint={t('apply.nameHint')}
            required
            maxLength={NAME_MAX}
            autoComplete="organization"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Select
            layout="stacked"
            label={t('apply.country')}
            required
            value={country}
            options={[{ value: '', label: t('apply.choose') }, ...countryOptions(i18n.language, country)]}
            onChange={(e) => setCountry(e.target.value)}
          />
          <Select
            layout="stacked"
            label={t('apply.currency')}
            hint={t('apply.currencyHint')}
            required
            value={currency}
            options={[{ value: '', label: t('apply.choose') }, ...currencyOptions(i18n.language, currency)]}
            onChange={(e) => setCurrency(e.target.value)}
          />
          <Select
            layout="stacked"
            label={t('apply.language')}
            value={locale}
            options={LOCALES.map((l) => ({ value: l, label: t(`apply.locale.${l}`) }))}
            onChange={(e) => setLocale(e.target.value as Locale)}
          />
          <Button type="submit" variant="brand" size="lg" block loading={busy} disabled={!name.trim() || !country || !currency}>
            {t('apply.submit')}
          </Button>
        </form>
        <p className={styles.sent}>{t('apply.review')}</p>
      </div>
    </main>
  );
}

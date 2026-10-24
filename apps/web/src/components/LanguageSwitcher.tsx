import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES } from '../i18n';
import { Select } from './ui/Select';

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  return (
    <Select
      size="lg"
      label={t('language.label')}
      value={i18n.language}
      onChange={(e) => void i18n.changeLanguage(e.target.value)}
      options={SUPPORTED_LANGUAGES.map((lng) => ({ value: lng, label: t(`language.${lng}`) }))}
    />
  );
}

import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES } from '../i18n';
import { HeaderMenu, MenuGlyph } from './HeaderMenu';
import { Select } from './ui/Select';

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  return (
    <Select
      size="lg"
      icon="language"
      hideLabel
      label={t('language.label')}
      value={i18n.language}
      onChange={(e) => void i18n.changeLanguage(e.target.value)}
      options={SUPPORTED_LANGUAGES.map((lng) => ({ value: lng, label: t(`language.${lng}`) }))}
    />
  );
}

/** Header variant: globe button with the language code, opening a menu. */
export function LanguageMenu() {
  const { t, i18n } = useTranslation();
  const lng = i18n.resolvedLanguage ?? i18n.language;
  return (
    <HeaderMenu
      label={t('language.label')}
      icon={<MenuGlyph name="globe" />}
      badge={lng.slice(0, 2).toUpperCase()}
      value={lng}
      onChange={(v) => void i18n.changeLanguage(v)}
      options={SUPPORTED_LANGUAGES.map((l) => ({ value: l, label: t(`language.${l}`) }))}
    />
  );
}

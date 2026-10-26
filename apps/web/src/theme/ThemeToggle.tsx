import { useTranslation } from 'react-i18next';
import { HeaderMenu, MenuGlyph } from '../components/HeaderMenu';
import { Select } from '../components/ui/Select';
import { useTheme, type Theme } from './ThemeProvider';

const THEMES: Theme[] = ['system', 'light', 'dark'];

export function ThemeToggle() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  return (
    <Select
      size="lg"
      hideLabel
      label={t('theme.label')}
      value={theme}
      onChange={(e) => setTheme(e.target.value as Theme)}
      options={THEMES.map((v) => ({ value: v, label: t(`theme.${v}`) }))}
    />
  );
}

const THEME_GLYPH = { system: 'monitor', light: 'sun', dark: 'moon' } as const;

/** Header variant: icon button showing the current theme, opening a menu. */
export function ThemeMenu() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  return (
    <HeaderMenu
      label={t('theme.label')}
      icon={<MenuGlyph name={THEME_GLYPH[theme]} />}
      value={theme}
      onChange={(v) => setTheme(v as Theme)}
      options={THEMES.map((v) => ({
        value: v,
        label: t(`theme.${v}`),
        icon: <MenuGlyph name={THEME_GLYPH[v]} />,
      }))}
    />
  );
}

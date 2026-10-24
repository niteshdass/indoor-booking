import { useTranslation } from 'react-i18next';
import { Select } from '../components/ui/Select';
import { useTheme, type Theme } from './ThemeProvider';

const THEMES: Theme[] = ['system', 'light', 'dark'];

export function ThemeToggle() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  return (
    <Select
      label={t('theme.label')}
      value={theme}
      onChange={(e) => setTheme(e.target.value as Theme)}
      options={THEMES.map((v) => ({ value: v, label: t(`theme.${v}`) }))}
    />
  );
}

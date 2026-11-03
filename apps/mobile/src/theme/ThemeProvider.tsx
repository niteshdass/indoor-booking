import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { dark, light } from './tokens';

export type Scheme = 'light' | 'dark';
export type Theme = { t: typeof light; scheme: Scheme };

const ThemeContext = createContext<Theme | null>(null);

/** Follows the system setting; there is no in-app override. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme: Scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const value = useMemo<Theme>(() => ({ t: scheme === 'dark' ? dark : light, scheme }), [scheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('useTheme must be used inside <ThemeProvider>');
  return theme;
}

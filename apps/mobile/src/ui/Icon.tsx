import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';

/** The web line icons (apps/web/src/components/ui/Icon.tsx): 24-unit grid, round caps, one stroke colour. Same paths. */
const PATHS = {
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4',
  calendar: 'M5.5 5h13a2 2 0 0 1 2 2v11.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2ZM3.5 10h17M8 3v4M16 3v4',
  person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 20.5c.9-3.8 3.9-6 7.5-6s6.6 2.2 7.5 6',
  locate: 'M12 19a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM12 2v3M12 19v3M2 12h3M19 12h3',
  close: 'M6 6l12 12M18 6 6 18',
  tag: 'M3 12.2V4.5A1.5 1.5 0 0 1 4.5 3h7.7l8.5 8.5a1.5 1.5 0 0 1 0 2.1l-7.1 7.1a1.5 1.5 0 0 1-2.1 0L3 12.2ZM7.75 9a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Z',
  check: 'M5 12.5 10 17.5 19 7',
  arrowLeft: 'M19 12H5M11 6l-6 6 6 6',
} as const;

export type IconName = keyof typeof PATHS;

export interface IconProps {
  name: IconName;
  color: string;
  size?: number;
}

/** Decorative: hidden from screen readers; the control around it carries the name. */
export function Icon({ name, color, size }: IconProps) {
  const { t } = useTheme();
  const s = size ?? t.iconMd;
  return (
    <Svg width={s} height={s} viewBox="0 0 24 24" fill="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Path d={PATHS[name]} stroke={color} strokeWidth={t.iconStroke} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

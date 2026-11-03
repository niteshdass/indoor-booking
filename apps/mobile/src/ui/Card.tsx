import { View, type ViewProps } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

/** Flat card: a tint on the page, no border and no resting shadow (design-system "Hard court"). */
export function Card({ style, ...rest }: ViewProps) {
  const { t } = useTheme();
  return (
    <View
      {...rest}
      style={[{ backgroundColor: t.bgSurface, borderRadius: t.radiusLg, padding: t.space4, gap: t.space3 }, style]}
    />
  );
}

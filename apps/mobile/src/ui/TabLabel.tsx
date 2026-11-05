import { View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

/** Label with an underline the width of the text; only the current tab's underline shows. */
export function TabLabel({ label, focused }: { label: string; focused: boolean }) {
  const { t } = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: t.space1 }}>
      <Text variant="caption" weight="semibold" tone={focused ? 'primary' : 'muted'} numberOfLines={1}>
        {label}
      </Text>
      <View
        style={{
          alignSelf: 'stretch',
          height: t.tabUnderline,
          borderRadius: t.radiusFull,
          backgroundColor: focused ? t.primary : 'transparent',
        }}
      />
    </View>
  );
}

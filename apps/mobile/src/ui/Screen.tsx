import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';

export interface ScreenProps {
  children: ReactNode;
  scroll?: boolean;
}

export function Screen({ children, scroll = false }: ScreenProps) {
  const { t } = useTheme();
  const padding = { padding: t.space4, gap: t.space4 };
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1, backgroundColor: t.bgPage }}>
      {scroll ? (
        <ScrollView contentContainerStyle={padding}>{children}</ScrollView>
      ) : (
        <View style={[{ flex: 1 }, padding]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

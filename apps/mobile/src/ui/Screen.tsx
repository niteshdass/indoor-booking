import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
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
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={padding} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </KeyboardAvoidingView>
      ) : (
        <View style={[{ flex: 1 }, padding]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

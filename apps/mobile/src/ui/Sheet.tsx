import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export interface SheetProps {
  visible: boolean;
  onClose(): void;
  /** Shown as the sheet's heading; also its accessible name. */
  title?: string;
  /** One muted line under the title, e.g. who and when. */
  subtitle?: string;
  children: ReactNode;
}

/**
 * Bottom sheet: a raised panel over a scrim, grabber on top. Tapping the scrim or the system back closes it.
 * The body scrolls, so long Russian/Bangla text and the keyboard never push actions off screen.
 */
export function Sheet({ visible, onClose, title, subtitle, children }: SheetProps) {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tr('common.close')}
          onPress={onClose}
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: t.overlay }}
        />
        <View
          accessibilityViewIsModal
          style={{
            maxHeight: '90%',
            backgroundColor: t.bgSurfaceRaised,
            borderTopLeftRadius: t.radiusXl,
            borderTopRightRadius: t.radiusXl,
            paddingTop: t.space2,
          }}
        >
          <View style={{ alignSelf: 'center', width: t.space10, height: t.space1, borderRadius: t.radiusFull, backgroundColor: t.borderDefault }} />
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: t.space5, paddingBottom: t.space5 + insets.bottom, gap: t.space3 }}
          >
            {title ? (
              <View style={{ gap: t.space1 }}>
                <Text variant="title" tone="strong" accessibilityRole="header">
                  {title}
                </Text>
                {subtitle ? (
                  <Text variant="label" tone="muted">
                    {subtitle}
                  </Text>
                ) : null}
              </View>
            ) : null}
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

import { ActivityIndicator, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../lib/errors';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';
import { Icon } from './Icon';
import { Text } from './Text';

/** Centred spinner with a spoken label. */
export function Loading() {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  return (
    <View style={{ padding: t.space8, alignItems: 'center' }}>
      <ActivityIndicator color={t.textMuted} accessibilityLabel={tr('common.loading')} />
    </View>
  );
}

/** A failed load: the reason and a retry button. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?(): void }) {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  return (
    <View style={{ padding: t.space4, gap: t.space3, alignItems: 'flex-start' }}>
      <Text tone="danger" accessibilityRole="alert">
        {errorMessage(error, tr)}
      </Text>
      {onRetry ? <Button label={tr('auth.retry')} variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

/** "Set up on web" note for things the app leaves to the owner portal. */
export function WebNote({ children }: { children: string }) {
  const { t } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: t.space2, alignItems: 'flex-start', backgroundColor: t.infoSoft, borderRadius: t.radiusMd, padding: t.space3 }}>
      <Icon name="external" color={t.info} size={t.iconSm} />
      <Text variant="label" tone="info" style={{ flex: 1 }}>
        {children}
      </Text>
    </View>
  );
}

/** Nothing to show: one muted line. */
export function Empty({ children }: { children: string }) {
  const { t } = useTheme();
  return (
    <Text tone="muted" style={{ paddingVertical: t.space4, textAlign: 'center' }}>
      {children}
    </Text>
  );
}

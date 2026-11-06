import { Redirect, Stack, usePathname } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { safeNext } from '../../src/auth/safeNext';
import { useAuth } from '../../src/auth/useAuth';
import { useTheme } from '../../src/theme/ThemeProvider';
import { BackButton, Button, Loading, Screen, Text } from '../../src/ui';

/**
 * Owner mode needs the restored session before any screen asks for team data: on a cold start or a deep
 * link the token is still being refreshed, and a request sent now would fail as signed out.
 */
export default function OwnerLayout() {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const { status, retry } = useAuth();
  const pathname = usePathname();

  if (status === 'loading') {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }
  if (status === 'offline') {
    return (
      <Screen>
        <BackButton />
        <Text tone="muted" accessibilityRole="alert">
          {tr('auth.offline')}
        </Text>
        <Button label={tr('auth.retry')} onPress={retry} />
      </Screen>
    );
  }
  if (status === 'signedOut') return <Redirect href={`/sign-in?next=${encodeURIComponent(safeNext(pathname))}`} />;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bgPage } }} />;
}

import { Stack, useLocalSearchParams } from 'expo-router';
import { OwnerProvider } from '../../../src/owner/OwnerProvider';
import { useTheme } from '../../../src/theme/ThemeProvider';

/** Owner mode for one team: loads the team once, then tabs plus pushed detail screens; walk-in opens full screen. */
export default function OwnerTeamLayout() {
  const { t } = useTheme();
  const { ownerId = '' } = useLocalSearchParams<{ ownerId: string }>();
  return (
    <OwnerProvider key={ownerId} ownerId={ownerId}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bgPage } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="walkin" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
      </Stack>
    </OwnerProvider>
  );
}

import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { fontFamily } from '../../src/theme/fonts';
import { useTheme } from '../../src/theme/ThemeProvider';

export default function TabsLayout() {
  const { t } = useTheme();
  const { t: tr, i18n } = useTranslation();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.primary,
        tabBarInactiveTintColor: t.textMuted,
        tabBarStyle: { backgroundColor: t.bgSurfaceRaised, borderTopColor: t.borderSubtle },
        tabBarLabelStyle: { fontFamily: fontFamily('sans', 'medium', i18n.language), fontSize: t.textXs },
        // Labels only for now; icons arrive with the screens.
        tabBarIconStyle: { display: 'none' },
        tabBarLabelPosition: 'beside-icon',
      }}
    >
      <Tabs.Screen name="index" options={{ title: tr('mobile.tabs.find') }} />
      <Tabs.Screen name="bookings" options={{ title: tr('mobile.tabs.bookings') }} />
      <Tabs.Screen name="account" options={{ title: tr('mobile.tabs.account') }} />
    </Tabs>
  );
}

import { View } from 'react-native';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Icon, Text, type IconName } from '../../src/ui';

/** Label with an underline the width of the text; only the current tab's underline shows. */
function TabLabel({ label, focused }: { label: string; focused: boolean }) {
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

export default function TabsLayout() {
  const { t } = useTheme();
  const { t: tr, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  // Icon, gap, one label line (Bangla runs taller), gap and underline, padded above and above the system bar.
  const leading = i18n.language === 'bn' ? t.leadingBodyBn : t.leadingBody;
  const barHeight =
    t.space2 + t.iconLg + t.space1 + Math.ceil(t.textXs * leading) + t.space1 + t.tabUnderline + t.space2 + insets.bottom;
  const tab = (name: IconName, title: string) => ({
    title,
    tabBarIcon: function TabBarIcon({ focused }: { focused: boolean }) {
      return <Icon name={name} color={focused ? t.primary : t.textMuted} size={t.iconLg} />;
    },
    tabBarLabel: function TabBarLabel({ focused }: { focused: boolean }) {
      return <TabLabel label={title} focused={focused} />;
    },
  });
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.primary,
        tabBarInactiveTintColor: t.textMuted,
        tabBarStyle: {
          backgroundColor: t.bgSurfaceRaised,
          borderTopColor: t.borderSubtle,
          height: barHeight,
          paddingTop: t.space2,
          paddingBottom: t.space2 + insets.bottom,
        },
        tabBarItemStyle: { gap: t.space1 },
        tabBarLabelPosition: 'below-icon',
      }}
    >
      <Tabs.Screen name="index" options={tab('search', tr('mobile.tabs.find'))} />
      <Tabs.Screen name="bookings" options={tab('calendar', tr('mobile.tabs.bookings'))} />
      <Tabs.Screen name="account" options={tab('person', tr('mobile.tabs.account'))} />
    </Tabs>
  );
}

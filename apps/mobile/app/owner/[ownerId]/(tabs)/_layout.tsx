import { View } from 'react-native';
import { router, Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useOwner } from '../../../../src/owner/OwnerProvider';
import { useTheme } from '../../../../src/theme/ThemeProvider';
import { Icon, TabLabel, type IconName } from '../../../../src/ui';

/**
 * Owner tabs: Today | Bookings | + Walk-in | Insights | More. The centre button opens the walk-in flow full screen
 * instead of switching tab. Tabs a role cannot use are hidden (`href: null`).
 */
export default function OwnerTabsLayout() {
  const { t } = useTheme();
  const { t: tr, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const { ownerId, can } = useOwner();
  const leading = i18n.language === 'bn' ? t.leadingBodyBn : t.leadingBody;
  const barHeight =
    t.space2 + t.iconLg + t.space1 + Math.ceil(t.textXs * leading) + t.space1 + t.tabUnderline + t.space2 + insets.bottom;
  const tab = (name: IconName, title: string, shown = true) => ({
    title,
    href: shown ? undefined : null,
    tabBarIcon: function TabBarIcon({ focused }: { focused: boolean }) {
      return <Icon name={name} color={focused ? t.primary : t.textMuted} size={t.iconLg} />;
    },
    tabBarLabel: function TabBarLabel({ focused }: { focused: boolean }) {
      return <TabLabel label={title} focused={focused} />;
    },
  });
  const walkInTitle = tr('owner.nav.walkIn');
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
      <Tabs.Screen name="today" options={tab('sun', tr('owner.nav.today'))} />
      <Tabs.Screen name="bookings" options={tab('list', tr('owner.nav.bookings'), can('booking.view'))} />
      <Tabs.Screen
        name="walkin-tab"
        options={{
          title: walkInTitle,
          href: can('booking.create') ? undefined : null,
          tabBarAccessibilityLabel: tr('mobile.owner.shell.newWalkIn'),
          tabBarIcon: function WalkInIcon() {
            return (
              <View style={{ width: t.iconLg + t.space3, height: t.iconLg + t.space1, borderRadius: t.radiusFull, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="plus" color={t.primaryFg} size={t.iconMd} />
              </View>
            );
          },
          tabBarLabel: function WalkInLabel() {
            return <TabLabel label={walkInTitle} focused={false} />;
          },
        }}
        listeners={{
          tabPress: (e) => {
            e.preventDefault();
            router.push(`/owner/${ownerId}/walkin`);
          },
        }}
      />
      <Tabs.Screen name="insights" options={tab('chart', tr('mobile.owner.shell.insights'), can('reports.view'))} />
      <Tabs.Screen name="more" options={tab('menu', tr('mobile.owner.shell.more'))} />
    </Tabs>
  );
}

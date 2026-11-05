import { useCallback, useRef, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { OwnerPlatformFeeJson, SeriesJson } from '@booking/shared';
import { useAuth } from '../../../../src/auth/useAuth';
import { useResource } from '../../../../src/lib/useResource';
import { ownerHref, ownerPath, roleLabel } from '../../../../src/owner/labels';
import { initials, MENU_GROUPS, platformFeeShown, visibleMenu } from '../../../../src/owner/more/menu';
import { refundsCount, refundsToSendPath, refundsWaiting, type RefundsPage } from '../../../../src/owner/refunds/api';
import { useOwner } from '../../../../src/owner/OwnerProvider';
import { TeamSwitcher } from '../../../../src/owner/TeamSwitcher';
import { useTheme } from '../../../../src/theme/ThemeProvider';
import { Badge, Group, GroupLabel, Icon, Row, Screen, Text } from '../../../../src/ui';

/** More tab: team header (opens the switcher), the rest of the portal by group, then player app and sign out. */
export default function OwnerMoreScreen() {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const { ownerId, owner, membership, can } = useOwner();
  const { signOut } = useAuth();
  const [switching, setSwitching] = useState(false);

  const requests = useResource<{ series: SeriesJson[]; nextBefore: string | null }>(
    can('booking.view') ? ownerPath(ownerId, '/series?status=requested') : null,
  );
  const refunds = useResource<RefundsPage>(can('payment.verify') ? refundsToSendPath(ownerId) : null);
  const fee = useResource<OwnerPlatformFeeJson>(can('settings.edit') ? ownerPath(ownerId, '/platform-fee') : null);
  const { reload } = requests;
  const { reload: reloadRefunds } = refunds;
  // The open-request count moves while the owner works elsewhere, so refresh it each time the tab shows.
  const focused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (focused.current) {
        reload();
        reloadRefunds();
      }
      focused.current = true;
    }, [reload, reloadRefunds]),
  );

  const feeShown = fee.state.status === 'ready' && platformFeeShown(fee.state.data);
  const items = visibleMenu(can, feeShown);
  const waiting = requests.state.status === 'ready' ? requests.state.data.series.length : 0;
  const waitingMore = requests.state.status === 'ready' && requests.state.data.nextBefore !== null;
  const toSend = refunds.state.status === 'ready' ? refunds.state.data : null;
  const toSendCount = refundsCount(toSend);

  /** The count shown on a row: open series requests, refunds to send. */
  const countFor = (route: string) =>
    route === '/series' && waiting > 0
      ? { detail: tr('mobile.owner.more.seriesWaiting', { count: waiting }), badge: waitingMore ? `${waiting}+` : String(waiting) }
      : route === '/refunds' && toSend && toSendCount
        ? { detail: refundsWaiting(toSend, tr), badge: toSendCount }
        : null;

  const confirmSignOut = () =>
    Alert.alert(tr('profile.signOutConfirm.title'), tr('profile.signOutConfirm.body'), [
      { text: tr('profile.signOutConfirm.cancel'), style: 'cancel' },
      {
        text: tr('profile.signOut'),
        style: 'destructive',
        onPress: async () => {
          await signOut();
          router.replace('/');
        },
      },
    ]);

  const role = roleLabel(membership.role, tr);
  return (
    <Screen scroll>
      <Text variant="heading" tone="strong" accessibilityRole="header">
        {tr('mobile.owner.shell.more')}
      </Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${owner.name}, ${tr('mobile.owner.more.switchTeam', { role })}`}
        onPress={() => setSwitching(true)}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: t.space3,
          padding: t.space3,
          minHeight: t.controlLg,
          borderRadius: t.radiusLg,
          backgroundColor: pressed ? t.bgHover : t.bgSurface,
        })}
      >
        <View style={{ width: t.controlMd, height: t.controlMd, borderRadius: t.radiusMd, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center' }}>
          <Text weight="bold" style={{ color: t.primaryFg }}>
            {initials(owner.name)}
          </Text>
        </View>
        <View style={{ flex: 1, gap: t.space1 / 2 }}>
          <Text weight="semibold" tone="strong">
            {owner.name}
          </Text>
          <Text variant="caption" tone="muted">
            {tr('mobile.owner.more.switchTeam', { role })}
          </Text>
        </View>
        <Icon name="chevronRight" color={t.textMuted} size={t.iconSm} />
      </Pressable>

      {MENU_GROUPS.map((g) => {
        const rows = items.filter((m) => m.group === g);
        if (rows.length === 0) return null;
        return (
          <View key={g} style={{ gap: t.space2 }}>
            <GroupLabel>{tr(`owner.nav.groups.${g}`)}</GroupLabel>
            <Group>
              {rows.map((m) => {
                const count = countFor(m.route);
                return (
                  <Row
                    key={m.route}
                    icon={m.icon}
                    title={tr(m.key)}
                    detail={count?.detail}
                    right={count ? <Badge tone="warning" label={count.badge} /> : undefined}
                    onPress={() => router.push(ownerHref(ownerId, m.route))}
                  />
                );
              })}
            </Group>
          </View>
        );
      })}

      <Group>
        <Row icon="arrowLeft" title={tr('mobile.owner.shell.toPlayer')} onPress={() => router.replace('/account' as Href)} />
        <Row icon="logout" tone="danger" title={tr('profile.signOut')} onPress={confirmSignOut} />
      </Group>

      <TeamSwitcher visible={switching} onClose={() => setSwitching(false)} />
    </Screen>
  );
}

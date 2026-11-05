import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { apiGet } from '../lib/api';
import { useTheme } from '../theme/ThemeProvider';
import { Badge, Card, Icon, Text } from '../ui';
import type { OwnerMembership } from './types';

/** Account-tab entry to owner mode; shown only to members of at least one team. */
export function OwnerEntryCard() {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const [teams, setTeams] = useState<OwnerMembership[] | null>(null);

  useEffect(() => {
    let live = true;
    apiGet<{ memberships: OwnerMembership[] }>('/me/memberships')
      .then((r) => live && setTeams(r.memberships))
      .catch(() => live && setTeams(null));
    return () => {
      live = false;
    };
  }, []);

  if (!teams || teams.length === 0) return null;
  const waiting = teams.every((m) => m.ownerStatus !== 'active');
  const name = teams.length === 1 ? teams[0]!.ownerName : tr('mobile.owner.shell.teams', { count: teams.length });
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${tr('owner.portalLink')}, ${name}`} onPress={() => router.push('/owner')}>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space3 }}>
          <View style={{ width: t.controlLg, height: t.controlLg, borderRadius: t.radiusMd, backgroundColor: t.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="venue" color={t.primary} />
          </View>
          <View style={{ flex: 1, gap: t.space1 / 2 }}>
            <Text variant="title" tone="strong">
              {tr('owner.portal')}
            </Text>
            <Text variant="label" tone="muted">
              {name}
            </Text>
          </View>
          <Icon name="chevronRight" color={t.textMuted} size={t.iconSm} />
        </View>
        {waiting ? <Badge tone="warning" label={tr('owner.status.pending_approval')} /> : <Text variant="label" tone="muted">{tr('mobile.owner.shell.cardHint')}</Text>}
      </Card>
    </Pressable>
  );
}

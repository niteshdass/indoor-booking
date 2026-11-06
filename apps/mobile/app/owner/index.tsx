import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useResource } from '../../src/lib/useResource';
import { getLastOwner } from '../../src/owner/OwnerProvider';
import { roleLabel } from '../../src/owner/labels';
import type { OwnerMembership } from '../../src/owner/types';
import { useTheme } from '../../src/theme/ThemeProvider';
import { BackButton, Badge, Button, Card, ErrorState, Group, Icon, Loading, Row, Screen, Text } from '../../src/ui';

/**
 * `/owner`: opens the remembered active team (or the only one). With `?pick=1`, or several teams and none remembered,
 * lists them. With no active team, says where the application stands.
 */
export default function OwnerIndex() {
  const { t: tr } = useTranslation();
  const { pick } = useLocalSearchParams<{ pick?: string }>();
  const { state, reload, updatedAt } = useResource<{ memberships: OwnerMembership[] }>('/me/memberships');
  const [last, setLast] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    void getLastOwner().then(setLast);
  }, []);

  if (state.status === 'error') {
    return (
      <Screen>
        <BackButton />
        <ErrorState error={state.error} onRetry={reload} />
      </Screen>
    );
  }
  if (state.status !== 'ready' || last === undefined) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }
  const { memberships } = state.data;
  const active = memberships.filter((m) => m.ownerStatus === 'active');
  if (memberships.length === 0) {
    return (
      <Screen>
        <BackButton />
        <Text variant="title" tone="strong">
          {tr('owner.noTeams')}
        </Text>
        <Text tone="muted">{tr('owner.noTeamsHint')}</Text>
      </Screen>
    );
  }
  if (active.length === 0) return <Waiting memberships={memberships} checkedAt={updatedAt} onCheck={reload} />;
  const remembered = active.find((m) => m.ownerId === last);
  if (!pick && (remembered || active.length === 1)) return <Redirect href={`/owner/${(remembered ?? active[0]!).ownerId}/today`} />;

  return (
    <Screen scroll>
      <BackButton />
      <Text variant="heading" tone="strong" accessibilityRole="header">
        {tr('owner.pickTeam')}
      </Text>
      <Group>
        {memberships.map((m) => (
          <Row
            key={m.ownerId}
            title={m.ownerName}
            detail={roleLabel(m.role, tr)}
            right={m.ownerStatus === 'active' ? undefined : <Badge tone={m.ownerStatus === 'suspended' ? 'danger' : 'warning'} label={tr(`owner.status.${m.ownerStatus}`)} />}
            onPress={m.ownerStatus === 'active' ? () => router.replace(`/owner/${m.ownerId}/today`) : undefined}
          />
        ))}
      </Group>
    </Screen>
  );
}

/** Only teams waiting for approval or suspended: plain status, the three steps, and a way to check again. */
function Waiting({ memberships, checkedAt, onCheck }: { memberships: OwnerMembership[]; checkedAt: number | null; onCheck(): void }) {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const [askedAt, setAskedAt] = useState<number | null>(null);
  const suspended = memberships.every((m) => m.ownerStatus === 'suspended');
  const steps = [
    { key: 'sent', done: true },
    { key: 'check', done: false },
    { key: 'open', done: false },
  ] as const;
  return (
    <Screen scroll>
      <BackButton />
      <Card>
        <View style={{ width: t.controlLg, height: t.controlLg, borderRadius: t.radiusFull, backgroundColor: suspended ? t.dangerSoft : t.warningSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={suspended ? 'ban' : 'clock'} color={suspended ? t.danger : t.warning} />
        </View>
        <Text variant="title" tone="strong" accessibilityRole="header">
          {tr(suspended ? 'owner.waiting.suspendedTitle' : 'owner.waiting.title')}
        </Text>
        <Text tone="muted">{tr(suspended ? 'owner.suspendedNote' : 'owner.pendingNote')}</Text>
        {memberships.map((m) => (
          <View key={m.ownerId} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: t.space2 }}>
            <Text tone="strong" style={{ flex: 1 }}>
              {m.ownerName}
            </Text>
            <Badge tone={m.ownerStatus === 'suspended' ? 'danger' : 'warning'} label={tr(`owner.status.${m.ownerStatus}`)} />
          </View>
        ))}
        {!suspended
          ? steps.map((s, i) => (
              <View key={s.key} style={{ flexDirection: 'row', gap: t.space3 }}>
                <View style={{ width: t.space6, height: t.space6, borderRadius: t.radiusFull, backgroundColor: s.done ? t.successSoft : t.bgSubtle, alignItems: 'center', justifyContent: 'center' }}>
                  {s.done ? <Icon name="check" color={t.success} size={t.iconSm} /> : <Text variant="caption" tone="muted">{String(i + 1)}</Text>}
                </View>
                <View style={{ flex: 1, gap: t.space1 / 2 }}>
                  <Text tone="strong">{tr(`owner.waiting.${s.key}`)}</Text>
                  <Text variant="label" tone="muted">
                    {tr(`owner.waiting.${s.key}Hint`)}
                  </Text>
                </View>
              </View>
            ))
          : null}
      </Card>
      {!suspended ? (
        <Button
          label={tr('owner.waiting.again')}
          variant="secondary"
          onPress={() => {
            setAskedAt(Date.now());
            onCheck();
          }}
        />
      ) : null}
      {askedAt !== null && checkedAt !== null && checkedAt >= askedAt ? (
        <Text tone="muted" accessibilityLiveRegion="polite">
          {tr('owner.waiting.checked')}
        </Text>
      ) : null}
    </Screen>
  );
}

import { useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useResource } from '../../../src/lib/useResource';
import { useOwner } from '../../../src/owner/OwnerProvider';
import { ownerPath } from '../../../src/owner/labels';
import { MemberSheet, memberRoleLabel } from '../../../src/owner/team/MemberSheet';
import type { Member, Role } from '../../../src/owner/types';
import { useTheme } from '../../../src/theme/ThemeProvider';
import { BackButton, Badge, Button, Empty, ErrorState, Group, Loading, Row, Screen, Text, WebNote } from '../../../src/ui';

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => Array.from(w)[0] ?? '')
    .join('')
    .toUpperCase();

/** Team members (`staff.manage`): who has which preset role and venues; add, edit and remove in a sheet. */
export default function StaffScreen() {
  const { t: tr } = useTranslation();
  const { ownerId, can } = useOwner();
  const allowed = can('staff.manage');
  const members = useResource<{ members: Member[] }>(allowed ? ownerPath(ownerId, '/members') : null);
  const roles = useResource<{ roles: Role[] }>(allowed ? ownerPath(ownerId, '/roles') : null);
  const [open, setOpen] = useState<{ member: Member | null } | null>(null);
  const reloadAll = () => {
    members.reload();
    roles.reload();
  };

  const header = (action?: ReactNode) => (
    <>
      <BackButton />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <Text variant="heading" tone="strong" accessibilityRole="header">
          {tr('owner.staff.title')}
        </Text>
        {action}
      </View>
    </>
  );

  if (!allowed) {
    return (
      <Screen>
        {header()}
        <Text tone="muted">{tr('owner.noAccess')}</Text>
      </Screen>
    );
  }
  const failed = members.state.status === 'error' ? members.state.error : roles.state.status === 'error' ? roles.state.error : null;
  if (failed !== null) {
    return (
      <Screen>
        {header()}
        <ErrorState error={failed} onRetry={reloadAll} />
      </Screen>
    );
  }
  if (members.state.status !== 'ready' || roles.state.status !== 'ready') {
    return (
      <Screen>
        {header()}
        <Loading />
      </Screen>
    );
  }
  const list = members.state.data.members;
  const roleList = roles.state.data.roles;

  return (
    <Screen scroll>
      {header(<Button label={tr('mobile.owner.team.staff.add')} variant="secondary" onPress={() => setOpen({ member: null })} />)}
      {list.length === 0 ? <Empty>{tr('owner.staff.memberEmpty')}</Empty> : <MemberList members={list} onEdit={(m) => setOpen({ member: m })} />}
      <WebNote>{tr('mobile.owner.team.staff.webNote')}</WebNote>
      {open && <MemberSheet member={open.member} roles={roleList} onClose={() => setOpen(null)} onSaved={reloadAll} />}
    </Screen>
  );
}

function MemberList({ members, onEdit }: { members: Member[]; onEdit(m: Member): void }) {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const { membership, venues } = useOwner();
  const venueNames = (scope: Member['venueIds']) => {
    if (scope === 'all') return tr('owner.staff.allVenues');
    const names = scope.map((id) => venues.find((v) => v.id === id)?.name).filter((n): n is string => Boolean(n));
    return names.length > 0 ? names.join(', ') : '—';
  };
  return (
    <Group>
      {members.map((m) => {
        const self = m.id === membership.id;
        // The API refuses changes to the caller's own row and to the owner's.
        const locked = self || m.role.key === 'owner';
        const title = self ? `${m.user.name} (${tr('owner.staff.you')})` : m.user.name;
        return (
          <Row
            key={m.id}
            title={title}
            detail={`${memberRoleLabel(m.role, tr)} · ${venueNames(m.venueIds)}`}
            left={
              <View
                style={{
                  width: t.controlMd,
                  height: t.controlMd,
                  borderRadius: t.radiusFull,
                  backgroundColor: t.primary,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text variant="label" weight="semibold" style={{ color: t.primaryFg }} accessibilityElementsHidden importantForAccessibility="no">
                  {initials(m.user.name)}
                </Text>
              </View>
            }
            right={m.status === 'disabled' ? <Badge tone="neutral" label={tr('owner.staff.status.disabled')} /> : undefined}
            onPress={locked ? undefined : () => onEdit(m)}
          />
        );
      })}
    </Group>
  );
}

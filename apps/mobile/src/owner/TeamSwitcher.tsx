import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeProvider';
import { Badge, Group, Icon, Row, Sheet } from '../ui';
import { roleLabel } from './labels';
import { useOwner } from './OwnerProvider';

/** Sheet listing the user's teams; picking one reopens owner mode on it. */
export function TeamSwitcher({ visible, onClose }: { visible: boolean; onClose(): void }) {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const { ownerId, memberships } = useOwner();
  return (
    <Sheet visible={visible} onClose={onClose} title={tr('owner.switcher')}>
      <Group>
        {memberships.map((m) => {
          const active = m.ownerStatus === 'active';
          const current = m.ownerId === ownerId;
          return (
            <Row
              key={m.ownerId}
              title={m.ownerName}
              detail={roleLabel(m.role, tr)}
              right={
                current ? (
                  <Icon name="check" color={t.primary} />
                ) : active ? undefined : (
                  <Badge tone={m.ownerStatus === 'suspended' ? 'danger' : 'warning'} label={tr(`owner.status.${m.ownerStatus}`)} />
                )
              }
              onPress={
                current || !active
                  ? undefined
                  : () => {
                      onClose();
                      router.replace(`/owner/${m.ownerId}/today`);
                    }
              }
            />
          );
        })}
      </Group>
    </Sheet>
  );
}

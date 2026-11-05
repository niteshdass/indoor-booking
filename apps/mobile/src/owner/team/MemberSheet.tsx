import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { apiDelete, apiPatch, apiPost } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { useTheme } from '../../theme/ThemeProvider';
import { Button, Chip, Field, Row, Sheet, Text, WebNote } from '../../ui';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../labels';
import type { Member, Role, VenueScope } from '../types';

const EMAIL_RE = /^\S+@\S+\.\S+$/;
/** The two presets the app offers; custom roles are edited on the web. */
const PRESETS = ['manager', 'staff'] as const;

const sameVenues = (a: VenueScope, b: VenueScope) =>
  a === 'all' || b === 'all' ? a === b : a.length === b.length && a.every((id) => b.includes(id));

/** "Manager" / "Desk" for the presets, the typed name for a custom role. */
export function memberRoleLabel(role: Pick<Role, 'key' | 'name'>, tr: TFunction): string {
  if (role.key === 'manager' || role.key === 'staff') return tr(`mobile.owner.team.staff.role.${role.key}`);
  if (role.key === 'owner') return tr('owner.roleName.owner');
  return role.name;
}

type Props = { member: Member | null; roles: Role[]; onClose(): void; onSaved(): void };

/** Add (member null) or edit one team member. Mounted only while open so each opening starts fresh. */
export function MemberSheet({ member, roles, onClose, onSaved }: Props) {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const { ownerId, membership, venues } = useOwner();
  const mine = membership.permissions;
  const reachable = (r: Role) => r.permissions.every((p) => mine.includes(p));
  const presets = PRESETS.map((k) => roles.find((r) => r.key === k)).filter((r): r is Role => r !== undefined);
  const custom = member && member.role.key === null ? member.role : null;
  const canGrantAll = membership.venueIds === 'all';

  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [roleId, setRoleId] = useState(member?.role.id ?? presets.find(reachable)?.id ?? '');
  const [allVenues, setAllVenues] = useState(member ? member.venueIds === 'all' : canGrantAll);
  const [venueIds, setVenueIds] = useState<string[]>(member && member.venueIds !== 'all' ? member.venueIds : []);
  const [active, setActive] = useState(member ? member.status === 'active' : true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const scope: VenueScope = allVenues ? 'all' : venueIds;

  const toggleVenue = (id: string) => setVenueIds((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));

  const save = async () => {
    if (busy) return;
    setError(null);
    const next: Record<string, string> = {};
    if (!allVenues && venueIds.length === 0) next.venues = 'owner.staff.err.venues';
    if (roleId === '') next.role = 'owner.staff.err.role';
    const value = contact.trim();
    if (!member) {
      if (name.trim() === '') next.name = 'owner.staff.err.name';
      if (value === '' || (value.includes('@') && !EMAIL_RE.test(value))) next.contact = 'mobile.owner.team.staff.contactErr';
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setBusy(true);
    try {
      if (member) {
        const body: { roleId?: string; venueIds?: VenueScope; status?: Member['status'] } = {};
        const status: Member['status'] = active ? 'active' : 'disabled';
        if (roleId !== member.role.id) body.roleId = roleId;
        if (!sameVenues(scope, member.venueIds)) body.venueIds = scope;
        if (status !== member.status) body.status = status;
        if (Object.keys(body).length > 0) await apiPatch(ownerPath(ownerId, `/members/${encodeURIComponent(member.id)}`), body);
      } else {
        await apiPost(ownerPath(ownerId, '/members'), {
          name: name.trim(),
          ...(value.includes('@') ? { email: value } : { phone: value }),
          roleId,
          venueIds: scope,
        });
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!member || busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiDelete(ownerPath(ownerId, `/members/${encodeURIComponent(member.id)}`));
      onSaved();
      onClose();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  const err = (k: string) => (errors[k] ? tr(errors[k]!) : undefined);
  const roleOptions: { id: string; title: string; hint: string; disabled: boolean }[] = [
    ...(custom ? [{ id: custom.id, title: custom.name, hint: tr('mobile.owner.team.staff.role.customHint'), disabled: false }] : []),
    ...presets.map((r) => ({
      id: r.id,
      title: memberRoleLabel(r, tr),
      hint: tr(`mobile.owner.team.staff.role.${r.key}Hint`),
      disabled: !reachable(r),
    })),
  ];

  return (
    <Sheet
      visible
      onClose={onClose}
      title={member ? tr('owner.staff.memberTitleEdit', { name: member.user.name }) : tr('owner.staff.memberTitleAdd')}
      subtitle={member ? (member.user.email ?? member.user.phone ?? undefined) : undefined}
    >
      {error !== null && (
        <Text tone="danger" accessibilityRole="alert">
          {errorMessage(error, tr)}
        </Text>
      )}
      {!member && (
        <>
          <Field label={tr('owner.staff.field.name')} value={name} onChangeText={setName} error={err('name')} autoComplete="off" />
          <Field
            label={tr('mobile.owner.team.staff.contact')}
            value={contact}
            onChangeText={setContact}
            error={err('contact')}
            hint={tr('owner.staff.noInvite')}
            autoCapitalize="none"
            autoComplete="off"
            keyboardType="email-address"
          />
        </>
      )}

      <Text variant="label" tone="strong">
        {tr('owner.staff.field.role')}
      </Text>
      <View accessibilityRole="radiogroup" style={{ gap: t.space2 }}>
        {roleOptions.map((o) => {
          const on = o.id === roleId;
          return (
            <Pressable
              key={o.id}
              accessibilityRole="radio"
              accessibilityState={{ checked: on, disabled: o.disabled }}
              accessibilityLabel={`${o.title}, ${o.hint}`}
              disabled={o.disabled}
              onPress={() => setRoleId(o.id)}
              style={{
                flexDirection: 'row',
                gap: t.space3,
                alignItems: 'flex-start',
                minHeight: t.controlLg,
                padding: t.space3,
                borderRadius: t.radiusMd,
                borderWidth: t.focusWidth,
                borderColor: on ? t.primary : 'transparent',
                backgroundColor: on ? t.primarySoft : t.bgSurface,
                opacity: o.disabled ? t.opacityMuted : 1,
              }}
            >
              <View
                style={{
                  width: t.iconMd,
                  height: t.iconMd,
                  borderRadius: t.radiusFull,
                  borderWidth: on ? t.space1 + t.focusWidth / 2 : t.focusWidth,
                  borderColor: on ? t.primary : t.borderStrong,
                }}
              />
              <View style={{ flex: 1, gap: t.space1 / 2 }}>
                <Text weight="medium" tone="strong">
                  {o.title}
                </Text>
                <Text variant="caption" tone="muted">
                  {o.disabled ? tr('owner.staff.roleOutOfReach', { name: o.title }) : o.hint}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      {custom && <WebNote>{tr('mobile.owner.team.staff.webNote')}</WebNote>}
      {err('role') ? (
        <Text variant="caption" tone="danger">
          {err('role')!}
        </Text>
      ) : null}

      <Text variant="label" tone="strong">
        {tr('owner.staff.col.venues')}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space2 }}>
        {canGrantAll && (
          <Chip selected={allVenues} onPress={() => setAllVenues(!allVenues)} accessibilityRole="checkbox" accessibilityState={{ checked: allVenues }}>
            <Text variant="label">{tr('owner.staff.allVenues')}</Text>
          </Chip>
        )}
        {!allVenues &&
          venues.map((v) => {
            const on = venueIds.includes(v.id);
            return (
              <Chip key={v.id} selected={on} onPress={() => toggleVenue(v.id)} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                <Text variant="label">{v.name}</Text>
              </Chip>
            );
          })}
      </View>
      {err('venues') ? (
        <Text variant="caption" tone="danger">
          {err('venues')!}
        </Text>
      ) : null}

      {member && <Row title={tr('owner.staff.status.active')} toggle={{ value: active, onChange: setActive }} />}

      <Button label={member ? tr('owner.staff.save') : tr('owner.staff.memberAdd')} loading={busy} onPress={() => void save()} />
      {member &&
        (confirmRemove ? (
          <View style={{ gap: t.space2 }}>
            <Text tone="muted">{tr('mobile.owner.team.staff.removeAsk')}</Text>
            <Button label={tr('owner.staff.removeConfirm')} tone="danger" loading={busy} onPress={() => void remove()} />
            <Button label={tr('owner.staff.cancel')} variant="ghost" disabled={busy} onPress={() => setConfirmRemove(false)} />
          </View>
        ) : (
          <Button label={tr('mobile.owner.team.staff.removeFromTeam')} variant="ghost" tone="danger" disabled={busy} onPress={() => setConfirmRemove(true)} />
        ))}
    </Sheet>
  );
}

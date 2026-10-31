import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox';
import { Dialog } from '../../components/ui/Dialog';
import { PhoneInput } from '../../components/ui/PhoneInput';
import { Select } from '../../components/ui/Select';
import { TextField } from '../../components/ui/TextField';
import { apiPatch, apiPost } from '../../lib/apiClient';
import { errorMessage } from '../../lib/errors';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import { roleLabel } from '../roleLabel';
import type { Member, Role, VenueScope } from '../types';
import styles from './staff.module.css';

type Props = { open: boolean; member: Member | null; roles: Role[]; onClose(): void; onSaved(): void };
type Contact = 'email' | 'phone';

const EMAIL_RE = /^\S+@\S+\.\S+$/;
const sameVenues = (a: VenueScope, b: VenueScope) =>
  a === 'all' || b === 'all' ? a === b : a.length === b.length && a.every((id) => b.includes(id));

/** Add (member null) or edit dialog. The body is mounted only while open so every opening starts from a fresh draft. */
export function MemberDialog({ open, member, roles, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={member ? t('owner.staff.memberTitleEdit', { name: member.user.name }) : t('owner.staff.memberTitleAdd')}
    >
      {open && <MemberBody member={member} roles={roles} onClose={onClose} onSaved={onSaved} />}
    </Dialog>
  );
}

function MemberBody({ member, roles, onClose, onSaved }: Omit<Props, 'open'>) {
  const { t } = useTranslation();
  const { ownerId, membership, venues } = useOwner();
  const mine = membership.permissions;
  // The owner role can never be assigned; roles beyond the caller's own permissions are refused as privilege_escalation.
  const assignable = roles.filter((r) => r.key !== 'owner');
  const reachable = (r: Role) => r.permissions.every((p) => mine.includes(p));
  const canGrantAll = membership.venueIds === 'all';

  const [name, setName] = useState('');
  const [contact, setContact] = useState<Contact>('email');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [roleId, setRoleId] = useState(member?.role.id ?? assignable.find(reachable)?.id ?? '');
  const [allVenues, setAllVenues] = useState(member ? member.venueIds === 'all' : canGrantAll);
  const [venueIds, setVenueIds] = useState<string[]>(member && member.venueIds !== 'all' ? member.venueIds : []);
  const [status, setStatus] = useState<Member['status']>(member?.status ?? 'active');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const err = (field: string) => (errors[field] ? t(errors[field]) : undefined);
  const scope: VenueScope = allVenues ? 'all' : venueIds;

  const toggleVenue = (id: string, on: boolean) => setVenueIds((prev) => (on ? [...prev, id] : prev.filter((v) => v !== id)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    const next: Record<string, string> = {};
    if (!allVenues && venueIds.length === 0) next.venues = 'owner.staff.err.venues';
    if (roleId === '') next.role = 'owner.staff.err.role';
    if (!member) {
      if (name.trim() === '') next.name = 'owner.staff.err.name';
      if (contact === 'email' && !EMAIL_RE.test(email.trim())) next.email = 'owner.staff.err.email';
      if (contact === 'phone' && phone === '') next.phone = 'owner.staff.err.phone';
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setBusy(true);
    try {
      if (member) {
        const body: { roleId?: string; venueIds?: VenueScope; status?: Member['status'] } = {};
        if (roleId !== member.role.id) body.roleId = roleId;
        if (!sameVenues(scope, member.venueIds)) body.venueIds = scope;
        if (status !== member.status) body.status = status;
        if (Object.keys(body).length > 0) await apiPatch(ownerPath(ownerId, `/members/${encodeURIComponent(member.id)}`), body);
      } else {
        await apiPost(ownerPath(ownerId, '/members'), {
          name: name.trim(),
          ...(contact === 'email' ? { email: email.trim() } : { phone }),
          roleId,
          venueIds: scope,
        });
      }
      onSaved();
      onClose();
    } catch (e2) {
      setError(e2);
    }
    setBusy(false);
  };

  return (
    <form className={styles.body} onSubmit={submit} noValidate>
      {error !== null && <Alert tone="danger">{errorMessage(error, t)}</Alert>}
      {member ? (
        <p className={styles.muted}>{member.user.email ?? member.user.phone}</p>
      ) : (
        <>
          <p className={styles.muted}>{t('owner.staff.noInvite')}</p>
          <TextField icon="person" label={t('owner.staff.field.name')} value={name} error={err('name')} onChange={(e) => setName(e.target.value)} />
          <Select
            icon="at"
            layout="stacked"
            label={t('owner.staff.field.contactType')}
            value={contact}
            options={(['email', 'phone'] as const).map((c) => ({ value: c, label: t(`owner.staff.contact.${c}`) }))}
            onChange={(e) => setContact(e.target.value as Contact)}
          />
          {contact === 'email' ? (
            <TextField
              icon="mail"
              label={t('owner.staff.field.email')}
              type="email"
              autoComplete="off"
              value={email}
              error={err('email')}
              onChange={(e) => setEmail(e.target.value)}
            />
          ) : (
            <PhoneInput label={t('owner.staff.field.phone')} value={phone} error={err('phone')} onChange={setPhone} />
          )}
        </>
      )}
      <Select
        icon="role"
        layout="stacked"
        label={t('owner.staff.field.role')}
        value={roleId}
        options={assignable.map((r) => ({
          value: r.id,
          label: reachable(r) ? roleLabel(r, t) : t('owner.staff.roleOutOfReach', { name: roleLabel(r, t) }),
        }))}
        onChange={(e) => setRoleId(e.target.value)}
      />
      {err('role') && <p className={styles.error}>{err('role')}</p>}
      {member && (
        <Select
          icon="status"
          layout="stacked"
          label={t('owner.staff.field.status')}
          value={status}
          options={(['active', 'disabled'] as const).map((s) => ({ value: s, label: t(`owner.staff.status.${s}`) }))}
          onChange={(e) => setStatus(e.target.value as Member['status'])}
        />
      )}
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>{t('owner.staff.field.venueAccess')}</legend>
        {canGrantAll && <Checkbox label={t('owner.staff.field.allVenues')} checked={allVenues} onChange={setAllVenues} />}
        {!allVenues &&
          venues.map((v) => (
            <Checkbox key={v.id} label={v.name} checked={venueIds.includes(v.id)} onChange={(on) => toggleVenue(v.id, on)} />
          ))}
        {err('venues') && <p className={styles.error}>{err('venues')}</p>}
      </fieldset>
      <div className={styles.actions}>
        <Button variant="secondary" disabled={busy} onClick={onClose}>
          {t('owner.staff.cancel')}
        </Button>
        <Button icon="check" type="submit" loading={busy}>
          {t('owner.staff.save')}
        </Button>
      </div>
    </form>
  );
}

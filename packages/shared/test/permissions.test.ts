import { describe, it, expect } from 'vitest';
import { PERMISSIONS, SYSTEM_ROLES, isPermission } from '../src/permissions';

describe('system roles', () => {
  it('owner has every permission', () => {
    expect([...SYSTEM_ROLES.owner].sort()).toEqual([...PERMISSIONS].sort());
  });
  it('manager cannot edit owner settings or staff', () => {
    expect(SYSTEM_ROLES.manager).not.toContain('settings.edit');
    expect(SYSTEM_ROLES.manager).not.toContain('staff.manage');
    expect(SYSTEM_ROLES.manager).toContain('booking.confirm');
    expect(SYSTEM_ROLES.manager).toContain('pricing.edit');
  });
  it('staff is limited to counter work', () => {
    expect([...SYSTEM_ROLES.staff].sort()).toEqual(
      ['booking.checkin', 'booking.create', 'booking.view', 'payment.mark_cash'].sort(),
    );
  });
  it('every role permission is a known key', () => {
    for (const perms of Object.values(SYSTEM_ROLES)) {
      perms.forEach((p) => expect(isPermission(p)).toBe(true));
    }
  });
  it('rejects unknown keys', () => {
    expect(isPermission('booking.delete_all')).toBe(false);
  });
});

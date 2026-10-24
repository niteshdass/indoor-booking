import { describe, it, expect } from 'vitest';
import {
  DEFAULT_OWNER_SETTINGS,
  resolveSettings,
  withOwnerDefaults,
  type OwnerSettings,
  type VenueSettingsOverride,
  type TurfSettingsOverride,
} from '../src/settings';

const deepFreeze = <T>(o: T): T => {
  if (o && typeof o === 'object') {
    Object.values(o).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
};

describe('withOwnerDefaults', () => {
  it('fills missing keys and merges hours per day', () => {
    expect(withOwnerDefaults({})).toEqual(DEFAULT_OWNER_SETTINGS);
    const hours = withOwnerDefaults({ hours: { fri: 'closed' } as never }).hours;
    expect(hours.fri).toBe('closed');
    expect(hours.mon).toEqual({ open: '08:00', close: '22:00' });
  });
});

describe('resolveSettings', () => {
  it('venue overrides replace whole keys; hours merge per day through turf', () => {
    const owner = withOwnerDefaults({ refundRules: [{ minHoursBefore: 24, percent: 100 }] });
    const venue: VenueSettingsOverride = {
      refundRules: [{ minHoursBefore: 48, percent: 50 }],
      hours: { fri: { open: '16:00', close: '02:00' } },
    };
    const turf: TurfSettingsOverride = { hours: { mon: 'closed' } };
    const eff = resolveSettings(owner, venue, turf);
    expect(eff.refundRules).toEqual([{ minHoursBefore: 48, percent: 50 }]);
    expect(eff.hours.mon).toBe('closed');
    expect(eff.hours.fri).toEqual({ open: '16:00', close: '02:00' });
    expect(eff.hours.tue).toEqual({ open: '08:00', close: '22:00' });
  });

  it('advance required disables guest booking', () => {
    const owner = withOwnerDefaults({ guestBooking: { allowed: true, requireOtp: false } });
    const eff = resolveSettings(owner, { paymentPolicy: { type: 'partial_percent', percent: 20 } });
    expect(eff.guestBooking).toEqual({ allowed: false, requireOtp: false });
    expect(resolveSettings(owner, { paymentPolicy: { type: 'none' } }).guestBooking.allowed).toBe(true);
  });

  it('does not mutate inputs', () => {
    const owner = deepFreeze(withOwnerDefaults({})) as OwnerSettings;
    const venue = deepFreeze<VenueSettingsOverride>({ hours: { sat: 'closed' }, paymentPolicy: { type: 'full' } });
    const turf = deepFreeze<TurfSettingsOverride>({ hours: { sun: 'closed' } });
    expect(() => resolveSettings(owner, venue, turf)).not.toThrow();
  });
});

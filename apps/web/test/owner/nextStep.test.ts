import { describe, expect, it } from 'vitest';
import { nextStep } from '../../src/owner/today/nextStep';
import type { Action } from '../../src/owner/bookings/availableActions';
import { ownerBooking } from './fixtures';

const NOW = new Date('2026-10-26T03:00:00.000Z');
const at = (min: number) => {
  const start = new Date(NOW.getTime() + min * 60_000);
  return [{ startAt: start.toISOString(), endAt: new Date(start.getTime() + 3_600_000).toISOString(), price: 1000 }];
};
const ALL: Action[] = ['confirm', 'reject', 'cancel', 'checkIn', 'noShow', 'markCash', 'paymentLink'];

describe('nextStep', () => {
  it.each<[string, Parameters<typeof nextStep>[0], Action[], Action | null]>([
    ['pending → confirm', ownerBooking({ status: 'pending' }), ALL, 'confirm'],
    ['pending without confirm → null', ownerBooking({ status: 'pending' }), ['cancel'], null],
    ['awaiting walk-in → paymentLink', ownerBooking({ status: 'awaiting_payment', source: 'walkin' }), ['cancel', 'paymentLink'], 'paymentLink'],
    ['confirmed in 20 min → checkIn', ownerBooking({ status: 'confirmed', slots: at(20) }), ALL, 'checkIn'],
    ['confirmed in 2 h with due → markCash', ownerBooking({ status: 'confirmed', slots: at(120) }), ['cancel', 'checkIn', 'noShow', 'markCash'], 'markCash'],
    ['confirmed in 2 h fully paid → null', ownerBooking({ status: 'confirmed', slots: at(120), amountPaid: 1000 }), ['cancel', 'checkIn', 'noShow'], null],
  ])('nextStep %s', (_name, b, actions, want) => {
    expect(nextStep(b, actions, NOW)).toBe(want);
  });
});

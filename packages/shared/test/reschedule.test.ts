import { describe, it, expect } from 'vitest';
import { DEFAULT_OWNER_SETTINGS } from '../src/settings';
import { DEFAULT_RESCHEDULE, playerRescheduleRefusal, reschedulableUntil, rescheduleCutoff } from '../src/reschedule';

const startAt = new Date('2026-11-10T18:00:00Z');
const policy = { allowed: true, minHoursBefore: 24, maxMoves: 1 };
const hoursBefore = (h: number) => new Date(startAt.getTime() - h * 3_600_000);

describe('playerRescheduleRefusal', () => {
  it('allows a move up to the cutoff', () => {
    expect(playerRescheduleRefusal(policy, startAt, 0, hoursBefore(30))).toBeNull();
    expect(playerRescheduleRefusal(policy, startAt, 0, hoursBefore(24))).toBeNull();
  });
  it('refuses after the cutoff', () => {
    expect(playerRescheduleRefusal(policy, startAt, 0, hoursBefore(23.9))).toBe('reschedule_too_late');
  });
  it('refuses once the moves are used', () => {
    expect(playerRescheduleRefusal(policy, startAt, 1, hoursBefore(48))).toBe('reschedule_limit');
    expect(playerRescheduleRefusal({ ...policy, maxMoves: 2 }, startAt, 1, hoursBefore(48))).toBeNull();
  });
  it('refuses when the venue does not allow it or the booking has no policy', () => {
    expect(playerRescheduleRefusal({ ...policy, allowed: false }, startAt, 0, hoursBefore(48))).toBe('reschedule_not_allowed');
    expect(playerRescheduleRefusal(null, startAt, 0, hoursBefore(48))).toBe('reschedule_not_allowed');
    expect(playerRescheduleRefusal(undefined, startAt, 0, hoursBefore(48))).toBe('reschedule_not_allowed');
  });
  it('a zero-hour cutoff allows a move until the start', () => {
    const p = { ...policy, minHoursBefore: 0 };
    expect(playerRescheduleRefusal(p, startAt, 0, startAt)).toBeNull();
    expect(playerRescheduleRefusal(p, startAt, 0, new Date(startAt.getTime() + 1))).toBe('reschedule_too_late');
  });
});

describe('reschedulableUntil', () => {
  const b = { status: 'confirmed' as const, startAt, moves: 0, series: false };
  it('is the cutoff while a move is allowed', () => {
    expect(reschedulableUntil(policy, b, hoursBefore(48))).toEqual(rescheduleCutoff(policy, startAt));
    expect(reschedulableUntil(policy, { ...b, status: 'pending' }, hoursBefore(48))?.toISOString()).toBe('2026-11-09T18:00:00.000Z');
  });
  it('is null for series games, other statuses and refused moves', () => {
    expect(reschedulableUntil(policy, { ...b, series: true }, hoursBefore(48))).toBeNull();
    expect(reschedulableUntil(policy, { ...b, status: 'awaiting_payment' }, hoursBefore(48))).toBeNull();
    expect(reschedulableUntil(policy, { ...b, status: 'cancelled' }, hoursBefore(48))).toBeNull();
    expect(reschedulableUntil(policy, b, hoursBefore(1))).toBeNull();
  });
});

describe('defaults', () => {
  it('owner settings carry the default policy', () => {
    expect(DEFAULT_OWNER_SETTINGS.reschedule).toEqual(DEFAULT_RESCHEDULE);
  });
});

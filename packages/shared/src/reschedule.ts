import type { BookingStatus } from './statuses';

const MS_PER_HOUR = 3_600_000;

/** Whether and until when a player may move their own booking. Staff move any time. */
export type ReschedulePolicy = {
  allowed: boolean;
  /** Hours before the start after which the player can no longer move it. */
  minHoursBefore: number;
  /** Moves a player may make on one booking. */
  maxMoves: number;
};

export const DEFAULT_RESCHEDULE: ReschedulePolicy = { allowed: true, minHoursBefore: 24, maxMoves: 1 };

export const RESCHEDULE_MAX_HOURS = 168;
export const RESCHEDULE_MAX_MOVES = 5;

/** Statuses a booking can be moved in, by anyone. */
export const MOVABLE: readonly BookingStatus[] = ['pending', 'confirmed'];

/** Why a player cannot move a booking, as an API error code. */
export type RescheduleRefusal = 'reschedule_not_allowed' | 'reschedule_too_late' | 'reschedule_limit';

/**
 * Whether the player may move a booking now under the policy frozen on it; null when they may.
 * A booking made before the policy existed carries none, so only staff can move it.
 */
export function playerRescheduleRefusal(
  policy: ReschedulePolicy | null | undefined,
  startAt: Date,
  moves: number,
  now: Date,
): RescheduleRefusal | null {
  if (!policy || !policy.allowed) return 'reschedule_not_allowed';
  if (moves >= policy.maxMoves) return 'reschedule_limit';
  if (now.getTime() > rescheduleCutoff(policy, startAt).getTime()) return 'reschedule_too_late';
  return null;
}

/** The last moment a player may move a booking starting at `startAt`. */
export const rescheduleCutoff = (policy: ReschedulePolicy, startAt: Date): Date =>
  new Date(startAt.getTime() - policy.minHoursBefore * MS_PER_HOUR);

/** Until when the player may move the booking; null when they cannot (any more). */
export function reschedulableUntil(
  policy: ReschedulePolicy | null | undefined,
  b: { status: BookingStatus; startAt: Date; moves: number; series: boolean },
  now: Date,
): Date | null {
  if (b.series || !MOVABLE.includes(b.status)) return null;
  if (playerRescheduleRefusal(policy, b.startAt, b.moves, now)) return null;
  return rescheduleCutoff(policy!, b.startAt);
}
